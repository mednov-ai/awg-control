# AWG Control

AWG Control is an independent self-hosted administration panel for existing
AmneziaWG Legacy, AWG2 and AWG 3.1 installations. It manages administrators, VPN users,
device connections, one-time client configuration issuance, traffic, expiry,
quotas, and multiple nodes without mounting a remote Docker socket into Panel.

AWG2 and AWG 3.1 may run side by side on one Node when they use separate
containers, UDP ports, VPN subnets and persistent configuration paths. AWG 3.0
is detected but remains read-only until it is migrated to 3.1.

The product contract is [`spec.md`](./spec.md). Security-sensitive behavior must
stay synchronized with it.

## Development

Requirements: Node.js 24, pnpm, Go 1.24+, Docker with Compose v2.

```bash
pnpm install
pnpm check
go test ./...
```

Run Panel locally after creating a 32-byte master key:

```bash
mkdir -p secrets data
openssl rand -out secrets/master-key 32
AWG_CONTROL_MASTER_KEY_FILE=./secrets/master-key \
AWG_CONTROL_DATABASE=./data/awg-control.db \
pnpm --filter @awg-control/api dev
```

In a separate terminal:

```bash
pnpm --filter @awg-control/web dev
```

Never use real VPN configuration, private keys, preshared keys, QR payloads, or
production environment dumps in issues, logs, fixtures, screenshots, or tests.
