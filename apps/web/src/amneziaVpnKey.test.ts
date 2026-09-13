import { inflate } from "pako";
import { describe, expect, it } from "vitest";

import type { Connection, InstanceRecord } from "@awg-control/contracts";

import { createAmneziaVpnKey } from "./amneziaVpnKey";

const connection = {
  id: "018bcfe5-6800-7000-8000-000000000024", vpnUserId: "018bcfe5-6800-7000-8000-000000000022",
  instanceId: "018bcfe5-6800-7000-8000-000000000023", name: "Phone", publicKey: "fixture-client-public-key-material",
  addressCidr: "10.8.3.2/32", source: "created", managementMode: "managed", status: "active", expiresAt: null,
  quotaPolicyId: null, quotaOverrideAt: null, lastHandshakeAt: null, rxBytesTotal: 0, txBytesTotal: 0,
  createdAt: "2026-09-11T00:00:00.000Z", updatedAt: "2026-09-11T00:00:00.000Z", revokedAt: null,
} satisfies Connection;

const instance = {
  id: connection.instanceId, nodeId: "018bcfe5-6800-7000-8000-000000000021", displayName: "AWG 3.1",
  adapter: "awg3", protocolVersion: "3.1", containerRef: "fixture", interfaceName: "awg0", configRef: "fixture-config",
  capabilities: { stats: true, create: true, suspend: true, resume: true, revoke: true, metadataUpdate: false },
  sourceFingerprint: "fixture-source-fingerprint", mode: "managed", lastDiscoveredAt: "2026-09-11T00:00:00.000Z",
} satisfies InstanceRecord;

function decode(key: string) {
  const encoded = key.slice("vpn://".length).replaceAll("-", "+").replaceAll("_", "/");
  const padded = encoded.padEnd(Math.ceil(encoded.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  const expectedLength = new DataView(bytes.buffer).getUint32(0, false);
  const raw = inflate(bytes.subarray(4));
  expect(raw.length).toBe(expectedLength);
  return JSON.parse(new TextDecoder().decode(raw)) as Record<string, unknown>;
}

describe("AmneziaVPN connection key", () => {
  it("wraps an AWG 3.1 native config as an importable vpn link", () => {
    const config = `[Interface]\nPrivateKey = fixture-private-key\nAddress = 10.8.3.2/32\nDNS = 1.1.1.1\nMTU = 1280\nJc = 4\nHeaderProtectionKey = fixture-header-key\nRandomTrailers = on\nDisableCookies = on\n\n[Peer]\nPublicKey = fixture-server-public-key\nEndpoint = vpn.example.test:47300\nAllowedIPs = 0.0.0.0/0, ::/0\nPersistentKeepalive = 25\n`;
    const key = createAmneziaVpnKey(config, connection, instance);
    expect(key).toMatch(/^vpn:\/\/[A-Za-z0-9_-]+$/);

    const decoded = decode(key) as {
      defaultContainer: string;
      hostName: string;
      containers: Array<{ container: string; awg: { protocol_version: string; last_config: string } }>;
    };
    expect(decoded.defaultContainer).toBe("amnezia-awg2");
    expect(decoded.hostName).toBe("vpn.example.test");
    const firstContainer = decoded.containers[0];
    expect(firstContainer).toBeDefined();
    if (!firstContainer) throw new Error("Missing AWG container");
    expect(firstContainer.container).toBe("amnezia-awg2");
    expect(firstContainer.awg.protocol_version).toBe("3.1");
    expect(JSON.parse(firstContainer.awg.last_config)).toMatchObject({
      HeaderProtectionKey: "fixture-header-key",
      RandomTrailers: "on",
      DisableCookies: "on",
      client_ip: "10.8.3.2",
      client_pub_key: connection.publicKey,
      hostName: "vpn.example.test",
      port: 47300,
    });
  });

  it("uses the AWG2 container and protocol marker", () => {
    const awg2Instance = { ...instance, adapter: "awg2", protocolVersion: "2" } satisfies InstanceRecord;
    const config = `[Interface]\nPrivateKey = fixture-private-key\nAddress = 10.8.1.2/32\nDNS = 1.1.1.1\nJc = 4\nS1 = 20\nH1 = 12345\n\n[Peer]\nPublicKey = fixture-server-public-key\nEndpoint = vpn.example.test:38829\nAllowedIPs = 0.0.0.0/0, ::/0\nPersistentKeepalive = 25\n`;
    const decoded = decode(createAmneziaVpnKey(config, connection, awg2Instance)) as {
      defaultContainer: string;
      containers: Array<{ awg: { protocol_version: string } }>;
    };
    expect(decoded.defaultContainer).toBe("amnezia-awg2");
    expect(decoded.containers[0]?.awg.protocol_version).toBe("2");
  });

  it("fails without returning secret material in the error", () => {
    expect(() => createAmneziaVpnKey("[Interface]\nPrivateKey = do-not-leak", connection, instance))
      .toThrow("Unsupported client configuration");
  });
});
