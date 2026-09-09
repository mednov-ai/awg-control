import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import Database from "better-sqlite3";

import { utcNow, uuidv7 } from "./lib/ids.js";

export type SqliteDatabase = Database.Database;

function migrationVersion(name: string): number {
  const match = /^(\d+)_.*\.sql$/.exec(name);
  if (!match) throw new Error(`invalid migration filename: ${name}`);
  return Number(match[1]);
}

export function openDatabase(databasePath: string, migrationsPath: string): SqliteDatabase {
  mkdirSync(dirname(databasePath), { recursive: true, mode: 0o700 });
  const databaseExists = existsSync(databasePath);
  const db = new Database(databasePath);
  db.function("uuidv7", { deterministic: false }, () => uuidv7());
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  db.pragma("synchronous = FULL");

  const hasMigrations = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='schema_migrations'")
    .get();
  const currentVersion = hasMigrations
    ? ((db.prepare("SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations").get() as { version: number }).version ?? 0)
    : 0;

  const migrations = readdirSync(migrationsPath)
    .filter((name) => /^\d+_.*\.sql$/.test(name))
    .sort((left, right) => migrationVersion(left) - migrationVersion(right));
  const pending = migrations.filter((name) => migrationVersion(name) > currentVersion);

  if (databaseExists && pending.length > 0 && currentVersion > 0) {
    const backup = `${databasePath}.pre-migration-${Date.now()}.backup`;
    db.pragma("wal_checkpoint(TRUNCATE)");
    copyFileSync(databasePath, backup);
  }

  for (const name of pending) {
    const sql = readFileSync(join(migrationsPath, name), "utf8");
    const foreignKeysOff = sql.includes("-- awg-control: foreign-keys-off");
    if (foreignKeysOff) db.pragma("foreign_keys = OFF");
    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec(sql);
      if (foreignKeysOff) {
        const violations = db.pragma("foreign_key_check") as Array<Record<string, unknown>>;
        if (violations.length > 0) throw new Error(`migration ${name} violated foreign keys`);
      }
      if (migrationVersion(name) !== 1) {
        db.prepare("INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)").run(
          migrationVersion(name),
          basename(name, ".sql"),
          utcNow(),
        );
      }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    } finally {
      if (foreignKeysOff) db.pragma("foreign_keys = ON");
    }
  }
  return db;
}
