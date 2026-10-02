import { describe, expect, it } from "vitest";
import { withRelayEndpoint } from "./relayConfig";

const endpoint = {
  routeId: "019a0000-0000-7000-8000-000000000001",
  host: "203.0.113.20",
  port: 47300,
};
describe("relay config transformation", () => {
  it("changes only the peer Endpoint and preserves comments, CRLF and unknown fields", () => {
    const original =
      "[Interface]\r\nPrivateKey = SYNTHETIC\r\nHeaderProtectionKey = SYNTHETIC\r\nUnknownField = preserve\r\n# Endpoint = comment\r\n[Peer]\r\n  Endpoint = 203.0.113.10:47300  # keep\r\nPublicKey = SYNTHETIC-PUBLIC\r\n";
    const result = withRelayEndpoint(original, endpoint);
    expect(
      result.replace("203.0.113.20:47300", "203.0.113.10:47300") === original,
    ).toBe(true);
    expect(result.includes("203.0.113.20:47300")).toBe(true);
  });
  it("rejects ambiguous configs and endpoint injection", () => {
    for (const config of [
      "[Interface]\nEndpoint=x:1\n",
      "[Peer]\nEndpoint=x:1\nEndpoint=y:2\n",
      "[Peer]\nEndpoint=x:1\n[Peer]\nEndpoint=y:2\n",
    ]) {
      expect(() => withRelayEndpoint(config, endpoint)).toThrow();
    }
    expect(() =>
      withRelayEndpoint("[Peer]\nEndpoint=x:1\n", {
        ...endpoint,
        host: "203.0.113.20\nPostUp = sh",
      }),
    ).toThrow();
    expect(() =>
      withRelayEndpoint("[Peer]\nEndpoint=x:1\n", { ...endpoint, port: 65536 }),
    ).toThrow();
  });
});
