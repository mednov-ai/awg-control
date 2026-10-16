# Classic WireGuard and router connections

AWG Control supports a separate classic WireGuard Instance prepared through
AmneziaVPN. It does not turn an AWG 3.1 connection into WireGuard. The router
imports a standard `.conf`; it does not need an Amnezia app or `vpn://` key.
Supported topology is router → VPN Node → Internet, or router → Selectel UDP
relay → the same VPN Node → Internet. Both paths use the VPN Node's exit IP.
Selectel forwards encrypted UDP and holds no VPN keys; it adds no obfuscation.

## Prepare the protocol through AmneziaVPN

Follow [Amnezia's protocol installation instructions](https://docs.amnezia.org/documentation/instructions/install-configure-protocols/).
These are operator actions, separately authorized for the selected server.

1. Recheck the VPN/Panel hostname, SSH host key and service/container inventory.
   The current publication is `wg.cbrgn.mooo.com`; Play&Say DNS selects another
   host and must not be used to locate the VPN Node. A changed SSH key stops work.
2. Record safe container IDs, start times/restart counts, UDP ports, peer counts,
   config fingerprints and public service status. Make root-only snapshots.
   Never copy server/client configs or keys into support output.
3. In AmneziaVPN server settings, open Protocols and add **WireGuard** as a
   separate protocol. Check its separate container, free UDP port, dedicated
   persistent config and subnet. Check that the VPN subnet overlaps neither
   existing VPN ranges nor the router's LAN. Do not reset/reinstall the server
   or replace AWG 3.1. Stop if this app version proposes touching existing AWG.
4. Compare before/after inventory. Existing AWG containers/services/peers/routes
   must be preserved. Review any firewall/NAT changes separately; Panel cannot
   open a cloud firewall or change host forwarding rules.
5. Install the compatible signed VPN Helper, run read-only discovery and verify
   **WireGuard** on its own Instance. Existing peers import as observed. Enable
   management explicitly after checking discovery and snapshot gates.

The initial implementation confirms kernel link kind `wireguard` with active
configuration and standard tooling. Merely finding `wg` or an image name is
insufficient. Userspace/TUN, unavailable probes and partial AWG configurations
remain read-only. The Amnezia config directory `/opt/amnezia/wireguard` is
recognized. Arbitrary config paths are not accepted through public API.

## Issue and import a router profile

Choose a VPN user on the Node and the **WireGuard** Instance. Create a separate
Connection for this router. Save the `.conf` immediately; alternatively import
its standard QR where supported. Both contain a private key. Keep the issuance
window open until saved and do not capture it in screenshots or recordings.
Closing removes the only available copy from the panel. A lost config requires
a replacement Connection and revocation of the old one.

The baseline profile provides IPv4 Internet egress with DNS, MTU 1280 and
PersistentKeepalive 25. Import it into the router's standard WireGuard client.
Set LAN-device routing, client masquerading/NAT and DNS according to the router's
firmware. A downstream LAN network is not announced to the VPN server: this is
an Internet gateway profile, not a LAN-to-LAN/site-to-site connection.

IPv6 egress is outside this profile. Set an explicit IPv6 policy on the router
and its LAN clients so that IPv6 does not bypass the intended VPN policy. Do
not infer all-traffic protection from one IPv4 exit-IP check. Firmware-specific
steps require the actual model, version and LAN subnet; no untested model is
claimed compatible.

## Add the Selectel endpoint

Follow [the relay guide](relay-guide.md). Select the confirmed managed WireGuard
Instance after fresh discovery. Its external port must unambiguously map to the
selected interface's runtime listen port. A different free relay listen port
is required alongside the existing AWG 3.1 route. Keep the AWG route unchanged.
The API derives upstream from the Node and discovery, not arbitrary user input.

New issuance offers Direct and Via Selectel standard `.conf`/QR alternatives.
Only Endpoint changes. They belong to one peer and must be used in turn on one
router, never simultaneously on different devices. There is no automatic
failover; save both profiles during the same one-time issuance. Without a usable
relay, Direct remains available. Previously issued secrets cannot be recovered.

## Upgrade and rollback

VPN RPC 1.1 adds WireGuard with previous 1.0 AWG compatibility. Panel negotiates
using health 1.0 before a request; it never retries a failed mutation as another
protocol. An incompatible Helper cannot manage WireGuard. Relay RPC is separate
and unchanged; do not upgrade its Helper unless necessary.

Migration 0007 extends Instance enums after relay migration 0006. Before upgrade,
verify a consistent SQLite backup with `backup create`, retain the previous
Panel image digest and protect the external master key separately. Check versions
using `schema_migrations`, not SQLite `user_version`. Migration preserves existing
AWG connections, relay associations and the revoked-address reservation index.
Protocol reclassification preserves IDs and resets management to observed.

Rollback across migration restores the matching pre-migration backup and Panel
image. Roll back only the new WireGuard relay route if needed, preserving AWG.
Do not stop Docker/nginx/existing VPN or automatically delete a new Instance that
already has working peers. Panel/Helper uninstall must leave VPN and peers intact.

## Actual router acceptance checklist

Record safe results with UTC timestamps; keep configs, private/preshared keys,
QR and import keys out of artifacts. A service listener or successful import is
not a working tunnel.

- Router model/firmware, LAN subnet and intended routing/IPv6 policy recorded.
- Direct profile: recent handshake, RX/TX increases and bidirectional traffic.
- LAN client: DNS resolution, Internet access and expected VPN Node exit IPv4.
- Selectel profile, used after disconnecting Direct: the same checks, with the
  same expected Node exit IPv4, plus idle and disconnect/reconnect recovery.
- IPv6 policy checked explicitly on a LAN client; no unintended bypass claimed.
- Existing AWG 3.1 route and actual client still work; peer counts/fingerprints,
  container identity/start times/restarts and public services preserved.
- Relay reboot recovery tested only after separate reboot authorization; otherwise
  record it as pending. Never reboot a shared server just to complete this list.
- Disposable peer revoked through the supported transaction; no existing peer
  removed. Acceptance and remaining gaps recorded independently of release health.

## Local checks

Use Node 24 and the pinned pnpm. Run `pnpm check`, Go format/vet/race, migration
and one-time secret tests, `scripts/test-relay-lifecycle.sh` and
`scripts/test-wireguard-lifecycle.sh`. The latter creates only a disposable local
container and network namespace; NET_ADMIN/SYS_ADMIN are fixture-only permissions,
never Panel privileges. A real kernel WireGuard/UDP test cannot establish router
firmware compatibility or production AWG preservation by itself.

## Operator installation source for the pilot

The 2026-10-16 pilot uses AmneziaVPN WireGuard startup logic pinned to commit
`30ff3451c7a0db60f6306582c700ef9fc916a49e`. The operator image updates its old
Alpine 3.15 base to the already available pinned Alpine 3.22 digest, installs
standard WireGuard/iproute2/iptables tools, and mounts a separate persistent
root-only configuration directory. It uses NET_ADMIN with kernel WireGuard;
Amnezia's broad privileged/SYS_MODULE flags and DNS-network attachment are not
needed for this standalone IPv4 Instance. This is an operator installation,
not a new Panel container installer. Existing AWG containers are unchanged.
