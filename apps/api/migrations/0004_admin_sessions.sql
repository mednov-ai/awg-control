-- awg-control: foreign-keys-off

ALTER TABLE sessions RENAME TO sessions_v3;

CREATE TABLE sessions (
  id_hash TEXT PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  admin_id TEXT NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  session_kind TEXT NOT NULL DEFAULT 'short' CHECK (session_kind IN ('short', 'remembered')),
  expires_at TEXT NOT NULL,
  idle_expires_at TEXT,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  remote_address TEXT,
  device_label TEXT CHECK (device_label IS NULL OR (length(device_label) BETWEEN 1 AND 80)),
  revoked_at TEXT,
  pending_totp_secret_encrypted TEXT
);

INSERT INTO sessions(
  id_hash, public_id, admin_id, session_kind, expires_at, idle_expires_at,
  created_at, last_seen_at, remote_address, device_label, revoked_at,
  pending_totp_secret_encrypted
)
SELECT id_hash, uuidv7(), admin_id, 'short', expires_at, NULL,
       created_at, last_seen_at, remote_address, NULL, NULL,
       pending_totp_secret_encrypted
FROM sessions_v3;

DROP TABLE sessions_v3;

CREATE INDEX sessions_admin_idx ON sessions(admin_id);
CREATE INDEX sessions_expiry_idx ON sessions(expires_at, idle_expires_at, revoked_at);
CREATE INDEX sessions_active_admin_idx ON sessions(admin_id, revoked_at, expires_at);
