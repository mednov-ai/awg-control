# Operator guide

## Panel installation

Create the external master key and keep a separate protected backup:

```bash
install -d -m 0700 deploy/compose/secrets
openssl rand -out deploy/compose/secrets/master-key 32
chmod 0600 deploy/compose/secrets/master-key
```

Set `AWG_CONTROL_VERSION` to the verified v1 release tag and
`AWG_CONTROL_PUBLIC_ORIGIN` to the authenticated HTTPS origin, then start the
Compose project. The published socket remains `127.0.0.1:8080`; terminate TLS in
an existing nginx, Caddy, or Traefik configuration. Do not expose port 8080
directly to the Internet.

Create the first administrator without placing its password in argv or shell
history:

```bash
printf '%s' "$PASSWORD" | docker compose run --rm -T panel \
  dist/cli.js admin create --username operator --password-stdin
```

Unset `PASSWORD` immediately. For an interactive production procedure, pipe
from a password manager rather than an environment variable.

## Helper bootstrap

Generate a dedicated Ed25519 transport key for Panel. Store its private part in
Panel only; install only the public part on the Node. Always inspect dry-run
output first:

```bash
sudo ./scripts/install-helper.sh \
  --version 1.0.0 \
  --panel-public-key ./panel_transport.pub \
  --dry-run
```

Run the same command without `--dry-run` only after checking every proposed
path and permission. The installer verifies the checksum and Sigstore bundle.
It does not edit firewall, nginx, Docker daemon, Amnezia containers, or peers.

Register the Node with the freshly verified SSH host-key fingerprint. Run
discovery, inspect both Instances, import existing peers as `observed`, and only
then explicitly enable Instance management.

## Backup and upgrade

Create a consistent SQLite backup:

```bash
docker compose exec -T panel dist/cli.js backup create \
  --output /var/lib/awg-control/operator.backup
```

Back up the external master key separately. Before upgrade, verify artifact
signatures, update compatible Helpers first, update the Panel image tag, and
check readiness plus read-only discovery. Panel supports the current and one
previous Helper minor protocol after such a minor exists.

## Key rotation

Rotate a Node transport key by first adding the replacement public key to the
dedicated account, then piping the private key to `transport-key rotate`. Remove
the old public key only after a successful health check.

To rotate the master key, stop Panel, create another 32-byte file, run
`master-key rotate --new-key-file`, replace the mounted key atomically, and start
Panel. Pending TOTP enrollments are intentionally discarded.

## Release gate

The GitHub `v1-release` environment must have required reviewers. Approve it
only after the Play&Say pilot checklist is complete and its redacted evidence
confirms no restarts, no secret exposure, successful rollback, and no changes to
pre-existing peers. A tag alone must not bypass this environment approval.

## Uninstall

Removing Panel does not remove Helper. Removing Helper does not remove Amnezia
containers, server configs, or unrelated peers. An explicit suspended-peer
decision is mandatory:

```bash
sudo ./scripts/uninstall-helper.sh --restore-suspended
```

Use `--leave-suspended` only when disabled peers must remain disabled; helper
state is retained so the decision is recoverable. `--purge-helper-state` is
accepted only after suspended peers were restored.
