-- awg-control: foreign-keys-off
PRAGMA legacy_alter_table = ON;

ALTER TABLE instances RENAME TO instances_v2;

CREATE TABLE instances (
  id TEXT PRIMARY KEY,
  node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  adapter TEXT NOT NULL CHECK (adapter IN ('amneziawg-legacy', 'awg2', 'awg3')),
  protocol_version TEXT NOT NULL DEFAULT 'unknown' CHECK (protocol_version IN ('legacy', '2', '3.0', '3.1', 'unknown')),
  container_ref TEXT NOT NULL,
  interface_name TEXT NOT NULL,
  config_ref TEXT NOT NULL,
  capabilities_json TEXT NOT NULL,
  source_fingerprint TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'observed' CHECK (mode IN ('observed', 'managed', 'read-only')),
  last_discovered_at TEXT NOT NULL,
  UNIQUE(node_id, container_ref, interface_name)
);

INSERT INTO instances(
  id, node_id, display_name, adapter, protocol_version, container_ref,
  interface_name, config_ref, capabilities_json, source_fingerprint, mode,
  last_discovered_at
)
SELECT
  id, node_id, display_name, adapter,
  CASE adapter WHEN 'amneziawg-legacy' THEN 'legacy' WHEN 'awg2' THEN '2' ELSE 'unknown' END,
  container_ref, interface_name, config_ref, capabilities_json,
  source_fingerprint, mode, last_discovered_at
FROM instances_v2;

DROP TABLE instances_v2;
CREATE INDEX instances_node_idx ON instances(node_id);

PRAGMA legacy_alter_table = OFF;
