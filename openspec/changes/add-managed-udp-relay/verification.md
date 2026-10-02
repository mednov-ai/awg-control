# Local verification — 2026-10-02

Implementation is complete locally. No server was bootstrapped or changed and
no release, commit or deployment was created. Task 4.1 is now complete;
tasks 4.2–4.3 remain open for signed delivery and live pilot evidence.

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
