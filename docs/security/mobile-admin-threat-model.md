# Mobile administrator authentication threat model

AWG Control uses revocable server-side sessions for the browser UI. The browser receives an unpredictable credential only in a `Secure`, `HttpOnly`, `SameSite=Strict` cookie; SQLite stores only its one-way hash. A separate UUIDv7 identifies a session in management APIs and is not an authentication credential.

Remembered sessions are opt-in, require a successful TOTP check, expire absolutely after at most 30 days, and expire after at most 7 days without authenticated activity. Administrators can list their own safe session metadata and revoke one or all other sessions immediately. Device labels are coarse and validated; displayed network addresses are masked.

The following alternatives are intentionally rejected:

- permanent or manually copied browser bearer tokens, because theft provides unbounded access and revocation is commonly delayed;
- tokens in URLs, query strings, or fragments, because they leak through history, screenshots, referrers, logs, bookmarks, and sync;
- credentials in `localStorage` or `sessionStorage`, because application JavaScript and successful XSS can read them;
- accepting an `Authorization` header as a browser-session fallback, because it creates a second, easier-to-leak authentication path.

The production trust boundary is `https://awg.play-and-say.ru` through a dedicated nginx virtual host to `127.0.0.1:8080`. nginx overwrites forwarding headers. Panel trusts exactly one local proxy hop and checks every unsafe API request against the configured origin. Direct public access to port 8080 is prohibited.

Residual risks include an unlocked or compromised remembered device, malicious browser extensions, and compromise of the Panel host. Mitigations are device lock/remote wipe, short idle and absolute limits, TOTP eligibility, immediate server-side revocation, rate limits, CSRF/origin checks, redacted audit data, encrypted application secrets, and least-privilege host access.
