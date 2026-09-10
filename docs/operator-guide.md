# Operator guide

## Panel installation

Create the external master key and keep a separate protected backup:

```bash
install -d -m 0700 deploy/compose/secrets
openssl rand -out deploy/compose/secrets/master-key 32
sudo chown 10001:10001 deploy/compose/secrets/master-key
sudo chmod 0400 deploy/compose/secrets/master-key
```

Compose file-backed secrets retain host ownership. UID/GID `10001:10001` is
the fixed unprivileged Panel account inside the image; ownership by that account
allows Panel to read the key without running as root or making it accessible to
other host users. The parent directory remains operator-only.

Set `AWG_CONTROL_VERSION` to the verified release tag and
`AWG_CONTROL_PUBLIC_ORIGIN=https://awg.play-and-say.ru`, then start the
Compose project. The published socket remains `127.0.0.1:8080`; terminate TLS in
an existing nginx, Caddy, or Traefik configuration. Do not expose port 8080
directly to the Internet.

Copy `deploy/compose/.env.example` outside the repository and keep the master
key file owned by `10001:10001` with mode `0400`. Short sessions default to 12 hours. Remembered sessions
default to 30 days absolute and 7 days idle, with activity persisted at most
every 5 minutes. Production trusts one proxy hop because the Docker-published
port is reachable only from loopback nginx; never combine this setting with a
public `8080` bind.

Use `deploy/nginx/awg.play-and-say.ru.conf` as a reviewed template for a new,
dedicated file. It must not replace or edit the existing `play-and-say.ru`
server block. Obtain explicit approval before certificate issuance, enabling
the symlink, or reloading nginx. Validate Panel readiness locally first, then
run `nginx -t` before any reload. Keep `/var/www/awg-control-acme` available as
the dedicated webroot used by both initial issuance and unattended renewal;
the HTTP virtual host serves only that challenge path before redirecting other
requests to HTTPS.

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
discovery, inspect every Instance, import existing peers as `observed`, and only
then explicitly enable Instance management.

## Parallel AWG 3.1 instance

Panel does not install or update Amnezia containers. An operator may deploy AWG
3.1 next to AWG2, provided that the new instance has its own container, UDP
port, VPN subnet and root-only persistent configuration directory. Before the
deployment:

1. snapshot every existing AWG instance and record safe fingerprints, peer
   counts, container IDs and start times;
2. verify the proposed UDP port and VPN subnet are unused;
3. build the engine and tools from pinned, verified AWG 3.1 tags;
4. validate the generated configuration in a disposable container;
5. start only the new container and verify that the existing AWG2 container ID,
   fingerprint, peer count and start time did not change.

After deployment, run read-only discovery. A valid instance appears as adapter
`awg3`, protocol `3.1`, initially in `observed` mode. A configuration identified
as 3.0 or missing mandatory 3.1 fields remains read-only. Enable management only
after the first disposable client has connected successfully and rollback has
been checked.

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

The session schema migration creates its own pre-migration SQLite backup. Keep
that backup with the exact previous image digest. To roll back, disable only
the `awg.play-and-say.ru` nginx symlink, validate and reload nginx, stop Panel,
restore the pre-migration database backup, and start the matching prior image.
Do not downgrade a migrated database in place. This process must not remove the
Helper, stop Docker, or change Amnezia containers or peers.

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
