ALTER TABLE connections ADD COLUMN quota_override_at TEXT;
ALTER TABLE connections ADD COLUMN quota_override_used_bytes INTEGER NOT NULL DEFAULT 0
  CHECK (quota_override_used_bytes >= 0);
