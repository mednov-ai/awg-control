# Architecture

AWG Control has two privilege domains.

1. **Panel** is an unprivileged Node.js process serving the Fastify API and the
   compiled React application. It owns SQLite metadata but has no Docker socket,
   root shell, or direct VPN configuration access.
2. **Helper** is a root-owned static Go binary on each VPN node. OpenSSH exposes
   only its newline-delimited JSON RPC through a forced command and a minimal
   sudo rule.

Local and hub modes use the same SSH boundary. The browser talks only to the
same-origin Panel API. A Node identity is pinned by its SSH host-key fingerprint;
a mismatch fails closed.

## Data flow

- Runtime schemas in `packages/contracts` define API entities and stable errors.
- Fastify validates privileged request bodies and rejects unknown fields.
- Panel decrypts a Node transport key only for the duration of one SSH call.
- Helper maps opaque Instance IDs to root-only discovered metadata. API callers
  cannot provide container names or filesystem paths.
- Discovery classifies AmneziaWG by active configuration fields. AWG 3.1 is a
  distinct `awg3` adapter; incomplete/3.0 configurations fail closed as
  read-only and are never treated as AWG2.
- AWG2 and AWG 3.1 may coexist on one Node as separate Instances. Their
  container, UDP port, subnet, persistent configuration, lock, snapshot and
  fingerprint boundaries are independent.
- Configuration mutations are serialized per Instance, snapshotted, validated,
  atomically replaced, applied with `syncconf`, verified, and rolled back on any
  failure. Container restart is never an apply mechanism.
- The local systemd timer enforces projected expiry and quota policies even when
  Panel is offline.

Client private keys are generated inside Helper and cross the SSH/API boundary
once. They are not part of the database schema, idempotency journal, audit model,
backups, or browser persistence.

For AWG 3.1, the one-time client template includes the server-shared header
protection and padding/timing fields plus an explicit MTU of 1280. Only the
allowlisted commented `I1`–`I5` fields may be promoted from server comments to
the client template; comments containing other key-like data remain ignored.

## Managed relay boundary

Relay servers are separate from VPN Nodes. A relay-only forced command exposes nginx stream lifecycle through its own awgctl RPC mode. Panel never receives root shell or arbitrary upstream/configuration access. Relay metadata lives in SQLite; the browser derives an endpoint-only alternative from transient issuance. See [relay guide](relay-guide.md).

## Classic WireGuard

The containerized `wireguard` adapter is confirmed by kernel link kind plus
active configuration; ambiguous/TUN engines remain read-only. VPN RPC 1.1
supports 1.0 AWG requests without exposing WireGuard as Legacy. Panel negotiates
via previous-minor health and does not retry mutations. Reclassification retains
IDs but resets management. Exact interface listen-port mappings replace choosing
the first published UDP port. Relay eligibility includes confirmed managed
WireGuard and AWG 3.1; its independent RPC and privilege boundary are unchanged.
See [the WireGuard guide](wireguard-guide.md) for IPv4 router profiles and gates.
