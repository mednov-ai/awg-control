## Purpose

Keep low-level VPN addressing out of the administrator workflow while preventing duplicate client addresses during concurrent Connection issuance.

## ADDED Requirements

### Requirement: Helper allocates a conflict-free client address atomically

The Panel Web application and public connection-issuance API MUST NOT request a VPN
CIDR from the administrator. Helper SHALL select the client address while holding the
selected Instance mutation lock and using the freshly read, fingerprint-verified
configuration.

#### Scenario: Issue a connection from a phone

- **WHEN** an administrator submits an Instance, device name, optional expiry, and optional quota
- **THEN** Helper derives the Instance IPv4 subnet, skips the server and occupied peer ranges, assigns the first free host as `/32`, and returns it only as Connection metadata and inside the one-time client config

#### Scenario: Two connections are issued concurrently

- **WHEN** concurrent create operations target the same Instance
- **THEN** address selection and peer insertion are serialized by the Instance lock and the operations cannot assign the same address

### Requirement: Address allocation fails closed

Helper MUST reject issuance before applying configuration when there is no single
supported IPv4 server subnet, allocation data is malformed, or no free host exists.

#### Scenario: Address pool cannot be allocated safely

- **WHEN** the selected Instance has a missing, ambiguous, malformed, unsupported, or exhausted IPv4 pool
- **THEN** issuance returns a stable non-secret error and leaves the persistent and runtime configuration unchanged

#### Scenario: Browser attempts a manual address override

- **WHEN** a client sends `addressCidr` to the public connection-issuance endpoint
- **THEN** strict request validation rejects the unknown privileged field without calling Helper or mutating the Instance
