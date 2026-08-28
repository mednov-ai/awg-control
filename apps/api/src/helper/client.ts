import { Client } from "ssh2";

import type { HelperRequest, HelperResponse } from "@awg-control/contracts";

import type { NodeSecretRecord } from "../repository.js";
import { decryptSecret } from "../security/crypto.js";

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const FIXED_REMOTE_COMMAND = "awg-control-rpc";

export class HelperTransportError extends Error {
  public constructor(
    message: string,
    public readonly code: "HOST_KEY_MISMATCH" | "HELPER_UNAVAILABLE" | "INVALID_HELPER_RESPONSE",
  ) {
    super(message);
    this.name = "HelperTransportError";
  }
}

function expectedHostHash(value: string): string {
  if (/^[0-9a-f]{64}$/i.test(value)) return value.toLowerCase();
  if (value.startsWith("SHA256:")) {
    return Buffer.from(value.slice(7), "base64").toString("hex");
  }
  throw new HelperTransportError("unsupported SSH host fingerprint format", "HOST_KEY_MISMATCH");
}

export interface HelperClient {
  call<T>(node: NodeSecretRecord, request: HelperRequest): Promise<HelperResponse<T>>;
}

export class SshHelperClient implements HelperClient {
  public constructor(
    private readonly masterKey: Buffer,
    private readonly timeoutMs = 15_000,
  ) {}

  public async call<T>(node: NodeSecretRecord, request: HelperRequest): Promise<HelperResponse<T>> {
    const privateKey = decryptSecret(
      this.masterKey,
      `transport-key:${node.node.id}`,
      node.transportPrivateKeyEncrypted,
    );
    const expected = expectedHostHash(node.node.hostKeyFingerprint);

    try {
      return await new Promise<HelperResponse<T>>((resolve, reject) => {
        const client = new Client();
        let settled = false;
        let hostKeyMismatch = false;
        const done = (callback: () => void): void => {
          if (settled) return;
          settled = true;
          client.end();
          callback();
        };
        const timer = setTimeout(() => {
          done(() => reject(new HelperTransportError("helper request timed out", "HELPER_UNAVAILABLE")));
        }, this.timeoutMs);

        client
        .on("ready", () => {
          client.exec(FIXED_REMOTE_COMMAND, (error, stream) => {
            if (error) {
              clearTimeout(timer);
              done(() => reject(new HelperTransportError("failed to open helper RPC", "HELPER_UNAVAILABLE")));
              return;
            }
            const chunks: Buffer[] = [];
            let bytes = 0;
            stream.on("data", (chunk: Buffer) => {
              bytes += chunk.length;
              if (bytes > MAX_RESPONSE_BYTES) {
                stream.close();
                clearTimeout(timer);
                done(() => reject(new HelperTransportError("helper response is too large", "INVALID_HELPER_RESPONSE")));
                return;
              }
              chunks.push(chunk);
            });
            stream.on("close", () => {
              if (settled) return;
              clearTimeout(timer);
              try {
                const line = Buffer.concat(chunks).toString("utf8").trim();
                const parsed = JSON.parse(line) as HelperResponse<T>;
                if (!parsed || typeof parsed !== "object" || parsed.requestId !== request.requestId || typeof parsed.ok !== "boolean") {
                  throw new Error("response envelope mismatch");
                }
                if (parsed.ok && !("result" in parsed)) throw new Error("response result is missing");
                if (!parsed.ok && (!parsed.error || typeof parsed.error.code !== "string" || typeof parsed.error.message !== "string" || typeof parsed.error.retryable !== "boolean")) {
                  throw new Error("response error is invalid");
                }
                done(() => resolve(parsed));
              } catch {
                done(() => reject(new HelperTransportError("invalid helper response", "INVALID_HELPER_RESPONSE")));
              }
            });
            stream.on("error", () => {
              clearTimeout(timer);
              done(() => reject(new HelperTransportError("helper stream failed", "HELPER_UNAVAILABLE")));
            });
            stream.end(`${JSON.stringify(request)}\n`);
          });
        })
        .on("error", () => {
          clearTimeout(timer);
          const code = hostKeyMismatch ? "HOST_KEY_MISMATCH" : "HELPER_UNAVAILABLE";
          done(() => reject(new HelperTransportError(hostKeyMismatch ? "SSH host key mismatch" : "SSH connection failed", code)));
        })
        .connect({
          host: node.node.host,
          port: node.node.port,
          username: node.node.sshUsername,
          privateKey,
          readyTimeout: this.timeoutMs,
          hostHash: "sha256",
          hostVerifier: (actual: string) => {
            const matches = actual.toLowerCase() === expected;
            hostKeyMismatch = !matches;
            return matches;
          },
          algorithms: {
            serverHostKey: ["ssh-ed25519", "rsa-sha2-512", "rsa-sha2-256"],
          },
        });
      });
    } finally {
      privateKey.fill(0);
    }
  }
}
