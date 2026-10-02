ALTER TABLE instances ADD COLUMN udp_port INTEGER CHECK (udp_port BETWEEN 1 AND 65535);

CREATE TABLE relay_servers (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, host TEXT NOT NULL, public_ipv4 TEXT NOT NULL,
  port INTEGER NOT NULL CHECK (port BETWEEN 1 AND 65535),
  host_key_fingerprint TEXT NOT NULL, transport_private_key_encrypted TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','ready','offline','uninstalled')),
  source_fingerprint TEXT, helper_version TEXT, last_checked_at TEXT, last_error_code TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE relay_routes (
  id TEXT PRIMARY KEY, relay_id TEXT NOT NULL REFERENCES relay_servers(id),
  instance_id TEXT NOT NULL UNIQUE REFERENCES instances(id),
  listen_port INTEGER NOT NULL CHECK (listen_port BETWEEN 1024 AND 65535),
  upstream_ipv4 TEXT NOT NULL, upstream_port INTEGER NOT NULL CHECK (upstream_port BETWEEN 1 AND 65535),
  enabled INTEGER NOT NULL CHECK (enabled IN (0,1)), created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  UNIQUE (relay_id, listen_port)
);
CREATE TABLE relay_operations (
  id TEXT PRIMARY KEY, relay_id TEXT NOT NULL REFERENCES relay_servers(id), operation_id TEXT NOT NULL,
  action TEXT NOT NULL, request_hash TEXT NOT NULL, request_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','succeeded','failed','uncertain')),
  error_code TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  UNIQUE (relay_id, operation_id)
);
CREATE UNIQUE INDEX relay_one_pending_operation ON relay_operations(relay_id)
  WHERE status IN ('pending','uncertain');
