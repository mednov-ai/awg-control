# Managed UDP relay

The route is client → Selectel UDP relay → existing AWG 3.1 → Internet.
The existing VPN server terminates encryption and supplies the exit IP. The
relay has no VPN private keys, peer database or AWG container. It sees endpoint
addresses, datagram sizes and timing, as any intermediate network host does.
AWG2 and existing direct profiles are unchanged.

## Prepare the existing Ubuntu 24.04 VM

Record its public IPv4, architecture and operator SSH key path. Verify its DNS
(if applicable) and SSH host key through a trusted operator channel before
connecting. Never bypass a changed host key. Inspect services and occupied UDP
ports without dumping credentials, environment or VPN configurations.

The operator must provide nginx-core, libnginx-mod-stream, iproute2, sudo,
OpenSSH and systemd. Package installation is an operator action: nginx packages
can start their default service, so review port/service effects before installing.
The bootstrap script does not run apt, edit firewalls, or change that service.
The dedicated relay uses a separate nginx process and systemd unit.

Generate a separate Ed25519 transport key for this relay. Install only its public
key on the VM. Register its private key in Panel; Panel encrypts it with the
external master key and does not return it. Do not use the root operator key or
the VPN Node transport key for relay runtime access.

Run the verified release installer on the relay VM, first in dry-run mode:

```bash
sudo ./scripts/install-relay.sh \
  --version VERSION \
  --panel-public-key ./relay-panel.pub \
  --dry-run
```

Inspect all proposed paths and permissions, then run the same command without
`--dry-run`. VERSION is the release version without the `v` prefix. It must be a
release containing relay support, with verified checksums and Sigstore bundles.
The alternate `--binary`, `--checksum` and `--bundle` inputs still require signature
verification. The installer refuses a host with the VPN Helper sudo account.

The bootstrap owns only:

- `/usr/local/sbin/awgctl` (root-owned signed Helper);
- `awg-control-relay-agent`, its restricted authorized key and exact sudo rule;
- `/var/lib/awg-control-relay` (root-only state/journal/snapshots).

The forced command is `sudo -n /usr/local/sbin/awgctl ssh-relay-rpc`. It cannot
invoke the VPN RPC. The installer does not start the relay service. Re-running
it with a newly verified signed binary is the Helper upgrade procedure; OS
package upgrades remain an operator operation.

## Register and configure in Panel

1. Open **Relay servers**, add the SSH IPv4/port, public connection IPv4,
   verified SHA-256 host fingerprint and dedicated transport key.
2. Click **Check SSH and status**, then **Install relay**. Panel writes only
   `/etc/awg-control-relay/nginx.conf` and `awg-control-relay.service`.
3. On the VPN Node, run fresh discovery and explicitly enable management of the
   confirmed AWG 3.1 Instance. Helpers lacking UDP-port discovery must be upgraded
   with the standard signed Node installer before relay route creation.
4. Select that Instance and apply the route. The upstream is its Node's numeric
   public IPv4 and freshly discovered UDP port; the API accepts no arbitrary
   upstream. By default the incoming port matches it, or choose a free port in
   1024–65535. An Instance has one route; each relay listen port is reserved even
   for a disabled route until it is removed.
5. Through the separate reviewed network procedure, allow the selected inbound
   UDP port on Selectel's cloud/host firewall and outbound UDP to the VPN server.
   Retain operator SSH. Panel does not change either firewall.
6. Create a new Connection. Save the direct and relay alternatives during that
   same issuance window. The relay variant uses Selectel's public IPv4 and port.

The two profiles identify the same peer/device. Use them alternately. Create a
separate Connection for a second device. Closing the window forgets both
configurations, QR images and `vpn://` values. Previously issued configurations
cannot be reconstructed by Panel. AmneziaVPN/DefaultVPN uses copied `vpn://`;
AmneziaWG uses QR or `.conf`.

The service binds IPv4, uses one nginx worker, UDP reuseport, a 120-second idle
timeout, unlimited response datagrams and no PROXY protocol. Graceful reload
allows old sessions at most five seconds before closing their worker. Endpoint
removal/changes require confirmation because they interrupt relayed clients.

## Status, reconciliation and rollback

Checks validate pinned SSH, installed files, current nginx worker/listen sockets,
route metadata and the saved fingerprint. Polling runs approximately once per
minute. A check older than two minutes, a mismatch, unavailable service or a
pending/uncertain operation prevents relay endpoint issuance; direct issuance
continues. Status never claims that an AWG handshake or tunnel was verified.
External edits fail closed: revert the unapproved edit before rechecking.

Every mutation has a durable operation ID, request hash and snapshot. A changed
fingerprint is rejected. Validation runs before replacement. An apply/verification
failure stops only the dedicated relay, restores its prior files and restarts it
only if it was previously active, and restores its previous enabled/disabled
boot state. Relay rollback can interrupt relay sessions;
it never restarts nginx's existing service, Docker or an Amnezia container.

If SSH times out or Panel cannot commit metadata after remote success, the
operation remains uncertain and blocks further changes. **Reconcile operation
result** replays the same remote operation ID and checks the current remote
fingerprint before committing metadata. Never repeat an uncertain mutation with
a new ID. A crash-interrupted remote transaction is rolled back on that explicit
mutation/reconciliation request; ordinary status checks do not mutate the host.
If rollback fails, leave management disabled and inspect redacted diagnostics.

**Update service and configuration** reapplies the current managed template and
routes; it is not an OS-package or Helper-binary upgrade. **Uninstall relay service**
stops/disables and removes only the owned unit/config, clears routes and retains
root-only journals for idempotency/recovery. **Delete registration** is allowed
only after a fresh uninstall check and removes Panel relay metadata/credentials.
The bootstrap account/binary may subsequently be removed by the operator on this
dedicated VM; VPN containers/peers are never part of relay uninstall.

## Panel upgrade and pilot acceptance

Migration `0006_udp_relays.sql` adds relay metadata/operations and nullable
Instance UDP-port metadata; it preserves migration 0005's reusable-revoked-address
index. Create/verify a consistent SQLite backup through `backup create`, retain
the previous Panel image digest, and protect the external master key separately.
The master-key rotation command re-encrypts Node, relay and TOTP credentials
atomically; a decryption failure rolls back all changes.
Rollback to a pre-0006 image requires the matching pre-migration backup, not the
newer schema. Unrelated credential notes are excluded from Docker build context.

Local verification:

```bash
pnpm check
pnpm audit --audit-level moderate
go vet ./...
go test -race ./...
bash -n scripts/*.sh
./scripts/test-relay-lifecycle.sh
```

The disposable Ubuntu fixture uses real nginx/UDP and a systemctl process shim;
it checks the real unit with systemd-analyze. Full systemd boot/reboot and real
AWG 3.1 client acceptance remain VM pilot tests. Record actual-client direct and
relayed handshakes, bidirectional traffic, expected exit IP, idle/reconnect and
relay reboot recovery. Do not capture configs, QR or import keys. Verify before/
after VPN container IDs, start times/restarts, peer counts/safe fingerprints and
existing public services. Local builds, listener checks and import success cannot
complete these acceptance tasks. OpenSpec stays open until evidence is recorded.
