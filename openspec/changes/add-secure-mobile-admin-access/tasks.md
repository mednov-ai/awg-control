## 1. Contract and security model

- [x] 1.1 Update `spec.md` with remembered-session behavior, session management endpoints, dedicated Panel origin, nginx trust boundary, migration/rollback rules, and acceptance tests.
- [x] 1.2 Add shared TypeScript contracts for login options, safe session metadata, session-list/revocation responses, and stable remembered-session/TOTP error codes.
- [x] 1.3 Update the OpenAPI contract and compatibility tests for `rememberDevice`, coarse `deviceLabel`, session inventory, single-session revocation, and all-other-session revocation.
- [x] 1.4 Document the threat model that rejects permanent browser bearer tokens, URL tokens, and JavaScript-accessible session storage.

## 2. Session persistence and migration

- [x] 2.1 Add a numbered SQLite migration for UUIDv7 public session IDs, session kind, device label, idle expiry, revocation time, and supporting indexes without changing hashed cookie credentials.
- [x] 2.2 Add clean-migration and previous-version migration/backup tests proving existing sessions remain valid short sessions and admin relations remain intact.
- [x] 2.3 Implement repository operations for effective expiry, throttled last-activity updates, own-session listing, scoped idempotent revocation, all-other revocation, and retention cleanup.
- [x] 2.4 Add repository tests for absolute expiry, idle expiry, revocation races, cross-admin isolation, idempotent repeats, and cleanup.

## 3. Authentication API

- [x] 3.1 Extend configuration with bounded short, remembered, idle, and activity-write intervals while keeping secure production defaults.
- [x] 3.2 Extend login to validate `rememberDevice` and `deviceLabel`, require successful enabled TOTP for remembered mode, rotate credentials, and set matching secure cookie expiry.
- [x] 3.3 Clear invalid cookies for expired, idle-expired, and revoked sessions without accepting query, fragment, or Authorization-header fallback tokens.
- [x] 3.4 Implement authenticated session-list, revoke-one, and revoke-all-other endpoints with admin scoping, `Idempotency-Key`, rate limits, stable errors, and redacted audits.
- [x] 3.5 Restrict trusted proxy handling to loopback nginx and test canonical origin, forged forwarding headers, Host/Origin mismatch, CSRF, fixation, logging redaction, and login-rate-limit behavior.

## 4. Mobile administrator UI

- [x] 4.1 Add an accessible “Remember this device” control to login and submit a coarse validated device label without storing credentials in browser-accessible storage.
- [x] 4.2 Handle the TOTP-required remembered-session error with a clear route to Settings after a normal login.
- [x] 4.3 Add an active-sessions section to Settings showing the current session, safe metadata, expiry state, revoke-one, and revoke-all-other actions.
- [x] 4.4 Add equivalent Russian and English visible/assistive strings for every new login, expiry, session, error, confirmation, and revocation state.
- [x] 4.5 Add component and mobile-browser tests for login, close/reopen persistence, both expiry boundaries, logout, selective revocation, all-other revocation, loading/error states, and supported narrow viewports.

## 5. Packaging and operator tooling

- [x] 5.1 Update Compose examples and operator documentation for `https://awg.play-and-say.ru`, loopback port 8080, protected master key, session lifetime settings, backup, and rollback.
- [x] 5.2 Add a dedicated nginx virtual-host template that redirects HTTP, terminates TLS, overwrites trusted forwarding headers, limits body size, and proxies only to `127.0.0.1:8080`.
- [x] 5.3 Add read-only preflight/verification steps for DNS, SSH host key, port availability, Panel readiness, certificate hostname/expiry, nginx syntax, renewal dry run, existing website health, and redacted AWG baselines.
- [x] 5.4 Add installation and rollback instructions that affect only the Panel virtual host and never overwrite the existing `play-and-say.ru` site, expose Docker, or touch Amnezia peers.

## 6. Verification and staged rollout

- [x] 6.1 Run TypeScript lint, typecheck, unit/API contract tests, production build, migration/restore tests, browser smoke tests, Go format/vet/race tests, shell validation, and Compose install/upgrade/uninstall tests.
- [ ] 6.2 Create a signed Panel/Helper release and verify image signature, Helper checksums, Sigstore bundles, SBOMs, and current/previous RPC compatibility before server changes.
- [ ] 6.3 Capture a fresh redacted VPS baseline and obtain explicit operator approval before installing Panel, issuing a certificate, enabling the nginx site, or reloading nginx.
- [ ] 6.4 Deploy Panel on loopback, create the first administrator through password stdin, enroll TOTP, enable the separate nginx site only after `nginx -t`, and verify HTTPS readiness.
- [ ] 6.5 Validate short and remembered login from a phone, close/reopen behavior, session inventory, selective revocation, logout, Russian/English UI, and one disposable Connection workflow without exposing its config or QR.
- [ ] 6.6 Compare post-rollout website/nginx/Docker/AWG state with the baseline, confirm no existing service or VPN container restarted and no peer changed, then record redacted evidence and test the Panel-only rollback path.
