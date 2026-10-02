## Why

Administrators need an alternative entry point in Russia for new AWG 3.1 connections while retaining their existing VPN server and exit IP. The Panel currently issues only a direct endpoint.

## What Changes

- Manage a UDP relay on an existing Ubuntu 24.04 Selectel VM through restricted SSH.
- Use `139.100.236.101` as the pilot relay target; operator SSH access was verified read-only on 2026-10-02. Runtime access requires a separate restricted relay key/account.
- Register relay servers, install/update their dedicated service, configure one route per AWG 3.1 Instance, monitor, disable and remove routes.
- Issue direct and relay QR/config/vpn:// variants together from one transient client configuration.
- Add safe discovered UDP-port metadata, versioned relay RPC, encrypted transport credentials and a numbered metadata migration.
- Preserve existing VPN services, peers, one-time issuance and direct access.

## Capabilities

### New Capabilities

- `managed-udp-relay`: Restricted administration and transactional lifecycle of UDP forwarding.
- `relay-connection-issuance`: Two endpoint variants in the one-time issuance window.

### Modified Capabilities

None; the repository currently has no main OpenSpec capability specs.

## Impact

Panel API/SQLite/worker, shared contracts, React issuance and relay administration, awgctl relay mode, bootstrap scripts and operator/security documentation. No VM provisioning, Selectel cloud credentials, AWG2 forwarding or live deployment is included in local implementation.
