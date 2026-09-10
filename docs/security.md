# Security model

## Secret classes

- The Panel master key is exactly 32 random bytes mounted read-only outside the
  SQLite volume. Startup fails without it.
- Per-Node SSH transport private keys and TOTP secrets are encrypted using
  AES-256-GCM with purpose-bound associated data.
- Passwords use versioned Node.js `scrypt` parameters with independent salts.
- Client private keys and complete client configs are transient one-time values.

Never collect full VPN configs, `wg/awg show ... dump`, Docker environment
metadata, SSH private keys, preshared keys, QR payloads, session cookies, or TOTP
secrets in logs or support bundles.

## Panel protections

- Same-origin HttpOnly, Secure, SameSite=Strict session cookie.
- Origin verification for every unsafe API request; CORS is not enabled.
- Login rate limiting, strict JSON schemas, CSP, no-store API responses, and
  allowlisted audit details.
- Issuance, TOTP enrollment, and recovery-code responses are never logged or
  placed in the shared React Query cache.

## Node protections

The installer creates `awg-control-agent` without a password. OpenSSH needs its
`/bin/sh` login shell to launch the forced command, but the account has no
interactive shell access: its only authorized key has `restrict` and a forced
command. The sudo rule permits only `/usr/local/sbin/awgctl ssh-rpc`. PTY, forwarding, X11, agent
forwarding, user rc, arbitrary commands, container names, and arbitrary paths
are unavailable at the RPC boundary.

Helper state and snapshots are mode `0700/0600`. Discovery is read-only.
Unknown configuration structures disable mutation capabilities.

## Incident response

1. Stop Panel without touching Amnezia containers.
2. Rotate the affected Node transport key and then the Panel master key.
3. Inspect redacted audit events by `traceId`, `nodeId`, and `operationId`.
4. Do not attach database backups without separately protecting the master key.
5. If a one-time config was exposed, create a replacement Connection and revoke
   the old one; it cannot be reissued.
