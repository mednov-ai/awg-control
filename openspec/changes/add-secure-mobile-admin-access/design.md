## Context

See `proposal.md` for motivation. AWG Control already implements local password authentication, optional TOTP, hashed opaque server-side sessions, secure same-origin cookies, CSRF/Origin checks, and a 12-hour configurable session lifetime. Sessions currently have only an absolute expiry and cannot be listed or selectively revoked in the UI.

Read-only verification on 2026-09-09 found `play-and-say.ru` resolving to the AWG pilot VPS. nginx serves `play-and-say.ru` and `www.play-and-say.ru` over HTTPS and proxies them to `127.0.0.1:3000`. `awg.play-and-say.ru` already resolves to the same address. AWG2 remains published on UDP 38829 and AWG 3.1 on UDP 47300. The new Panel route must be an additional virtual host, not a change to the existing site.

## Goals / Non-Goals

**Goals:**

- Make daily administration from a phone require full credentials at most once per remembered-session period while retaining immediate server-side revocation.
- Keep browser authentication same-origin and inaccessible to application JavaScript.
- Publish Panel through a dedicated TLS hostname with narrowly scoped nginx and trusted-proxy configuration.
- Make rollout and rollback prove that the website and both VPN instances remain unchanged.

**Non-Goals:**

- General-purpose API keys, URL access tokens, magic links, OAuth/OIDC, LDAP, or SSO.
- Replacing passwords with passkeys in this change; WebAuthn can be evaluated separately after the first production rollout.
- Sharing authentication with the Play&Say application or adding an AWG route beneath the existing site's path.
- Changing Amnezia containers, peers, ports, subnets, or client configurations.

## Decisions

### Use a dedicated subdomain rather than a path on the existing site

Panel will use `https://awg.play-and-say.ru`, and its container will remain reachable only at `127.0.0.1:8080`. A separate nginx server block avoids SPA base-path changes, cookie-path ambiguity, and accidental coupling to the website at `127.0.0.1:3000`. The nginx change will be additive and validated with `nginx -t` before reload.

Alternatives considered: `/awg-control` on the main hostname risks routing and cookie collisions; exposing `:8080` publicly bypasses authenticated TLS and is prohibited.

### Use revocable remembered sessions instead of a permanent token

`POST /api/v1/auth/login` will accept `rememberDevice` and a validated coarse `deviceLabel`. The existing password/TOTP flow remains authoritative. A remembered session is permitted only when TOTP is enabled and successfully verified, has a 30-day absolute lifetime, and becomes invalid after 7 days without authenticated use. The default remains a 12-hour absolute session.

A permanent token would be a bearer secret with no natural expiry and is likely to leak through copied URLs, screenshots, browser sync, extensions, logs, or local storage. A server-side session provides the same phone convenience while allowing revocation and retaining existing CSRF defenses. Magic links would add an email dependency; passkeys are attractive but add WebAuthn enrollment and recovery work beyond this rollout.

### Extend the session model with non-secret management metadata

A numbered SQLite migration will add a public UUIDv7 session identifier, session kind (`short` or `remembered`), absolute expiry, nullable idle expiry, coarse device label, revocation timestamp, and last activity data. The random cookie credential remains represented only by `id_hash`; it is never returned by the session-list API. Existing sessions migrate as `short` sessions and preserve their current expiry.

The repository will calculate an effective expiry as the earlier applicable absolute or idle boundary. Last activity updates will be throttled to avoid a database write on every asset/API request while still enforcing the 7-day idle limit accurately enough for the contract. Expired and revoked records will be retained only for a short audit/debug window, then cleaned without retaining credentials.

### Add self-service session inventory and revocation endpoints

Add versioned contracts for listing the current administrator's sessions, revoking one session, and revoking all other sessions. Identifiers are opaque UUIDv7 values and are always scoped to the authenticated administrator. Revocation operations use `Idempotency-Key`, stable errors, rate limits, and redacted audit events. Revoking the current session also clears its cookie.

The UI will place active sessions in Settings and add an explicit remembered-device checkbox to Login. All visible and accessible text will be available in Russian and English. Mobile browser smoke tests will cover closing and reopening the browser, idle/absolute expiry, and remote revocation.

### Establish a narrow trusted-proxy boundary

Fastify will trust proxy metadata only from the local nginx hop rather than enabling unrestricted proxy trust. `AWG_CONTROL_PUBLIC_ORIGIN` will be exactly `https://awg.play-and-say.ru`. nginx will overwrite, not append untrusted client forwarding headers, pass the canonical host and HTTPS scheme, and proxy only to `127.0.0.1:8080`. Application rate limiting and audit addresses will therefore use a controlled client-address chain.

The dedicated server block will redirect HTTP to HTTPS, use the existing ACME tooling for a certificate covering the subdomain, apply appropriate security headers, and avoid `includeSubDomains` HSTS changes that could affect unrelated Play&Say hostnames.

## Risks / Trade-offs

- [A stolen phone retains access until idle/absolute expiry] → Require TOTP before remembered sessions, support immediate per-session/all-other revocation, and recommend device lock and remote wipe.
- [Thirty days increases exposure compared with the current 12 hours] → Combine an absolute limit with a 7-day idle limit and keep remembered mode opt-in.
- [Updating `last_seen_at` on every request increases SQLite writes] → Throttle persisted activity updates while enforcing expiry from authoritative stored timestamps.
- [Proxy trust mistakes can spoof client IP or scheme] → Trust only loopback nginx, overwrite forwarding headers, and add integration tests for forged headers and Origin mismatch.
- [Certificate or nginx changes could affect the website] → Use a separate file/server block, preflight DNS/readiness, `nginx -t`, root-owned backup, and post-reload comparison of the existing route.
- [Session metadata can expose network information] → Return only the current administrator's sessions and redact stored/displayed addresses.

## Migration Plan

1. Record a redacted baseline for nginx, the existing website, Panel port availability, Docker services, AWG container IDs/start times/restart counts, peer counts, UDP ports, and safe config fingerprints.
2. Apply and test the numbered session migration against a clean database and a previous-version backup; existing sessions remain valid as short sessions.
3. Deploy the compatible Helper first only if required by the release contract; this feature otherwise changes Panel only.
4. Deploy Panel bound to `127.0.0.1:8080` with the exact public origin and protected master key; create/verify the administrator and enable TOTP before remembered login testing.
5. Obtain a certificate for `awg.play-and-say.ru`, install the separate nginx virtual host, validate with `nginx -t`, and reload nginx without restarting the website, Panel, Docker, or AWG containers.
6. Verify short login, remembered login, browser reopen, session list, selective revocation, logout, CSRF rejection, rate limits, and Russian/English mobile layouts.
7. Re-run the redacted service/VPN baseline comparison and certificate renewal dry run.

Rollback disables only the AWG Control nginx virtual host, restores its previous root-owned nginx file if one existed, and rolls Panel back using the pre-migration SQLite backup plus matching image. It does not remove the Helper or touch Amnezia containers or peers. If rollback occurs after new remembered sessions exist, all sessions created under the new schema are invalidated rather than converted into permanent credentials.
