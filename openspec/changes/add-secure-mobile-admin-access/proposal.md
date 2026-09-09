## Why

AWG Control must be reachable from a phone without repeatedly entering credentials, while remaining safe when exposed through the VPS nginx. A permanent browser bearer token would be difficult to revoke safely and could leak through URLs, browser storage, screenshots, or copied requests, so mobile convenience should be provided by revocable server-side sessions instead.

## What Changes

- Publish Panel on the dedicated same-origin HTTPS endpoint `https://awg.play-and-say.ru`, proxied by nginx only to the existing loopback-bound Panel port, without changing the `play-and-say.ru` site route.
- Add an explicit “Remember this device” login option that issues a revocable 30-day server-side session with a 7-day idle timeout after successful password and enabled TOTP verification.
- Preserve the existing 12-hour session for administrators who do not opt in or have not enabled TOTP.
- Add an active-session screen that identifies the current session and lets an administrator revoke any individual session or all other sessions.
- Rotate and clear browser cookies consistently on login, logout, expiry, idle timeout, and revocation.
- Reject permanent browser API tokens, tokens in URLs, and tokens stored in `localStorage` or `sessionStorage` as authentication mechanisms for the administrative UI.
- Add deployment verification and rollback checks for nginx, TLS, Panel health, mobile login persistence, and isolation from the existing website and VPN containers.

## Capabilities

### New Capabilities

- `admin-session-security`: Password/TOTP login, remembered mobile sessions, idle and absolute expiry, session inventory and revocation, and browser-token prohibitions.
- `panel-publication`: Safe publication of the loopback-bound Panel through a dedicated nginx HTTPS virtual host without affecting the existing site or Amnezia instances.

### Modified Capabilities

None. This repository did not previously contain OpenSpec capability files; the existing product contract remains authoritative until these deltas are applied and synchronized.

## Impact

- API authentication contract, session persistence and migration, cookie handling, audit events, rate limits, and OpenAPI definitions.
- React login and settings UI in Russian and English, including responsive mobile behavior.
- Docker Compose/operator configuration for the public origin and session lifetimes.
- nginx/ACME operator documentation and guarded deployment/rollback scripts or runbook steps.
- Security, migration, API-contract, browser, and live read-only verification tests.
- No change to AWG peer configuration, existing VPN users, Docker socket access, or the existing `play-and-say.ru -> 127.0.0.1:3000` route.
