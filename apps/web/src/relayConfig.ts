import type { RelayEndpoint } from "@awg-control/contracts";

// Replace one field without reserializing, losing comments or unknown AWG fields.
export function withRelayEndpoint(
  config: string,
  endpoint: RelayEndpoint,
): string {
  const octets = endpoint.host.split(".");
  if (
    octets.length !== 4 ||
    octets.some((o) => !/^(0|[1-9]\d{0,2})$/.test(o) || Number(o) > 255) ||
    !Number.isInteger(endpoint.port) ||
    endpoint.port < 1024 ||
    endpoint.port > 65535
  )
    throw new Error("Invalid relay endpoint");
  let peerCount = 0;
  let inPeer = false;
  let count = 0;
  const result = config.replace(/[^\r\n]+/g, (line) => {
    const section = /^\s*\[([^\]]+)\]\s*(?:[#;].*)?$/.exec(line);
    if (section) {
      inPeer = section[1]!.toLowerCase() === "peer";
      if (inPeer) peerCount++;
      return line;
    }
    if (!inPeer) return line;
    const field = /^(\s*Endpoint\s*=\s*)([^#;]*?)(\s*(?:[#;].*)?)$/.exec(line);
    if (!field) return line;
    count++;
    return `${field[1]}${endpoint.host}:${endpoint.port}${field[3]}`;
  });
  if (peerCount !== 1 || count !== 1)
    throw new Error("Unsupported client configuration");
  return result;
}
