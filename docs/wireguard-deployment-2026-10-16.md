# WireGuard deployment — 2026-10-16

Operator requested deployment of universal standard WireGuard, directly and via
Selectel, while preserving existing AWG connections. Router verification is left
to the operator; no router model, firmware or LAN information is required to
issue the standard profile. Firmware-specific routing/NAT/IPv6 acceptance remains
separate from server and disposable Linux-client checks.

## Release provenance

- Implementation PR: https://github.com/mednov-ai/awg-control/pull/13
- Implementation branch commit: `0eaa06c4ba4f10ec40ee77b23f97c4f2276023b8` (pushed).
- Merged release commit: `8a4338d65def8efb1a11dd2faff2bfcb67f017db`.
- Published tag: `v0.4.12` points to that merge commit.
- CI on branch and merge commit passed. Release workflow:
  https://github.com/mednov-ai/awg-control/actions/runs/38948148500
- Helper amd64 SHA-256:
  `350721c3cc7058af3800d1f39bc61b2a0ba8f22ef784f025af4b4b695dd40ef8`.
- Release publication, Panel digest and deployment results are recorded below
  only after verification.

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
Instances. This requires a Panel-only follow-up release v0.4.13; VPN Helper
v0.4.12 remains compatible and Selectel Helper remains unchanged.
