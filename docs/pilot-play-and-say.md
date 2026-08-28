# Play&Say pilot runbook

The pilot is a compatibility target, not a product dependency. Every run needs
fresh evidence; values in repository notes are not permission to mutate.

## Read-only gate

1. Run `scripts/pilot-readonly-check.sh` and stop on a DNS or SSH host-key
   mismatch. Never bypass a changed host key.
2. Record only hostname, service active states, container names/images/ports,
   and narrowly scoped mount facts. Do not collect environment dumps, Docker
   inspect output, VPN configs, peer dumps, or secrets.
3. Run the Helper installer with `--dry-run`; review all files, owners, modes,
   the forced command, sudo rule, and systemd units.
4. After installation, run discovery for Legacy and AWG2. Compare peer counts
   and public-key fingerprints only. Import everything as `observed`.
5. Verify nginx, Docker, k3s, and both AWG containers have not restarted.

## Mutation gate

Stop and obtain a separate operator approval. Before approval, do not enable
Instance management and do not call create, suspend, resume, revoke, or policy
apply.

After approval, create one disposable Connection, deliver its config once,
verify handshake and counters, and revoke only that Connection. Verify all
pre-existing peers and services remain unchanged. Any fingerprint conflict,
validation failure, rollback failure, restart, or unexplained state change ends
the pilot immediately.

