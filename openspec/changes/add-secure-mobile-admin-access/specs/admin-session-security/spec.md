## Purpose

Provide convenient mobile administrator access through revocable server-side sessions while preventing reusable browser credentials from becoming permanent, copyable bearer secrets.

## ADDED Requirements

### Requirement: Short and remembered login modes
The Panel SHALL offer a default short login and an explicit remembered-device login. A short login MUST expire no later than 12 hours after creation. A remembered-device login MUST expire no later than 30 days after creation and after 7 consecutive days without authenticated activity.

#### Scenario: Default login from a phone
- **WHEN** an administrator completes password authentication without selecting remembered-device login
- **THEN** the Panel creates a server-side session with an absolute lifetime of at most 12 hours

#### Scenario: Eligible remembered-device login
- **WHEN** an active administrator with TOTP enabled completes password and TOTP authentication and selects remembered-device login
- **THEN** the Panel creates a revocable session with a 30-day absolute expiry and a 7-day idle expiry

#### Scenario: Remembered login without TOTP enrollment
- **WHEN** an administrator without TOTP enabled requests remembered-device login
- **THEN** the Panel rejects the remembered mode with a stable error code, creates no session, and explains that TOTP enrollment is required

#### Scenario: Idle remembered session
- **WHEN** a remembered session has no authenticated activity for 7 consecutive days
- **THEN** the next request is rejected as unauthenticated and the session is no longer usable

### Requirement: Browser session credential protection
The administrative UI MUST authenticate with an unpredictable opaque session credential stored only in a `Secure`, `HttpOnly`, `SameSite=Strict` cookie. The server MUST persist only a one-way hash of that credential and MUST issue a fresh credential after every successful login.

#### Scenario: Successful login rotates the credential
- **WHEN** valid credentials are submitted while an old or attacker-supplied session cookie is present
- **THEN** the Panel ignores that cookie for session creation and returns a newly generated session credential

#### Scenario: Browser code handles a session
- **WHEN** the Web application loads, authenticates, or refreshes
- **THEN** no session credential is exposed to JavaScript, URLs, `localStorage`, or `sessionStorage`

#### Scenario: Expired or revoked session cookie
- **WHEN** a request presents a cookie whose server-side session is expired, idle-expired, or revoked
- **THEN** the Panel rejects authentication and clears the browser cookie without accepting fallback bearer credentials

### Requirement: Permanent browser tokens are prohibited
The Panel MUST NOT provide permanent API tokens, URL tokens, or manually copied bearer tokens as an authentication method for the browser administrative UI.

#### Scenario: Token in URL or Authorization header
- **WHEN** a browser request supplies an administrative token in a query, fragment, or `Authorization` header instead of a valid session cookie
- **THEN** the Panel does not authenticate the request and does not copy the token into logs or redirects

### Requirement: Administrators can inspect and revoke sessions
An authenticated administrator SHALL be able to list only their own active sessions, identify the current session, revoke one selected session, and revoke all sessions except the current one. Revocation mutations MUST accept an idempotency key and MUST be audited.

#### Scenario: List active sessions
- **WHEN** an administrator opens session settings
- **THEN** the Panel returns opaque session identifiers plus current-session status, coarse device label, creation time, last activity time, absolute expiry, idle expiry, and a redacted network address for that administrator only

#### Scenario: Revoke another session
- **WHEN** an administrator revokes one of their other sessions with an idempotency key
- **THEN** that session stops authenticating immediately and a redacted success audit event is recorded

#### Scenario: Revoke all other sessions
- **WHEN** an administrator requests revocation of all sessions except the current one
- **THEN** every other session for that administrator stops authenticating while the current session remains active

#### Scenario: Revoke current session
- **WHEN** an administrator revokes the current session or logs out
- **THEN** the server deletes the session, clears the cookie, and subsequent protected requests require login

### Requirement: Authentication remains same-origin and abuse-resistant
All authentication and session-management requests MUST remain same-origin, reject unknown privileged fields, enforce Origin/CSRF validation on mutations, and apply rate limits to login attempts and session mutations.

#### Scenario: Cross-origin login or revocation
- **WHEN** an unsafe authentication request has an Origin other than the configured Panel origin
- **THEN** the Panel rejects it before credentials or session state are processed

#### Scenario: Repeated invalid login attempts
- **WHEN** a client exceeds the configured login attempt limit
- **THEN** the Panel rate-limits further attempts without revealing whether the username, password, or TOTP was incorrect

### Requirement: Mobile login and session controls are localized
The Web application SHALL expose the remembered-device choice and active-session controls in both Russian and English and SHALL remain usable at supported mobile viewport widths.

#### Scenario: Reopen mobile browser
- **WHEN** an eligible administrator selects remembered-device login, closes the mobile browser, and returns before either expiry
- **THEN** the application restores the authenticated session without displaying or persisting a token in browser-accessible storage

#### Scenario: Localized session management
- **WHEN** the administrator switches between Russian and English
- **THEN** remembered-device, expiry, current-session, and revocation labels are available in the selected language with accessible names
