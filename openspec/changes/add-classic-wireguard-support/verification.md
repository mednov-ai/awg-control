# Local implementation verification — 2026-10-16

Status: local implementation and normal verification passed; 19/25 tasks complete.
No live SSH, VPN installation, production peer/route mutation, publication,
commit/push, release tag, image digest or deployment was performed in this apply.
The pre-existing dirty work and credential note were retained and not staged.

## Delivered

- Distinct `wireguard` adapter with positive kernel link-kind confirmation,
  Amnezia `/opt/amnezia/wireguard/<interface>.conf` discovery, ambiguous-engine
  read-only behavior and exact interface UDP mapping.
- VPN RPC 1.1/1.0 negotiation without mutation retry; incompatible WireGuard
  access blocked, previous-minor discovery never relabels WireGuard as Legacy.
- Migration 0007 preserving v6 Instances, peer/relay FK relations, UDP ports,
  backup restore and the revoked-address partial unique index. Identity changes
  retain IDs and reset management; fresh valid discovery can recover observed
  mode from a prior read-only result.
- Standard IPv4 .conf/QR and Direct/Selectel endpoint alternatives; no unverified
  WireGuard vpn://. RU/EN router guidance and explicit IPv6 scope.
- Shared transaction/policy pipeline. Creation now excludes suspended address
  reservations from its allocation document without restoring suspended peers.
- WireGuard relay routes preserve existing AWG routes, including unchanged route
  metadata timestamps. Changed/disabled routes update their own timestamps.
- Operator, architecture, development, security, relay and pilot contracts;
  actual-router checklist in `docs/wireguard-guide.md`.

## Passed evidence

- Node 24.13.0, pinned pnpm 11.9.0: `pnpm check` passed lint, typecheck, all
  tests and production builds. Contracts: 12 tests; API: 32; Web: 19 (63 total).
- `pnpm audit --audit-level moderate`: no known vulnerabilities after the narrow
  source-map-js 1.2.2 override. Advisory:
  https://github.com/advisories/GHSA-68fv-2mgg-jv7q
- Go formatting, `go vet ./...`, `go test -race ./...`, `bash -n scripts/*.sh`,
  OpenSpec strict validation and `git diff --check` passed.
- `scripts/test-relay-lifecycle.sh`: real UDP multi-client/multi-response,
  reload, fingerprint conflict/rollback, uninstall and bootstrap fixture passed.
- `scripts/test-wireguard-lifecycle.sh`: actual generated Go client template
  accepted by standard wg-quick and kernel WireGuard; real direct and relayed
  handshake/traffic, idle mapping expiry/reconnect and return to direct passed.
  Test binary cross-built for amd64/arm64; actual container execution was arm64.
- Independent browser smoke against the production build with synthetic API:
  one issuance, two standard downloads, no Amnezia link, clear-on-close passed.
  A separate context was created and closed; existing user tabs were untouched.
- Authenticated API smoke: successful WireGuard issuance, no-store, one-time retry,
  CIDR/unknown-field and CSRF rejection, no client payload in serialized DB,
  generated OpenAPI and FK integrity passed.

Initial local checks exposed a Node 26 native addon and then incompatible native
build headers; SQLite was rebuilt against the selected Node 24.13.0. Early worker
startup/CLI timeouts and native assertions are superseded by the successful full
final check. The OS Node alias was not changed. API Vitest now targets src tests
so stale dist test copies are not executed alongside current sources.

## Remaining evidence and operational gates

- Task 2.1 is partially verified: actual standard kernel WireGuard and negative
  runtime-kind/config fixtures passed. A matrix of real Amnezia Legacy/AWG2/AWG3
  engine containers was not created on this Docker Desktop host. Synthetic
  classification and previous AWG regression tests are not that runtime evidence.
  Keep this task open; perform the matrix on a disposable compatible Linux host
  before claiming broad engine acceptance. Userspace/TUN remains read-only.
- Tasks 6.1–6.5 remain open: separately requested release/deployment, fresh live
  inventory and snapshots, WireGuard preparation through AmneziaVPN if absent,
  approved disposable-peer/relay operations, real router handshake/traffic/DNS/
  Node exit-IP/IPv6/idle/reconnect and separately authorized reboot recovery.
- Router model/firmware/LAN and IPv6 policy are not known. Neither a local Linux
  tunnel nor a browser/import test proves acceptance on that router.
- Existing `add-managed-udp-relay` acceptance was not changed or completed.
  Production preservation cannot be claimed without fresh before/after checks.
- This change is not archived.


## Deployment preparation — 2026-10-16

Operator authorized completing verification and deploying direct/Selectel WireGuard while preserving AWG. Fresh DNS and pinned SSH reached the expected VPN/relay hosts. Fresh baseline has 10 peers on each AWG Instance; AWG3 Panel metadata confirms 10 active peers and newer creation timestamps. The historical count of 7 is superseded, not an unexplained peer loss.

A complete real Linux engine matrix passed on four renamed disposable containers: standard kernel WireGuard, AmneziaWG Legacy, AWG2 and AWG 3.1. All were detected with the expected adapter/protocol and safe mutation capabilities using temporary published ports. The first run exposed tool-name dependence for Legacy, fixed and covered by a Go regression test. Fixture containers were removed; discovery used isolated Helper state and did not mutate existing configurations. Result evidence: `/root/awg-control-wireguard-20261016T182048Z/matrix-result.json`. Task 2.1 is complete.

Consistent pre-migration SQLite backup: integrity ok, zero FK violations, schema 6. External master key separately protected under `/root/awg-control-key-backups/`; no content collected. Original Helper/image/settings and root-only AWG snapshots are in `/root/awg-control-wireguard-20261016T182048Z`. Release is prepared in an isolated managed worktree from origin/main; unrelated original dirty files remain untouched. Deployment results follow separately.
