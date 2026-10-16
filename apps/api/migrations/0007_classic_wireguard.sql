-- awg-control: foreign-keys-off
PRAGMA legacy_alter_table = ON;

ALTER TABLE instances RENAME TO instances_v6;

CREATE TABLE instances (
  id TEXT PRIMARY KEY,
  node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  adapter TEXT NOT NULL CHECK (adapter IN ('amneziawg-legacy', 'awg2', 'awg3', 'wireguard')),
  protocol_version TEXT NOT NULL DEFAULT 'unknown' CHECK (protocol_version IN ('legacy', '2', '3.0', '3.1', 'wireguard', 'unknown')),
  container_ref TEXT NOT NULL,
  interface_name TEXT NOT NULL,
  config_ref TEXT NOT NULL,
  capabilities_json TEXT NOT NULL,
  source_fingerprint TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'observed' CHECK (mode IN ('observed', 'managed', 'read-only')),
  last_discovered_at TEXT NOT NULL,
  udp_port INTEGER CHECK (udp_port BETWEEN 1 AND 65535),
  UNIQUE(node_id, container_ref, interface_name)
);

INSERT INTO instances SELECT * FROM instances_v6;
DROP TABLE instances_v6;
CREATE INDEX instances_node_idx ON instances(node_id);
PRAGMA legacy_alter_table = OFF;
