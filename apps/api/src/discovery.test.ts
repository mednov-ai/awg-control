import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import type { HelperRequest, HelperResponse } from "@awg-control/contracts";
import { openDatabase } from "./database.js";
import { Repository, type NodeSecretRecord } from "./repository.js";
import { hashPassword } from "./security/crypto.js";
import { buildServer } from "./server.js";

it("discovers real UUID/date-time contracts and rejects malformed or coerced Helper metadata atomically", async () => {
  const dir = mkdtempSync(join(tmpdir(), "awg-discovery-"));
  const db = openDatabase(join(dir, "test.db"), new URL("../migrations", import.meta.url).pathname);
  const repo = new Repository(db);
  repo.createAdmin("operator", await hashPassword("synthetic discovery password"));
  const nodeId = "018bcfe5-6800-7000-8000-000000000010";
  repo.createNode({ id: nodeId, name: "Fixture", description: null, host: "vpn.example.test", port: 22, sshUsername: "agent", hostKeyFingerprint: "fixture", transportPrivateKeyEncrypted: "fixture", pollIntervalSeconds: 60 });
  const instance = { id: "018bcfe5-6800-7000-8000-000000000011", displayName: "WireGuard", adapter: "wireguard", protocolVersion: "wireguard", containerRef: "opaque-container", interfaceName: "wg0", configRef: "opaque-config", capabilities: { stats: true, create: true, suspend: true, resume: true, revoke: true, metadataUpdate: false }, sourceFingerprint: "a".repeat(64), readOnly: false, udpPort: 51820 };
  let instances: unknown[] = [instance];
  const app = await buildServer({ host: "127.0.0.1", port: 8080, databasePath: join(dir, "test.db"), migrationsPath: "", webRoot: null, masterKey: Buffer.alloc(32, 7), sessionTtlSeconds: 3600, rememberedSessionTtlSeconds: 2592000, rememberedSessionIdleTtlSeconds: 604800, sessionActivityWriteIntervalSeconds: 300, secureCookies: false, publicOrigin: "http://panel.test", trustedProxyHops: 0, pollingEnabled: false }, repo, {
    async call<T>(_node: NodeSecretRecord, request: HelperRequest): Promise<HelperResponse<T>> { return { ok: true, requestId: request.requestId, result: { helperVersion: "0.4.12", instances } as T }; },
  });
  try {
    const login = await app.inject({ method: "POST", url: "/api/v1/auth/login", headers: { origin: "http://panel.test" }, payload: { username: "operator", password: "synthetic discovery password" } });
    const headers = { origin: "http://panel.test", cookie: String(login.headers["set-cookie"]).split(";")[0]!, "idempotency-key": "discovery-test" };
    const discover = () => app.inject({ method: "POST", url: `/api/v1/nodes/${nodeId}/discover`, headers });
    expect((await discover()).statusCode).toBe(200);
    expect(repo.listInstances(nodeId)).toMatchObject([{ adapter: "wireguard", mode: "observed", udpPort: 51820 }]);
    const before = repo.listInstances(nodeId);
    for (const malformed of [{ ...instance, id: "invalid-uuid" }, { ...instance, udpPort: "51820" }, { ...instance, capabilities: { ...instance.capabilities, create: "true" } }, { ...instance, capabilities: { ...instance.capabilities, unexpected: true } }]) {
      instances = [instance, malformed];
      const response = await discover();
      expect(response.statusCode).toBe(502);
      expect(response.json()).toMatchObject({ code: "INVALID_HELPER_RESPONSE" });
      expect(repo.listInstances(nodeId)).toEqual(before);
    }
  } finally { await app.close(); db.close(); rmSync(dir, { recursive: true, force: true }); }
});
