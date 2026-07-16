PRAGMA foreign_keys = ON;

CREATE TABLE admins (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL COLLATE NOCASE UNIQUE,
  password_hash TEXT NOT NULL,
  totp_enabled INTEGER NOT NULL DEFAULT 0 CHECK (totp_enabled IN (0, 1)),
  totp_secret_encrypted TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  last_login_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE admin_recovery_codes (
  admin_id TEXT NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (admin_id, code_hash)
);

CREATE TABLE sessions (
  id_hash TEXT PRIMARY KEY,
  admin_id TEXT NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  remote_address TEXT,
  pending_totp_secret_encrypted TEXT
);
CREATE INDEX sessions_admin_idx ON sessions(admin_id);
CREATE INDEX sessions_expiry_idx ON sessions(expires_at);

CREATE TABLE nodes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  host TEXT NOT NULL,
  port INTEGER NOT NULL CHECK (port BETWEEN 1 AND 65535),
  ssh_username TEXT NOT NULL,
  host_key_fingerprint TEXT NOT NULL,
  transport_private_key_encrypted TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'discovered', 'healthy', 'degraded', 'offline')),
  helper_version TEXT,
  last_seen_at TEXT,
  last_error_code TEXT,
  poll_interval_seconds INTEGER NOT NULL DEFAULT 60 CHECK (poll_interval_seconds BETWEEN 15 AND 3600),
  next_poll_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(host, port, ssh_username)
);
CREATE INDEX nodes_next_poll_idx ON nodes(next_poll_at, status);

CREATE TABLE instances (
  id TEXT PRIMARY KEY,
  node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  adapter TEXT NOT NULL CHECK (adapter IN ('amneziawg-legacy', 'awg2')),
  container_ref TEXT NOT NULL,
  interface_name TEXT NOT NULL,
  config_ref TEXT NOT NULL,
  capabilities_json TEXT NOT NULL,
  source_fingerprint TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'observed' CHECK (mode IN ('observed', 'managed', 'read-only')),
  last_discovered_at TEXT NOT NULL,
  UNIQUE(node_id, container_ref, interface_name)
);
CREATE INDEX instances_node_idx ON instances(node_id);

CREATE TABLE vpn_users (
  id TEXT PRIMARY KEY,
  node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE RESTRICT,
  display_name TEXT NOT NULL,
  external_reference TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'archived')),
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX vpn_users_node_idx ON vpn_users(node_id);
CREATE INDEX vpn_users_name_idx ON vpn_users(display_name);

CREATE TABLE quota_policies (
  id TEXT PRIMARY KEY,
  node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  limit_bytes INTEGER NOT NULL CHECK (limit_bytes > 0),
  period TEXT NOT NULL CHECK (period IN ('lifetime', 'month', 'calendar-month')),
  reset_timezone TEXT NOT NULL,
  action TEXT NOT NULL DEFAULT 'suspend' CHECK (action = 'suspend'),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(node_id, name)
);

CREATE TABLE connections (
  id TEXT PRIMARY KEY,
  vpn_user_id TEXT NOT NULL REFERENCES vpn_users(id) ON DELETE RESTRICT,
  instance_id TEXT NOT NULL REFERENCES instances(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  public_key TEXT NOT NULL,
  address_cidr TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('created', 'imported')),
  management_mode TEXT NOT NULL CHECK (management_mode IN ('observed', 'managed')),
  status TEXT NOT NULL CHECK (status IN ('active', 'suspended', 'expired', 'quota-exceeded', 'revoked', 'error')),
  expires_at TEXT,
  quota_policy_id TEXT REFERENCES quota_policies(id) ON DELETE SET NULL,
  last_handshake_at TEXT,
  rx_bytes_total INTEGER NOT NULL DEFAULT 0 CHECK (rx_bytes_total >= 0),
  tx_bytes_total INTEGER NOT NULL DEFAULT 0 CHECK (tx_bytes_total >= 0),
  last_counter_rx INTEGER NOT NULL DEFAULT 0 CHECK (last_counter_rx >= 0),
  last_counter_tx INTEGER NOT NULL DEFAULT 0 CHECK (last_counter_tx >= 0),
  counter_epoch INTEGER NOT NULL DEFAULT 0 CHECK (counter_epoch >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  revoked_at TEXT,
  UNIQUE(instance_id, public_key),
  UNIQUE(instance_id, address_cidr)
);
CREATE INDEX connections_user_idx ON connections(vpn_user_id);
CREATE INDEX connections_instance_idx ON connections(instance_id);
CREATE INDEX connections_expiry_idx ON connections(expires_at, status);

CREATE TABLE traffic_rollups (
  connection_id TEXT NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
  bucket_start TEXT NOT NULL,
  bucket_kind TEXT NOT NULL CHECK (bucket_kind IN ('hourly', 'daily')),
  rx_bytes INTEGER NOT NULL CHECK (rx_bytes >= 0),
  tx_bytes INTEGER NOT NULL CHECK (tx_bytes >= 0),
  PRIMARY KEY (connection_id, bucket_start, bucket_kind)
);
CREATE INDEX traffic_rollups_retention_idx ON traffic_rollups(bucket_kind, bucket_start);

CREATE TABLE audit_events (
  id TEXT PRIMARY KEY,
  occurred_at TEXT NOT NULL,
  admin_id TEXT REFERENCES admins(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT,
  node_id TEXT REFERENCES nodes(id) ON DELETE SET NULL,
  operation_id TEXT,
  result TEXT NOT NULL CHECK (result IN ('success', 'failure', 'rejected')),
  error_code TEXT,
  remote_address TEXT,
  details_json TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX audit_events_time_idx ON audit_events(occurred_at DESC);
CREATE INDEX audit_events_target_idx ON audit_events(target_type, target_id);

CREATE TABLE idempotency_records (
  scope TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  result_type TEXT NOT NULL,
  result_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('started', 'succeeded', 'failed')),
  error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (scope, operation_id)
);

CREATE TABLE schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TEXT NOT NULL
);

INSERT INTO schema_migrations(version, name, applied_at)
VALUES (1, 'initial', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

