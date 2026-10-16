## Purpose

Поддержать стандартные WireGuard-подключения для роутеров через отдельный Instance, установленный средствами AmneziaVPN, с прямым доступом и альтернативным UDP endpoint в Selectel без изменения действующих AWG-подключений.

## ADDED Requirements

### Requirement: Operator-prepared independent WireGuard Instance
The system SHALL support a classic WireGuard Instance installed by the operator through AmneziaVPN alongside AWG 3.1. The preparation procedure MUST require a separate container, UDP port, non-overlapping VPN subnet and persistent configuration, preservation checks and a scoped rollback. Panel SHALL NOT install or upgrade VPN containers.

#### Scenario: WireGuard is absent
- **WHEN** discovery finds AWG 3.1 but no confirmed classic WireGuard Instance
- **THEN** the UI explains that a separate WireGuard protocol installation through AmneziaVPN is required and does not issue an AWG profile as a WireGuard substitute

#### Scenario: Parallel installation
- **WHEN** an operator prepares WireGuard next to an existing AWG 3.1 Instance
- **THEN** only the new Instance is added and existing containers, peers, configuration fingerprints and relay routes remain unchanged

### Requirement: Verified protocol identity and observed import
Discovery SHALL distinguish classic WireGuard from AmneziaWG Legacy, AWG2 and AWG3 using active configuration and positive runtime capabilities, independently of names and image tags. A `wg` binary or absence of AWG fields alone MUST NOT establish classic WireGuard identity. Incomplete, conflicting or ambiguous evidence MUST disable mutation. Newly imported peers SHALL remain observed until explicitly adopted.

#### Scenario: Confirmed WireGuard
- **WHEN** runtime and configuration positively confirm standard WireGuard on an independent Instance
- **THEN** discovery reports adapter `wireguard`, protocol label `wireguard`, its safe UDP endpoint metadata and validated capabilities

#### Scenario: Ambiguous or incomplete AWG
- **WHEN** runtime identity is ambiguous or configuration contains incomplete AWG parameters
- **THEN** discovery does not classify it as writable WireGuard and does not downgrade AWG3 to another writable adapter

#### Scenario: Previously classified Instance
- **WHEN** fresh discovery changes a stored Instance protocol identity
- **THEN** existing connection identifiers and metadata are preserved, management is disabled pending explicit administrator confirmation, and old peers are not implicitly adopted

### Requirement: Standard one-time router configuration
Creating a WireGuard Connection SHALL issue a standard WireGuard `.conf` and QR from one transient client configuration. The profile MUST contain the assigned address, client private key, server public key, endpoint and explicit routing/DNS settings appropriate to the supported IPv4 Internet-egress scenario. It MUST NOT contain AWG-specific fields or executable hooks. The UI SHALL identify the selected protocol and Instance in Russian and English and provide manual router import guidance without claiming support for untested firmware.

#### Scenario: Router profile issuance
- **WHEN** an administrator creates a Connection on a managed WireGuard Instance
- **THEN** a standard profile is offered once with no AWG junk/header-protection fields and no requirement for an Amnezia-specific import format

#### Scenario: Unsupported IPv6 egress
- **WHEN** the supported Instance provides only IPv4 Internet egress
- **THEN** the generated profile does not advertise working IPv6 default routing and the router guidance explains the IPv4 scope and how to avoid unintended IPv6 bypass

### Requirement: Transactional peer lifecycle and local enforcement
WireGuard mutations SHALL use per-Instance locking, fresh source fingerprints, root-only snapshots, validation, no-restart apply, runtime verification, rollback and operation idempotency. Allocation SHALL select the first free IPv4 host as `/32` under the same lock, excluding all existing ranges and retained reservations. Only revoked Connections SHALL release addresses. Local expiry/quota enforcement and safe traffic/handshake reporting SHALL work while Panel is offline. Failure to commit Panel metadata after peer creation MUST compensate the new peer through the supported transaction path.

#### Scenario: Concurrent creation
- **WHEN** two creation operations target the same WireGuard Instance
- **THEN** they serialize and cannot allocate the same reserved address

#### Scenario: Apply or commit fails
- **WHEN** applying a WireGuard mutation fails or new-peer Panel metadata cannot be committed
- **THEN** rollback or compensation removes the failed operation's effects without changing unrelated peers and issuance is not reported as successful

#### Scenario: Panel offline enforcement
- **WHEN** a managed WireGuard Connection expires or reaches its quota while Panel is unavailable
- **THEN** node-local enforcement disables that peer and retains its address reservation

### Requirement: Direct and Selectel endpoint alternatives
For a confirmed managed WireGuard Instance with fresh unambiguous upstream metadata, administrators SHALL manage a route through the existing restricted Selectel UDP relay. A new Connection SHALL offer direct and available relay `.conf`/QR alternatives for the same peer with only `[Peer] Endpoint` changed. The relay MUST NOT terminate VPN or receive VPN keys. Routing SHALL remain client/router → Selectel relay → WireGuard Node → Internet, with the Node's expected exit IP.

#### Scenario: Existing AWG route and new WireGuard route
- **WHEN** a WireGuard relay route is added beside the AWG 3.1 route
- **THEN** it receives a distinct relay listen port, forwards to its own discovered Node UDP port and preserves the existing AWG route

#### Scenario: Ambiguous upstream port
- **WHEN** the matching interface listen port and its externally reachable UDP mapping cannot be determined unambiguously
- **THEN** route application is rejected before mutation with a stable diagnostic instead of selecting an unrelated published port

#### Scenario: One peer with two endpoints
- **WHEN** a new WireGuard Connection has an available relay route
- **THEN** both profiles share keys, address, DNS, AllowedIPs, MTU and keepalive settings and are labeled as alternatives for one device to use in turn

#### Scenario: Relay unavailable
- **WHEN** no usable relay route exists
- **THEN** direct issuance remains available and the UI does not claim a working relayed tunnel

### Requirement: Secret lifetime and compatibility preservation
WireGuard issuance SHALL retain existing no-store, transient-memory, cache exclusion, redaction and close-clearing guarantees. Repeating successful issuance SHALL return metadata and `CONFIG_ALREADY_ISSUED` without secrets. Existing AWG IDs, connections, policies and routes MUST survive migration. VPN RPC SHALL version the new WireGuard contract and support the previous minor without mislabeling WireGuard as Legacy. Older incompatible Helpers SHALL NOT enable WireGuard management.

#### Scenario: Close and retry
- **WHEN** an administrator closes issuance and retries its successful operation ID
- **THEN** neither direct nor relay client secret can be retrieved from Panel, Helper journal or browser storage

#### Scenario: Existing installation upgrade
- **WHEN** a database with AWG connections, retained addresses and relay routes is upgraded
- **THEN** all identifiers, foreign keys, policies, counters and route associations remain valid and only revoked addresses are reusable

#### Scenario: Previous Helper protocol
- **WHEN** a previous-minor VPN client communicates with the new Helper
- **THEN** supported AWG operations retain their prior contract and WireGuard is not exposed as a writable legacy Instance

### Requirement: Actual router acceptance
Completion of WireGuard tunnel acceptance SHALL require evidence from the actual router for direct and relayed profiles used sequentially: handshake, bidirectional traffic, LAN-client DNS/Internet access under the router's intended routing policy, expected Node exit IP and idle/reconnect recovery. Service health or successful profile import MUST NOT satisfy this requirement. Evidence MUST exclude configs, QR images and keys.

#### Scenario: Relay service active
- **WHEN** relay service health is successful but actual-router traffic or exit IP is unverified
- **THEN** the acceptance task remains open

#### Scenario: Both paths verified
- **WHEN** actual-router tests confirm both endpoint alternatives, idle/reconnect behavior and preservation of existing VPN services
- **THEN** acceptance records the tested router model/firmware, timestamps and redacted results separately from build and deployment status
