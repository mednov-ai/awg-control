# AWG Control Agent Notes

## Product Context

AWG Control is an independent, universal self-hosted administration panel for existing AmneziaWG installations. It manages VPN users, device connections, one-time client configuration/QR issuance, traffic, expiry, quotas, and multiple servers.

This repository is separate from Play&Say. Do not add AWG Control code or documentation to the Play&Say repositories, and do not introduce a runtime dependency on Play&Say infrastructure. The Play&Say VPS is only the first compatibility pilot.

The canonical product contract is:

- `/Users/evgeniymednov/Documents/Projects/AWGControl/spec.md`

Read `spec.md` before changing product behavior, architecture, persistence, API, helper RPC, installation, security, or operations. Update it in the same change whenever implementation behavior changes.

## Non-negotiable Product Decisions

- Web: React + TypeScript.
- API: Node.js 24 + TypeScript + Fastify.
- Storage: SQLite in WAL mode through `better-sqlite3`.
- Node helper: static Go binary named `awgctl`.
- Delivery: one multi-arch Panel image plus signed amd64/arm64 Helper binaries.
- Panel installation: Docker Compose, bound to `127.0.0.1:8080` by default.
- Node transport: restricted OpenSSH forced-command; never mount a remote Docker socket into Panel.
- Supported v1 adapters: AmneziaWG Legacy and AWG2.
- Local and hub modes use the same SSH/helper boundary.
- Only administrators use the v1 UI.
- Client config and QR are issued once. Never persist a client private key.
- Existing imported peers start in observed/read-only mode.
- Configuration mutations use lock, snapshot, validation, no-restart apply, verification, and rollback.
- Expiry and quotas are enforced locally by a systemd timer even when Panel is offline.
- Uninstall must not remove Amnezia containers or VPN peers.

Do not silently weaken these decisions. If a change is necessary, document the motivation, migration, security impact, and acceptance tests in `spec.md` first.

## Intended Repository Layout

Keep clear boundaries as the repository is scaffolded:

```text
AWGControl/
├── AGENTS.md
├── spec.md
├── README.md
├── LICENSE
├── apps/
│   ├── api/                 # Fastify API, worker, SQLite migrations
│   └── web/                 # React administrative UI
├── packages/
│   ├── contracts/           # OpenAPI-derived/shared TypeScript contracts
│   └── config/              # Shared lint/build configuration
├── cmd/
│   └── awgctl/              # Go helper entrypoint
├── internal/                # Go helper adapters and transaction logic
├── deploy/
│   ├── compose/             # Docker Compose distribution
│   └── systemd/             # Helper timer/service templates
├── scripts/                 # Install, upgrade, backup, and verification tools
├── docs/                    # Operator and security documentation
└── .github/workflows/       # Test, build, scan, sign, release
```

Do not place TypeScript backend code in the Go helper tree or give the web application direct SSH/configuration access. API contracts should be explicit and versioned; UI types should be generated or imported from the contract package rather than duplicated manually.

## Engineering Rules

- Prefer small modules with typed inputs and stable error codes.
- Validate every API and helper RPC boundary. Reject unknown fields in privileged requests.
- Never build shell commands from request strings. Use fixed operations and argument arrays.
- Treat container names, interfaces and paths discovered on a Node as untrusted. Convert them to opaque IDs and revalidate before use.
- Preserve unknown AWG configuration fields and comments in parser round-trips.
- Use UUIDv7 identifiers and UTC timestamps.
- Every mutation must accept an idempotency/operation ID.
- Database schema changes require a numbered migration, migration test, backup behavior, and an updated `spec.md` model.
- API changes require OpenAPI updates and compatibility tests.
- Helper RPC changes require protocol versioning and tests against the current and previous supported minor version.
- All UI text and accessible labels must support Russian and English.
- Add tests for every bug involving configuration mutation, rollback, secrets, traffic counters, quota enforcement, or migrations.

## Secret and Privacy Rules

Never print, return in ordinary logs, commit, upload, or include in fixtures/screenshots:

- SSH private keys;
- AWG/WireGuard client or server private keys;
- preshared keys;
- complete client `.conf` payloads;
- QR payloads or screenshots containing them;
- access tokens, passwords, recovery codes or TOTP secrets;
- kubeconfig or Kubernetes Secret values;
- full `wg showconf`, `awg showconf`, `wg show all dump`, server config, `clientsTable`, environment dump, or unrestricted `docker inspect` output from a real server.

Documenting a local path to an SSH key is allowed; reading, copying, displaying or committing the key content is not.

Client private keys exist only transiently during new Connection issuance. They must not be stored in SQLite, Panel backups, Node journals, audit events, analytics, error tracking, test snapshots, browser persistence, or server logs. If issuance is lost, create a replacement Connection and revoke the old one.

Transport private keys used by Panel to reach Nodes are a separate secret class. Store them encrypted with AES-256-GCM and a master key mounted outside the SQLite volume. Never add a plaintext fallback.

## Play&Say Pilot Server

These facts were verified read-only on 2026-07-16. Recheck them before every pilot or operational change because server state can change.

| Item | Verified value |
| --- | --- |
| Public domain | `play-and-say.ru` |
| Current DNS A record | `89.124.113.223` |
| SSH target | `root@89.124.113.223` |
| Hostname | `v646888.hosted-by-vdsina.com` |
| Host services | `nginx`, `docker`, `k3s` active |
| Legacy container | `amnezia-awg`, image `amnezia-awg`, UDP `31119` |
| AWG2 container | `amnezia-awg2`, image `amnezia-awg2`, UDP `41016` |
| Container mounts | Only `/lib/modules:/lib/modules` was present on both AWG containers |

The checked runtime and the current Play&Say runbook/DNS are authoritative for the pilot. If any older note contains another VPS address, do not use it without a new DNS and SSH verification.

### SSH Access

Use the existing operator key only for explicit bootstrap or diagnostics:

```bash
ssh -i /Users/evgeniymednov/.ssh/play_and_say_vps_ed25519 \
  -o IdentitiesOnly=yes \
  root@89.124.113.223
```

Do not copy this private key into AWG Control, a container, CI, the repository, logs, or chat. Production Panel runtime must use its own restricted key and the `awg-control-agent` forced-command account described in `spec.md`; it must never reuse the root operator key.

Before trusting an address, perform read-only DNS and SSH host-key verification. A changed host key is a hard stop requiring operator confirmation, not a warning to bypass.

### Safe Read-only Checks

Use narrowly scoped output. These commands do not expose VPN configuration contents:

```bash
dig +short A play-and-say.ru
```

```bash
ssh -i /Users/evgeniymednov/.ssh/play_and_say_vps_ed25519 \
  -o IdentitiesOnly=yes \
  root@89.124.113.223 \
  'hostname; systemctl is-active nginx docker k3s; docker ps --format "{{.Names}}|{{.Image}}|{{.Ports}}"'
```

Do not turn a diagnostic into a mutation. Avoid broad commands that dump environment variables, complete Docker metadata, VPN configs, peer dumps, Kubernetes secrets, or command histories.

## Hard Operational Constraints on Play&Say

- Do not stop, restart, recreate, rename, upgrade, or remove Docker, Amnezia containers, nginx, or k3s without separate explicit permission.
- Do not overwrite the existing `play-and-say.ru` nginx site or change its routing/firewall as part of AWG Control bootstrap.
- Do not bind Panel publicly without authenticated TLS reverse proxy protection.
- Do not mount `/var/run/docker.sock` into Panel.
- Do not edit an AWG config before discovery, adapter confirmation, source fingerprint, and root-only snapshot.
- Do not use container restart as an apply mechanism.
- Do not mutate existing peers during the first discovery/import.
- Do not adopt an imported peer into management implicitly.
- Do not remove any existing peer when testing create/revoke; operate only on the disposable peer created for that test.
- Do not uninstall Amnezia or delete its data when removing AWG Control.
- If the detected server state differs from this document, stop mutations, report the difference, and update documentation only after the actual state is understood.

Any command that can interrupt current VPN users or the Play&Say site requires an explicit operator decision and a rollback plan.

## Pilot Sequence

The initial Play&Say rollout is deliberately staged:

1. Recheck DNS, SSH host key, hostname, services, containers, images, ports and mounts with read-only commands.
2. Install Helper with dry-run output first; inspect every proposed file and permission.
3. Install only the root-owned helper, restricted `awg-control-agent` account, forced key, sudo rule, state directory and systemd enforcement timer.
4. Run read-only discovery for Legacy and AWG2.
5. Import peers as `observed`; compare only counts and safe public-key fingerprints.
6. Verify no restart/time change for nginx, Docker, k3s and both AWG containers.
7. Create and verify a root-only snapshot before the first mutation.
8. Obtain explicit approval for the mutation phase.
9. Create one disposable Connection, deliver its config once, and test handshake/traffic.
10. Revoke only that disposable Connection.
11. Verify all pre-existing peers, services and containers remain unchanged and healthy.
12. Test rollback and uninstall safety on a disposable fixture before broad management is enabled.

If any step fails, stop expanding scope. Preserve the original AWG state, collect redacted diagnostics, and use the transaction rollback path.

## Testing and Completion

Before considering a change complete, run the relevant subset of:

- TypeScript lint, typecheck, unit and API contract tests;
- React component and browser smoke tests;
- Go format, vet, unit and race tests;
- parser round-trip fixtures for both Legacy and AWG2;
- helper transaction tests for conflict, validation failure and rollback;
- SQLite clean migration and previous-version migration/restore tests;
- security tests for forced-command escape, injection, log redaction, CSRF and one-time issuance;
- Docker Compose install/upgrade/uninstall tests on amd64 and arm64 where applicable.

For Node-facing work, completion also requires evidence that:

- discovery is non-mutating;
- no secret appeared in output or artifacts;
- no existing service/container restarted;
- config fingerprint conflicts fail closed;
- failed mutations roll back;
- uninstall leaves Amnezia and peers intact.

Update `spec.md`, operator documentation, OpenAPI/RPC contracts and migrations together with the implementation they describe. Do not report a live-server result without a fresh, narrowly scoped verification.
