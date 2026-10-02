import type { HelperResponse, RelayRequest } from "@awg-control/contracts";
import { SshHelperClient } from "../helper/client.js";
import type { RelaySecret } from "./repository.js";

export interface RelayClient {
  call<T>(
    relay: RelaySecret,
    request: RelayRequest,
  ): Promise<HelperResponse<T>>;
}
export class SshRelayClient implements RelayClient {
  private readonly transport: SshHelperClient;
  constructor(masterKey: Buffer) {
    this.transport = new SshHelperClient(masterKey, 30_000);
  }
  call<T>(
    relay: RelaySecret,
    request: RelayRequest,
  ): Promise<HelperResponse<T>> {
    return this.transport.callRpc(
      relay.relay,
      relay.transportPrivateKeyEncrypted,
      `relay-transport-key:${relay.relay.id}`,
      request,
      "awg-control-relay-rpc",
    );
  }
}
