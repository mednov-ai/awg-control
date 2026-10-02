## Purpose

Provide a managed Russian UDP entry point for an existing AWG 3.1 Instance without moving VPN termination or altering existing VPN services.

## ADDED Requirements

### Requirement: Restricted relay management
The Panel SHALL administer registered relay servers through pinned restricted SSH using encrypted transport credentials. Relay RPC MUST reject arbitrary commands, paths, unknown fields and VPN operations.

#### Scenario: Invalid privileged request
- **WHEN** a relay request supplies an arbitrary command or unsupported action
- **THEN** it is rejected before any system change

### Requirement: Transactional route lifecycle
Administrators SHALL install/update the dedicated relay service and apply, disable or remove an AWG 3.1 route with an operation ID and expected fingerprint. Failed changes MUST restore prior configuration. A route MUST use confirmed discovery metadata and MUST NOT restart or alter VPN containers or peers.

#### Scenario: Validation failure
- **WHEN** a new relay configuration fails validation
- **THEN** the previous service and configuration remain authoritative and failure is reported

#### Scenario: Changed configuration
- **WHEN** the actual relay fingerprint differs from the expected fingerprint
- **THEN** the operation fails closed without overwriting the change

### Requirement: Operational status is distinct from tunnel acceptance
The UI SHALL expose relay service availability separately from successful client handshake, traffic and VPN exit-IP verification.

#### Scenario: Service is running
- **WHEN** relay status reports an active service
- **THEN** the Panel does not claim a verified VPN tunnel

### Requirement: Safe removal and compatibility
Uninstall SHALL remove only relay-owned service/configuration and SHALL preserve Amnezia and its peers. Relay RPC SHALL support its current and previous minor versions; existing VPN RPC SHALL remain compatible.

#### Scenario: Uninstall relay
- **WHEN** an administrator removes the relay service
- **THEN** existing VPN configuration and direct connections remain unchanged
