## Purpose

Publish the loopback-bound AWG Control Panel through a dedicated authenticated HTTPS origin while preserving the existing website and VPN services on the VPS.

## ADDED Requirements

### Requirement: Panel uses a dedicated HTTPS origin
The production Panel SHALL be served at `https://awg.play-and-say.ru`. Plain HTTP for that hostname MUST redirect to HTTPS, and the Panel container MUST remain bound only to `127.0.0.1:8080`.

#### Scenario: Public mobile access
- **WHEN** a client opens `https://awg.play-and-say.ru`
- **THEN** nginx terminates a currently valid certificate and proxies the request to the loopback Panel endpoint

#### Scenario: Direct Panel port access
- **WHEN** a remote client attempts to connect directly to TCP port 8080
- **THEN** the connection is not publicly reachable

#### Scenario: Plain HTTP access
- **WHEN** a client requests `http://awg.play-and-say.ru`
- **THEN** nginx redirects to the equivalent HTTPS URL without including credentials or session data

### Requirement: Reverse proxy preserves the Panel security boundary
The nginx virtual host MUST send the original host and scheme through trusted proxy headers, MUST limit request bodies consistently with the Panel, and MUST proxy only to the fixed loopback Panel endpoint. The Panel MUST trust proxy metadata only from the local reverse proxy and MUST validate unsafe request origins against `https://awg.play-and-say.ru`.

#### Scenario: Correct forwarded request
- **WHEN** nginx forwards a request for the configured Panel hostname
- **THEN** the Panel observes the HTTPS public origin and can set secure same-origin cookies

#### Scenario: Forged forwarding headers from an untrusted source
- **WHEN** a client attempts to supply its own forwarded host, scheme, or address outside the trusted proxy boundary
- **THEN** those values cannot bypass Origin validation, cookie security, audit addressing, or rate limits

#### Scenario: Unexpected host or origin
- **WHEN** an unsafe API request uses another Host or Origin
- **THEN** nginx or the Panel rejects it without mutating application state

### Requirement: Existing services remain isolated
Publishing AWG Control MUST NOT replace or modify the existing `play-and-say.ru` and `www.play-and-say.ru` route to `127.0.0.1:3000`, restart or reconfigure AmneziaWG containers, expose the Docker socket, or alter VPN peers.

#### Scenario: Enable Panel virtual host
- **WHEN** the new nginx site is enabled and reloaded after successful configuration validation
- **THEN** the existing website continues to return its previous healthy response and both AWG containers retain their IDs, start times, restart counts, peer counts, ports, and safe configuration fingerprints

#### Scenario: Panel deployment fails
- **WHEN** Panel readiness, certificate issuance, or nginx validation fails
- **THEN** the operator can disable only the Panel virtual host and restore the prior nginx state without changing the website or either VPN instance

### Requirement: TLS lifecycle fails visibly and safely
The Panel hostname MUST have automated certificate renewal and a documented verification procedure. Deployment MUST stop before public enablement if DNS, certificate hostname coverage, nginx syntax, or Panel readiness is invalid.

#### Scenario: Preflight detects invalid state
- **WHEN** DNS does not resolve to the verified VPS, the certificate does not cover the Panel hostname, nginx configuration validation fails, or Panel readiness is unhealthy
- **THEN** public Panel enablement stops and the existing nginx configuration remains active

#### Scenario: Renewal verification
- **WHEN** the operator runs the documented renewal dry run and expiry check
- **THEN** renewal succeeds without stopping the website, Panel, or VPN containers

### Requirement: Deployment evidence is redacted
Operational verification MUST report only service state, response status, certificate metadata, container identity and timing, peer counts, ports, and safe fingerprints. It MUST NOT print server configuration, private keys, preshared keys, session cookies, passwords, TOTP secrets, QR payloads, or complete client configurations.

#### Scenario: Production verification
- **WHEN** the rollout checklist is executed
- **THEN** the resulting evidence is sufficient to prove isolation and health without containing any prohibited secret
