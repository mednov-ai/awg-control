## Context

See proposal.md. The Helper owns VPN mutation privileges; the Panel has restricted SSH only. Client secrets are transient. Existing discovery does not expose its known UDP port to Panel metadata.

### Selectel pilot target

The operator selected this existing server. A read-only SSH check in this session
on 2026-10-02 succeeded with BatchMode and StrictHostKeyChecking enabled; the
server matched the locally stored host key.

| Item | Verified value |
| --- | --- |
| Public IPv4 / SSH port | `139.100.236.101:22` |
| Local SSH alias | `repairdevice-selectel` |
| Operator user | `root` |
| Operator key path | `/Users/evgeniymednov/.ssh/repairdevice_selectel_ed25519` |
| Hostname | `cece` |
| OS | Ubuntu 24.04.5 LTS |

The subsequent read-only apply preflight confirmed linux/amd64, active nginx and
RepairDevice, no Docker or relay unit, no installed awgctl or stream module, and
no listener on UDP 47300. Host iptables INPUT policy is ACCEPT; no nft tables
were listed and ufw is absent. Selectel cloud firewall remains unverified.
An apt simulation proposes adding only libnginx-mod-stream, with no upgrades or
removals. cosign is absent. Recheck the host key and inventory before bootstrap;
this host is shared with existing workloads. Preserve those workloads and keep
the relay's nginx process/configuration/unit separate. Review package hooks before
installing the stream module so that the existing nginx is not restarted/reloaded.

The operator key is for bootstrap/diagnostics only. Never copy its contents into
Panel, repository or artifacts. Panel runtime must use its own transport key and
the `awg-control-relay-agent` forced-command account. The target address is pilot
deployment metadata, not a hardcoded product default. SSH access verification
does not establish relay readiness or authorize service/firewall changes.

## Goals / Non-Goals

Deliver a separately privileged relay and direct/relay variants for newly issued AWG 3.1 peers. VM creation, automatic cloud firewall changes, package upgrades and recovery of previously issued client keys are outside this change.

## Decisions

- Run a dedicated nginx stream systemd service with a fixed template and independent configuration. This avoids changing host forwarding/routing or an existing nginx service. One worker, UDP reuseport, 120-second idle timeout, unlimited response datagrams, no PROXY protocol or payload logging.
- Operator bootstraps a signed awgctl, nginx stream package and relay-only forced-command account. Panel subsequently installs, updates and removes its service/configuration; upgrades of OS packages and the signed Helper use the operator installer.
- Relay RPC is a separate boundary with its own 1.1 version and 1.0 compatibility. VPN RPC remains 1.0 compatible. Relay operations cannot invoke VPN operations.
- Persist relay server, route and operation metadata; encrypt SSH keys with purpose-bound AES-GCM. Routes use numeric public IPv4 endpoints and ports >=1024. One route per Instance and unique listen port per relay; bind all IPv4 interfaces on the dedicated VM.
- Obtain the upstream port from fresh discovery and upstream IPv4 from the registered Node. Require confirmed managed AWG 3.1 support. Never accept a user-supplied upstream, arbitrary path or service name.
- Serialize relay mutations using a host lock, expected configuration fingerprint, durable operation journal and snapshot. Validate nginx before replacement and restore on apply failure. Interrupted/uncertain operations fail closed and require status/reconciliation before further changes.
- Return a snapshot of enabled relay endpoint metadata with issuance, preserving it in the open window even if settings change. Browser replaces exactly one Endpoint in exactly one Peer; it does not parse and serialize away unknown config fields.
- Monitoring verifies service/config state, not a working tunnel. A stale/unavailable relay is presented as unavailable; direct issuance remains usable.

## Risks / Trade-offs

- A route update or removal can interrupt clients using that endpoint: require a UI confirmation and record the operation.
- Two variants identify one peer: use alternately on one device, never simultaneously on different devices.
- SSH timeout or Panel commit failure after remote success: retain operation identity, reconcile remote journal/state and prevent success claims until metadata matches.
- Relay loss: existing direct profiles remain available to their holders; no automatic client transport switching.

## Migration Plan

Back up SQLite consistently and protect the master key separately before Panel upgrade. Apply migration 0006; old Instances have an unknown UDP port until fresh discovery. Bootstrap Selectel after inspecting dry-run output, then register, verify, install and apply a route. Validate direct and relayed client handshake/traffic/exit IP before pilot acceptance. Rollback restores the matching pre-migration backup and Panel image; relay rollback affects only its service/configuration.
