# Local implementation verification — 2026-10-16

Status: implementation, release and server deployment complete; 23/25 tasks
complete. Panel v0.4.13 and VPN Helper v0.4.12 are installed. Signed releases,
fresh backups, schema 7 integrity/FK checks and preservation checks passed.
Direct and Selectel traffic passed with a disposable server-side Linux client;
router acceptance and shared-host reboot recovery remain open. External Docker
Desktop testing had a separate Selectel HTTPS/packet-delivery limitation; it is
recorded explicitly in the deployment report, not counted as router acceptance.
Unrelated original dirty work and credential notes were retained and not staged.

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

## Remaining acceptance evidence

The real engine matrix below completes task 2.1. Production rollout evidence is
recorded in [the deployment report](../../../docs/wireguard-deployment-2026-10-16.md).
Actual-router acceptance (6.4) is left to the operator by explicit request; no
model/firmware/LAN information is required for issuing a standard profile.
Shared Selectel-host reboot recovery remains pending without separate reboot
authorization (6.5). Existing `add-managed-udp-relay` acceptance is unchanged.
The change remains unarchived.

## Deployment preparation — 2026-10-16

Operator authorized completing verification and deploying direct/Selectel WireGuard while preserving AWG. Fresh DNS and pinned SSH reached the expected VPN/relay hosts. Fresh baseline has 10 peers on each AWG Instance; AWG3 Panel metadata confirms 10 active peers and newer creation timestamps. The historical count of 7 is superseded, not an unexplained peer loss.

A complete real Linux engine matrix passed on four renamed disposable containers: standard kernel WireGuard, AmneziaWG Legacy, AWG2 and AWG 3.1. All were detected with the expected adapter/protocol and safe mutation capabilities using temporary published ports. The first run exposed tool-name dependence for Legacy, fixed and covered by a Go regression test. Fixture containers were removed; discovery used isolated Helper state and did not mutate existing configurations. Result evidence: `/root/awg-control-wireguard-20261016T182048Z/matrix-result.json`. Task 2.1 is complete.

Consistent pre-migration SQLite backup: integrity ok, zero FK violations, schema 6. External master key separately protected under `/root/awg-control-key-backups/`; no content collected. Original Helper/image/settings and root-only AWG snapshots are in `/root/awg-control-wireguard-20261016T182048Z`. Release is prepared in an isolated managed worktree from origin/main; unrelated original dirty files remain untouched. Deployment results follow separately.

## Live deployment result

See [the deployment report](../../../docs/wireguard-deployment-2026-10-16.md)
for release commit/tag/digests, signature verification, backup/rollback scope,
test vantage points, preserved AWG evidence and remaining network/router gates.
Tasks 6.1–6.3 are complete. Task 6.4 is deliberately left to the operator; task
6.5 remains open for separately authorized shared Selectel-host reboot recovery.
All disposable peers were revoked and temporary maintenance sessions removed.
