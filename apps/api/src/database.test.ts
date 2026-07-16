import { mkdtempSync, readFileSync, rmSync } from "node:fs";
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
    expect(db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()).toMatchObject({ version: 2 });
    expect(db.pragma("foreign_keys", { simple: true })).toBe(1);
    db.close();
  });
});
