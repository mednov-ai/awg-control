import { expect, it } from "vitest";
import type { HelperRequest, HelperResponse, RelayRequest } from "@awg-control/contracts";
import type { NodeSecretRecord, Repository } from "../repository.js";
import { SshHelperClient } from "./client.js";

const node = { node: { id: "synthetic-node" }, transportPrivateKeyEncrypted: "synthetic" } as NodeSecretRecord;
const request: HelperRequest = { protocolVersion: "1.1", requestId: "req", operationId: "op", action: "create", parameters: { instanceId: "instance" } };
class TransportFixture extends SshHelperClient {
  requests: Array<HelperRequest | RelayRequest> = [];
  constructor(private minor: string, adapter = "awg3") {
    super(Buffer.alloc(32), 100, { getInstance: () => ({ adapter }) } as unknown as Repository);
  }
  override async callRpc<T>(...args: Parameters<SshHelperClient["callRpc"]>): Promise<HelperResponse<T>> {
    const value = args[3];
    this.requests.push(value);
    return { ok: true, requestId: value.requestId, result: (value.action === "health" ? { protocolVersion: this.minor } : {}) as T };
  }
}
it.each(["1.0", "1.1"])("negotiates %s before AWG mutation without retrying it", async minor => {
  const client = new TransportFixture(minor);
  await client.call(node, request);
  expect(client.requests.map(r => [r.action, r.protocolVersion])).toEqual([["health", "1.0"], ["create", minor]]);
});
it("blocks incompatible WireGuard and future protocols before mutation", async () => {
  for (const client of [new TransportFixture("1.0", "wireguard"), new TransportFixture("1.2")]) {
    await expect(client.call(node, request)).rejects.toMatchObject({ code: "HELPER_INCOMPATIBLE" });
    expect(client.requests.map(r => r.action)).toEqual(["health"]);
  }
});
