import { deflate } from "pako";

import type { Connection, InstanceRecord } from "@awg-control/contracts";

const awgKeys = [
  "Jc", "Jmin", "Jmax", "S1", "S2", "S3", "S4", "H1", "H2", "H3", "H4",
  "I1", "I2", "I3", "I4", "I5", "HeaderProtectionKey", "ContentPaddingAddition",
  "RekeyAfterTime", "RekeyTimeout", "RejectAfterTime", "KeepaliveTimeout",
  "MaxHandshakeAttempts", "RandomTrailers", "DisableCookies",
] as const;

function parseNativeConfig(value: string) {
  const sections = new Map<string, Map<string, string>>();
  let current: Map<string, string> | undefined;

  for (const rawLine of value.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || line.startsWith(";")) continue;
    const section = /^\[([^\]]+)]$/.exec(line);
    if (section) {
      const sectionName = section[1];
      if (!sectionName) continue;
      current = new Map<string, string>();
      sections.set(sectionName.toLowerCase(), current);
      continue;
    }
    const separator = line.indexOf("=");
    if (!current || separator < 1) continue;
    current.set(line.slice(0, separator).trim(), line.slice(separator + 1).trim());
  }

  return { interface: sections.get("interface"), peer: sections.get("peer") };
}

function endpointParts(value: string) {
  const ipv6 = /^\[([^\]]+)]:(\d+)$/.exec(value);
  const regular = /^(.+):(\d+)$/.exec(value);
  const match = ipv6 ?? regular;
  if (!match) throw new Error("Unsupported endpoint");
  const port = Number(match[2]);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("Unsupported endpoint");
  return { host: match[1], port };
}

function base64Url(value: Uint8Array) {
  let binary = "";
  for (let offset = 0; offset < value.length; offset += 0x8000) {
    binary += String.fromCharCode(...value.subarray(offset, offset + 0x8000));
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export function createAmneziaVpnKey(
  clientConfig: string,
  connection: Connection,
  instance: InstanceRecord,
) {
  const parsed = parseNativeConfig(clientConfig);
  const iface = parsed.interface;
  const peer = parsed.peer;
  if (!iface || !peer) throw new Error("Unsupported client configuration");

  const privateKey = iface.get("PrivateKey");
  const address = iface.get("Address")?.split(",")[0]?.trim();
  const serverPublicKey = peer.get("PublicKey");
  const endpoint = peer.get("Endpoint");
  if (!privateKey || !address || !serverPublicKey || !endpoint) {
    throw new Error("Unsupported client configuration");
  }

  const { host, port } = endpointParts(endpoint);
  const allowedIps = (peer.get("AllowedIPs") ?? "0.0.0.0/0, ::/0")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const dns = (iface.get("DNS") ?? "").split(",").map((item) => item.trim()).filter(Boolean);
  const awgParams = Object.fromEntries(
    awgKeys.flatMap((key) => {
      const value = iface.get(key);
      return value === undefined ? [] : [[key, value]];
    }),
  );
  const persistentKeepAlive = peer.get("PersistentKeepalive") ?? "25";
  const lastConfig = {
    ...awgParams,
    allowed_ips: allowedIps,
    clientId: connection.publicKey,
    client_ip: address.replace(/\/\d+$/, ""),
    client_priv_key: privateKey,
    client_pub_key: connection.publicKey,
    config: clientConfig,
    hostName: host,
    mtu: iface.get("MTU") ?? "1280",
    persistent_keep_alive: persistentKeepAlive,
    port,
    ...(peer.get("PresharedKey") ? { psk_key: peer.get("PresharedKey") } : {}),
    server_pub_key: serverPublicKey,
  };
  const container = instance.adapter === "amneziawg-legacy" ? "amnezia-awg" : "amnezia-awg2";
  const awg = {
    ...awgParams,
    ...(instance.protocolVersion === "2" || instance.protocolVersion === "3.1"
      ? { protocol_version: instance.protocolVersion }
      : {}),
    last_config: JSON.stringify(lastConfig),
    port: String(port),
    transport_proto: "udp",
  };
  const serverConfig = {
    containers: [{ awg, container }],
    defaultContainer: container,
    description: connection.name,
    ...(dns[0] ? { dns1: dns[0] } : {}),
    ...(dns[1] ? { dns2: dns[1] } : {}),
    hostName: host,
  };

  const raw = new TextEncoder().encode(JSON.stringify(serverConfig));
  const compressed = deflate(raw, { level: 8 });
  const payload = new Uint8Array(4 + compressed.length);
  new DataView(payload.buffer).setUint32(0, raw.length, false);
  payload.set(compressed, 4);
  return `vpn://${base64Url(payload)}`;
}
