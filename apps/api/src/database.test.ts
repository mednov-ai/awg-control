import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { openDatabase } from "./database.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("database migrations", () => {
  it("applies every migration and enables safety pragmas", () => {
    const directory = mkdtempSync(join(tmpdir(), "awg-control-db-"));
    temporaryDirectories.push(directory);
    const migrations = new URL("../migrations", import.meta.url).pathname;
    expect(readFileSync(join(migrations, "0001_initial.sql"), "utf8")).toContain("CREATE TABLE connections");
    const db = openDatabase(join(directory, "test.db"), migrations);
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>;
    expect(tables.map(({ name }) => name)).toContain("audit_events");
    const columns = db.prepare("PRAGMA table_info(connections)").all() as Array<{ name: string }>;
    expect(columns.map(({ name }) => name)).toContain("quota_override_at");
    expect(db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()).toMatchObject({ version: 4 });
    const instanceColumns = db.prepare("PRAGMA table_info(instances)").all() as Array<{ name: string }>;
    expect(instanceColumns.map(({ name }) => name)).toContain("protocol_version");
    expect(db.pragma("foreign_keys", { simple: true })).toBe(1);
    db.close();
  });

  it("migrates a v2 database with connections and creates a backup", () => {
    const directory = mkdtempSync(join(tmpdir(), "awg-control-db-upgrade-"));
    temporaryDirectories.push(directory);
    const migrations = new URL("../migrations", import.meta.url).pathname;
    const oldMigrations = join(directory, "v2-migrations");
    const databasePath = join(directory, "upgrade.db");
    mkdirSync(oldMigrations);
    for (const name of ["0001_initial.sql", "0002_quota_override.sql"]) {
      copyFileSync(join(migrations, name), join(oldMigrations, name));
    }
    const oldDb = openDatabase(databasePath, oldMigrations);
    const now = "2026-08-28T00:00:00.000Z";
    oldDb.prepare(`INSERT INTO nodes(
      id, name, host, port, ssh_username, host_key_fingerprint, transport_private_key_encrypted,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run("node-1", "node", "vpn.example.test", 22, "agent", "SHA256:fixture", "encrypted", now, now);
    oldDb.prepare(`INSERT INTO instances(
      id, node_id, display_name, adapter, container_ref, interface_name, config_ref,
      capabilities_json, source_fingerprint, last_discovered_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      "instance-1", "node-1", "AWG2", "awg2", "container-1", "awg0", "config-1", "{}", "a".repeat(64), now,
    );
    oldDb.prepare(`INSERT INTO vpn_users(id, node_id, display_name, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)`).run("user-1", "node-1", "user", now, now);
    oldDb.prepare(`INSERT INTO connections(
      id, vpn_user_id, instance_id, name, public_key, address_cidr, source,
      management_mode, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      "connection-1", "user-1", "instance-1", "phone", "public-key", "10.8.1.2/32", "created", "managed", "active", now, now,
    );
    oldDb.close();

    const db = openDatabase(databasePath, migrations);
    expect(db.prepare("SELECT adapter, protocol_version FROM instances WHERE id = ?").get("instance-1"))
      .toMatchObject({ adapter: "awg2", protocol_version: "2" });
    expect(db.prepare("SELECT instance_id FROM connections WHERE id = ?").get("connection-1"))
      .toMatchObject({ instance_id: "instance-1" });
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(readdirSync(directory).some((name) => name.includes(".pre-migration-") && name.endsWith(".backup"))).toBe(true);
    db.close();
  });

  it("migrates v3 sessions as valid short sessions and preserves their admin relation", () => {
    const directory = mkdtempSync(join(tmpdir(), "awg-control-session-upgrade-"));
    temporaryDirectories.push(directory);
    const migrations = new URL("../migrations", import.meta.url).pathname;
    const oldMigrations = join(directory, "v3-migrations");
    const databasePath = join(directory, "upgrade.db");
    mkdirSync(oldMigrations);
    for (const name of ["0001_initial.sql", "0002_quota_override.sql", "0003_awg3_protocol_version.sql"]) {
      copyFileSync(join(migrations, name), join(oldMigrations, name));
    }
    const oldDb = openDatabase(databasePath, oldMigrations);
    const now = "2026-09-09T00:00:00.000Z";
    oldDb.prepare("INSERT INTO admins(id, username, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
      .run("018bcfe5-6800-7000-8000-000000000001", "operator", "hash", now, now);
    oldDb.prepare(`INSERT INTO sessions(id_hash, admin_id, expires_at, created_at, last_seen_at, remote_address)
      VALUES (?, ?, ?, ?, ?, ?)`).run("opaque-hash", "018bcfe5-6800-7000-8000-000000000001", "2026-09-10T00:00:00.000Z", now, now, "127.0.0.1");
    oldDb.close();

    const db = openDatabase(databasePath, migrations);
    const row = db.prepare("SELECT public_id, admin_id, session_kind, expires_at, idle_expires_at FROM sessions").get() as Record<string, unknown>;
    expect(row).toMatchObject({ admin_id: "018bcfe5-6800-7000-8000-000000000001", session_kind: "short", expires_at: "2026-09-10T00:00:00.000Z", idle_expires_at: null });
    expect(String(row.public_id)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(db.pragma("foreign_key_check")).toEqual([]);
    expect(readdirSync(directory).some((name) => name.includes(".pre-migration-") && name.endsWith(".backup"))).toBe(true);
    db.close();
  });
});
