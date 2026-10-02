# Local verification — 2026-10-02

Implementation and local verification are complete. The sections below record
the initial verification and subsequent delivery work separately. Task 4.1 is
complete; tasks 4.2–4.3 remain open until live deployment and client evidence are
recorded.

## Passed

- Node.js 24.21 / pnpm 11.9.0 in the Docker build environment: lint, shared
  contracts build, recursive TypeScript typecheck and tests for contracts, API
  and Web. Tests cover migration/restore, purpose-bound transport encryption,
  strict authenticated API/OpenAPI boundaries, uncertain-operation reconciliation,
  idempotency and one-time issuance, endpoint-only transformation and decoded
  Amnezia import, component close behavior and RU/EN relay management.
- `go vet ./...`, `go test -race ./...`, Go formatting, `bash -n scripts/*.sh`,
  `git diff --check`, and `openspec validate add-managed-udp-relay --strict`.
- Disposable Ubuntu 24.04 relay fixture with real nginx UDP: eight concurrent
  clients, 64/1280/8192-byte datagrams, multiple responses, reconnect with new
  client ports, route reload, occupied-port failure with rollback, disable,
  removal and uninstall. Both linux/amd64 and linux/arm64 Helper binaries build;
  the UDP runtime fixture executes on amd64.
- Installer dry-run preserves files and rejected signature verification prevents
  writes. These installer cases use a mock verifier; they do not prove that a
  published signed release exists. The runtime fixture uses a systemctl process
  shim and validates the unit with systemd-analyze; full boot/reboot is pending.
- Panel Docker build and Compose install/upgrade/backup/restore/uninstall fixture,
  on isolated host port 18081. Fixture containers and volumes were removed.
- Browser smoke of the built relay administration page against synthetic
  metadata: navigation, status, registration form and lifecycle actions. No client
  configuration or QR payload was captured. Issuance variants are covered by
  automated component/encoding tests, not real-device acceptance.

## Open gates

The initial dependency audit failed with ten findings (six moderate, four high).
The subsequent apply run resolved them through compatible patch updates:
Fastify 5.12.5, fast-uri 3.1.8 / 4.1.5 and brace-expansion 1.1.21 / 5.0.12.
The API minimum Fastify version and targeted pnpm overrides/lockfile were updated.
The final Node 24.21 / pnpm 11.9.0 frozen-lockfile Docker build, lint, recursive
typecheck and contracts/API/Web tests passed; audit reports no known
vulnerabilities. Go vet/race, formatting and shell syntax also passed.
OpenSpec strict validation passed. A repeated host git diff/status check stalled
and was stopped; dependency manifest whitespace was checked directly. The
earlier git diff check evidence above belongs to the initial implementation run.

The Selectel address and operator access details are now recorded in design.md;
stored host-key verification and read-only inventory succeeded. Live acceptance
still requires reviewed bootstrap/network scope. Then verify
full systemd boot/reboot, actual AWG 3.1 direct and relay client handshakes,
bidirectional traffic and the existing VPN server's exit IP, idle/reconnect, and
before/after preservation of existing peers, services and containers. A listener
or healthy Panel is not evidence of a working VPN tunnel.

## Subsequent apply preflight — 2026-10-02

Fresh strict host-key SSH checks on `139.100.236.101` verified hostname `cece`,
linux/amd64 and these unchanged existing processes across the checks:

| Service | State | PID | Active since (UTC) |
| --- | --- | --- | --- |
| nginx | active | 550 | 2026-09-27 17:14:46 |
| repairdevice | active | 105113 | 2026-10-01 14:22:38 |

Docker and awg-control-relay units are absent. awgctl, cosign and the nginx stream
module are absent. No UDP 47300 listener was present; existing UDP listeners were
loopback DNS/chrony only. iptables INPUT policy is ACCEPT, ufw is absent, and no
nft tables were listed. Cloud firewall rules have not been verified. A read-only
apt simulation proposes adding libnginx-mod-stream only (zero upgrades/removals).
No packages, accounts, keys, files, firewall rules or services were changed.

GitHub's latest release is v0.4.7; its source has no `ssh-relay-rpc` entry point.
Consequently it cannot be used for the planned bootstrap. A new signed release
is required. The GitHub `v1-release` environment exists but its protection_rules
array is empty, while AGENTS.md requires preserving the environment review gate.
The operator subsequently removed this requirement from AGENTS.md on 2026-10-02
and resumed apply; operator documentation was reconciled accordingly. This
reviewer discrepancy no longer blocks publication. Signature and artifact
verification remain required. No unsigned Helper or locally built image was
installed as a substitute.


## Signed delivery preparation — 2026-10-02

The feature and compatible security patches were published on main. Initial CI
37039028612 failed because the three new relay scripts were omitted from the
release commit. The v0.4.8 Release run was cancelled before publication; v0.4.8
was not installed. The missing scripts were committed, the Release verify job
now runs the UDP lifecycle fixture before signing, and master-key rotation now
includes encrypted relay credentials in its atomic transaction.

Commit `cb3844edcbb2387980bff20cc35dee1de06ed734` (v0.4.9) also makes CLI-created
SQLite backups mode 0600. CI 37039653304 and 37040139961 passed, including real
UDP lifecycle, Go race, TypeScript and packaging checks. Release 37040434735
passed verification and signed both Helper architectures; image build and final
publication were still pending at this checkpoint. Unrelated Dependabot PR #11
failed lint because TypeScript 7.0.2 is unsupported by its typescript-eslint;
that branch is not part of v0.4.9.

Selectel package preparation installed only libnginx-mod-stream
1.24.0-2ubuntu7.18. A temporary operator service policy suppressed the package
nginx reload and was removed afterwards. nginx PID 550 and RepairDevice PID
105113 retained their start times; nginx configuration validation passed.
Official cosign 3.1.3 was installed after vendor checksum verification. No relay
account, runtime key, listener or firewall mutation occurred at this checkpoint.

On the VPN host, a consistent CLI SQLite backup was checked (schema 5, integrity
OK, no foreign-key violations), protected as 0600 and retained under the root-only
`/root/awg-control-backups/relay-v0.4.8-20261002` directory with the external
master key, previous Compose file and Helper binary. The v0.4.8 label identifies
the initial candidate; the backup belongs to the running v0.4.7 schema 5 Panel.
Its previous image digest is
`ghcr.io/mednov-ai/awg-control@sha256:cbb4fccf390acf09443a9855c77947118eb446d76d8f19aca214cd0547db1d85`.
Read-only Helper list captured only safe fingerprints, config fingerprints and
counts (6 and 10) for the two existing Instances. Before/after comparison remains
required. No client secrets were collected.


## v0.4.9 delivery and first-install correction

Release 37040434735 completed successfully and published all eight Helper assets.
The Panel manifest digest is
`sha256:b1b00919ff805341f616f25e55cf2f51f2743eae8411b37e1b6a3e845a2c0f5c`.
Both the image and downloaded amd64 Helper passed exact v0.4.9 workflow identity,
OIDC issuer and transparency verification; Helper checksum matched. A fresh
root-only backup `relay-v0.4.9-20261002` was verified at schema 5 before upgrade.

Only the VPN Helper binary and Panel service were updated. Compose 1.29.2 hit
its known ContainerConfig error; removing only the resolved stopped Panel
container and running service-only up recreated it with its original named
volume and external key. Migration 0006 succeeded, database integrity was OK,
foreign-key violations were absent, readiness returned 200, and post-upgrade
peer/source fingerprint snapshots exactly matched the baseline (counts 6/10).

A dedicated relay transport key was generated only inside Panel memory and
persisted encrypted through the repository; only its public key was transported
to Selectel. Registration used an atomic operator idempotency/audit transaction.
The published signed bootstrap passed dry-run review and installed only the
relay Helper, forced-command account/public key, sudo rule and root-only state.

The first service install failed closed with RELAY_VALIDATION_FAILED before
configuration/unit installation. A synthetic nginx diagnostic confirmed that
nginx -t tries to open the configured pid file before systemd has created
RuntimeDirectory. The fixture had incorrectly pre-created that directory.
The correction validates with a private temporary pid/config, retains the
production template unchanged and removes that temporary workspace afterwards.
The fixture now starts without RuntimeDirectory and creates it only on simulated
systemd start. Go race/vet and the corrected real-nginx UDP lifecycle passed.
No relay service is installed yet; existing nginx/RepairDevice stayed unchanged.
