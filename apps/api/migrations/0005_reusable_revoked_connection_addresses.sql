-- awg-control: foreign-keys-off

CREATE TABLE connections_v5 (
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
  quota_override_at TEXT,
  quota_override_used_bytes INTEGER NOT NULL DEFAULT 0 CHECK (quota_override_used_bytes >= 0),
  UNIQUE(instance_id, public_key)
);

INSERT INTO connections_v5(
  id, vpn_user_id, instance_id, name, public_key, address_cidr, source,
  management_mode, status, expires_at, quota_policy_id, last_handshake_at,
  rx_bytes_total, tx_bytes_total, last_counter_rx, last_counter_tx,
  counter_epoch, created_at, updated_at, revoked_at, quota_override_at,
  quota_override_used_bytes
)
SELECT
  id, vpn_user_id, instance_id, name, public_key, address_cidr, source,
  management_mode, status, expires_at, quota_policy_id, last_handshake_at,
  rx_bytes_total, tx_bytes_total, last_counter_rx, last_counter_tx,
  counter_epoch, created_at, updated_at, revoked_at, quota_override_at,
  quota_override_used_bytes
FROM connections;

DROP TABLE connections;
ALTER TABLE connections_v5 RENAME TO connections;

CREATE UNIQUE INDEX connections_live_address_unique_idx
  ON connections(instance_id, address_cidr)
  WHERE status != 'revoked';
CREATE INDEX connections_user_idx ON connections(vpn_user_id);
CREATE INDEX connections_instance_idx ON connections(instance_id);
CREATE INDEX connections_expiry_idx ON connections(expires_at, status);
