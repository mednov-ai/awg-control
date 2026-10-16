# WireGuard deployment — 2026-10-16

Operator requested deployment of universal standard WireGuard, directly and via
Selectel, while preserving existing AWG connections. Router verification is left
to the operator; no router model, firmware or LAN information is required to
issue the standard profile. Firmware-specific routing/NAT/IPv6 acceptance remains
separate from server and disposable Linux-client checks.

## Current deployment

- Panel **v0.4.13**, VPN Helper **v0.4.12 / RPC 1.1**; Selectel Helper **v0.4.11** unchanged.
- Correction PR: https://github.com/mednov-ai/awg-control/pull/15
- Pushed correction commit: `68d7e4f`.
- Release commit/tag: `724a546632ed0e89bd6c1fbc164ae9d4f5bfaad8`, `v0.4.13`.
- Published release: https://github.com/mednov-ai/awg-control/releases/tag/v0.4.13
- Successful release workflow: https://github.com/mednov-ai/awg-control/actions/runs/38950257846
- Installed multi-architecture Panel digest:
  `sha256:4ad4ba660ea08bdb14a0ab259758d0fa90feb950dcca6edbb7d1efc9cf25632d`.
- amd64/arm64 manifests checked. Panel signature verified against the exact
  release-workflow/tag identity and GitHub Actions OIDC issuer before install.
  VPN Helper checksum and Sigstore bundle verified before its installation.
- Panel recreated by its exact Compose service name only; named database volume,
  external master key, origin, transport credentials and old image retained.
- Fresh consistent backups verified before both upgrades. Final schema 7:
  integrity `ok`, zero FK violations; readiness and public Panel HTTP 200 pass.
- Existing administrator credential/TOTP hashes and statuses unchanged; all
  temporary maintenance administrators disabled and their sessions removed.

## Initial release provenance

- Implementation PR: https://github.com/mednov-ai/awg-control/pull/13
- Implementation branch commit: `0eaa06c4ba4f10ec40ee77b23f97c4f2276023b8` (pushed).
- Merged release commit: `8a4338d65def8efb1a11dd2faff2bfcb67f017db`.
- Published tag: `v0.4.12` points to that merge commit.
- CI on branch and merge commit passed. Release workflow:
  https://github.com/mednov-ai/awg-control/actions/runs/38948148500
- Helper amd64 SHA-256:
  `350721c3cc7058af3800d1f39bc61b2a0ba8f22ef784f025af4b4b695dd40ef8`.
- Initial release v0.4.12 was published successfully; its Panel was superseded
  by v0.4.13 after the discovery correction described below.

## Preservation baseline and installation

Fresh DNS and pinned SSH verified VPN Node `89.124.107.104` and Selectel
`139.100.236.101`. Panel publication is `https://wg.cbrgn.mooo.com`.
The historical Play&Say hostname is not used to select the VPN server.

Existing AWG2 has 10 runtime peers on UDP 38829; AWG 3.1 has 10 on UDP 47300.
Before/after checks compare full container identity, start times, restart counts,
peer count, aggregate peer-set hash and config hash. Keys/config payloads are not
collected into this report. Docker, nginx and k3s identities are compared too.
The existing Selectel AWG route is UDP 47300 to `89.124.107.104:47300`.

A separate `amnezia-wireguard` container uses kernel WireGuard, UDP 51820,
`10.8.4.1/24` and a persistent root-only `/opt/amnezia/wireguard/wg0.conf`.
Its operator image `awg-control-wireguard:amnezia-30ff3451` is based on pinned
Amnezia startup logic with a pinned Alpine 3.22 base as documented in
[the guide](wireguard-guide.md). It uses NET_ADMIN and restart-unless-stopped;
existing containers are untouched. No existing peer is implicitly adopted.

Root-only snapshots, original Helper/Compose settings, consistent schema-6
SQLite backups, safe aggregate baselines and scoped rollback script are under
`/root/awg-control-wireguard-20261016T182048Z` on the VPN Node. The external
32-byte master key is backed up separately under `/root/awg-control-key-backups`.
Backup integrity/FK checks pass. Selectel baseline/config backup is under
`/root/awg-control-wireguard-20261016` on that server.

A real disposable Linux runtime matrix passed standard WireGuard, Legacy,
AWG2 and AWG 3.1 under renamed containers and isolated Helper state. Containers
were removed. Existing AWG hashes/identities remained unchanged.

## Expected client endpoints

| Profile | Endpoint | Internet exit IPv4 |
| --- | --- | --- |
| Direct | `89.124.107.104:51820` | `89.124.107.104` |
| Via Selectel | `139.100.236.101:51820` | `89.124.107.104` |

Issue a new Connection in the WireGuard Instance through the Panel and save both
standard `.conf` variants while the one-time window is open. Use the variants
in turn on the same router. No simultaneous-device use or automatic failover is
provided. The verification peer is disposable and must never be reused as the
operator's router profile.

## Acceptance boundaries

Router import, LAN-client DNS/Internet, IPv6 policy and reconnect behavior are
for the operator to verify. No router tunnel acceptance is claimed. A shared
Selectel-host reboot has not been authorized or performed; reboot recovery is
pending. The OpenSpec change remains unarchived.

## Deployment-discovered correction

The signed v0.4.12 Panel/Helper upgrade completed and schema 7 integrity/FK checks
passed. Only Panel was recreated; AWG containers, peers/config hashes and host
services remained unchanged. The first authenticated discovery exposed a format
registry mismatch: TypeBox Value.Check did not have UUID/date-time validators
registered, so it rejected every otherwise-valid Instance. No test peer or relay
route was created at that point. The temporary maintenance administrator was
disabled and its sessions removed.

The correction uses Fastify's configured schema compiler and rejects coercion by
checking that validation does not change the metadata. A regression exercises
successful real-shaped WireGuard discovery, malformed UUID, numeric/boolean
coercion and unknown capability rejection, plus atomic preservation of saved
Instances. This required the installed Panel-only follow-up release v0.4.13; VPN Helper
v0.4.12 remains compatible and Selectel Helper remains unchanged.

## Live verification and remaining limits

A disposable standard Linux kernel WireGuard client container on the VPN Node
passed these checks using the issued standard profile (MTU 1280):

| Check | Direct | Via Selectel |
| --- | --- | --- |
| Handshake and increasing RX/TX | Passed | Passed |
| Server ping and DNS | Passed | Passed |
| HTTPS and exit IPv4 `89.124.107.104` | Passed | Passed |
| Reconnect / return to direct | Passed | Passed after idle |

Direct here is a Docker hairpin to the Node's public endpoint. Selectel traverses
the public Node-to-Selectel path and the actual managed nginx UDP relay back to
the Node. A separate Docker Desktop client also passed direct HTTPS/DNS/exit-IP.
These are server/transport evidence, not actual-router acceptance.

The external Docker Desktop client established Selectel handshakes, small pings
and DNS, but HTTPS timed out. Size probes passed 64/512-byte ping payloads and
failed 1000/1200-byte payloads. Header-only aggregate capture showed Selectel
receiving and forwarding the larger request/response datagrams. Alternate relay
UDP 45182 and client MTUs 800/512 did not resolve HTTPS; port 51820 was restored
through the supported relay transaction. On the Mac, the Selectel route uses
`en1` while the direct Node route uses `utun8`, so the two external tests have
different underlying paths. The cause is not established and is not asserted to
be MTU or DPI. Do not infer that the operator's router/network is accepted from
the successful server-side client.

Successful server-side evidence also covers API one-time retry without secret
reissue, no-store, no client private key in serialized SQLite during issuance,
peer suspend/resume without container restart, idle/reconnect and return to
direct. All disposable Connections from successful and failed attempts were
revoked; final WireGuard runtime peer count and non-revoked Connection count are
both zero. Root-only safe result: `live-node-client-result.json` in the protected
VPN deployment directory.

Final preservation checks confirm the same 10 AWG2 and 10 AWG 3.1 runtime peers,
config/peer-set hashes, container IDs/start times/restarts and Docker/nginx/k3s
identities. All prior Connection identities, keys, addresses, statuses and policy
metadata are unchanged. Traffic counters and `updated_at` advance normally through
polling. The original AWG relay database row and its exact nginx server block
are unchanged. Selectel main nginx, RepairDevice and relay master service identity
are unchanged; only the dedicated relay worker configuration was gracefully
reloaded for the new WireGuard route. Selectel Helper was not upgraded.

Tasks 6.1–6.3 are complete (23/25 overall). The operator will test the real router
(6.4). Shared-host reboot recovery (6.5) remains unperformed without separate
reboot authorization. No OpenSpec change was archived.
