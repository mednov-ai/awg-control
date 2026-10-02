## Purpose

Offer direct and Selectel endpoint variants together when issuing a new connection while preserving transient one-time client-secret handling.

## ADDED Requirements

### Requirement: Two variants for one newly issued peer
For an enabled configured AWG 3.1 relay route the issuance window SHALL offer direct and relayed QR, .conf and vpn:// variants. Only the Peer Endpoint MUST differ; each variant MUST describe the same Connection.

#### Scenario: New connection with relay
- **WHEN** a connection is issued for an Instance with an available relay route
- **THEN** both variants are generated locally and preserve all other configuration fields

#### Scenario: Instance without relay
- **WHEN** the selected Instance has no available route
- **THEN** direct issuance remains available and no relay QR is presented

### Requirement: One-time secret handling
Both variants MUST exist only in transient issuance memory and MUST be cleared on close. Neither variant SHALL be persisted in database, logs, caches, browser storage or snapshots. A repeated successful issuance MUST return metadata and CONFIG_ALREADY_ISSUED only.

#### Scenario: Close and repeat
- **WHEN** an administrator closes issuance and repeats the successful operation
- **THEN** neither previous config variant can be obtained again

### Requirement: Clear device and endpoint guidance
The UI SHALL distinguish both endpoints in Russian and English and SHALL explain that the two profiles are alternatives for one device.

#### Scenario: View alternatives
- **WHEN** both variants are shown
- **THEN** their endpoint labels and single-device guidance are visible
