import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { openDatabase } from "./database.js";
import { Repository } from "./repository.js";

const directories: string[] = [];
afterEach(() => directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true })));

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "awg-control-session-repository-"));
  directories.push(directory);
  const db = openDatabase(join(directory, "test.db"), new URL("../migrations", import.meta.url).pathname);
  const repository = new Repository(db);
  const first = repository.createAdmin("operator", "hash");
  const second = repository.createAdmin("operator-two", "hash");
  return { db, repository, first, second };
}

describe("session repository", () => {
  it("enforces absolute and idle expiry", () => {
    const { db, repository, first } = fixture();
    repository.createSession({ adminId: first.id, token: "absolute", kind: "short", expiresAt: "2026-09-09T01:00:00.000Z", idleExpiresAt: null, remoteAddress: null, deviceLabel: null, now: "2026-09-09T00:00:00.000Z" });
    repository.createSession({ adminId: first.id, token: "idle", kind: "remembered", expiresAt: "2026-10-09T00:00:00.000Z", idleExpiresAt: "2026-09-09T01:00:00.000Z", remoteAddress: null, deviceLabel: "Mobile Safari / iOS", now: "2026-09-09T00:00:00.000Z" });
    expect(repository.getSession("absolute", "2026-09-09T00:59:59.000Z")).not.toBeNull();
    expect(repository.getSession("absolute", "2026-09-09T01:00:00.000Z")).toBeNull();
    expect(repository.getSession("idle", "2026-09-09T01:00:00.000Z")).toBeNull();
    db.close();
  });

  it("throttles remembered activity and never extends past absolute expiry", () => {
    const { db, repository, first } = fixture();
    repository.createSession({ adminId: first.id, token: "remembered", kind: "remembered", expiresAt: "2026-09-10T00:00:00.000Z", idleExpiresAt: "2026-09-09T12:00:00.000Z", remoteAddress: "203.0.113.8", deviceLabel: "Chrome / Android", now: "2026-09-09T00:00:00.000Z" });
    repository.touchSession("remembered", 604_800, 300, "2026-09-09T00:04:00.000Z");
    expect(repository.listSessions(first.id, "remembered", "2026-09-09T00:05:00.000Z")[0]?.lastSeenAt).toBe("2026-09-09T00:00:00.000Z");
    repository.touchSession("remembered", 604_800, 300, "2026-09-09T00:05:00.000Z");
    const session = repository.listSessions(first.id, "remembered", "2026-09-09T00:05:01.000Z")[0]!;
    expect(session.lastSeenAt).toBe("2026-09-09T00:05:00.000Z");
    expect(session.idleExpiresAt).toBe("2026-09-10T00:00:00.000Z");
    expect(session.remoteAddress).toBe("203.0.113.xxx");
    db.close();
  });

  it("isolates admins and makes revocation repeat-safe", () => {
    const { db, repository, first, second } = fixture();
    const expiresAt = "2027-01-01T00:00:00.000Z";
    const id = repository.createSession({ adminId: first.id, token: "first", kind: "short", expiresAt, idleExpiresAt: null, remoteAddress: null, deviceLabel: null, now: "2026-09-09T00:00:00.000Z" });
    repository.createSession({ adminId: second.id, token: "second", kind: "short", expiresAt, idleExpiresAt: null, remoteAddress: null, deviceLabel: null, now: "2026-09-09T00:00:00.000Z" });
    expect(repository.listSessions(first.id, "first", "2026-09-09T00:01:00.000Z")).toHaveLength(1);
    expect(repository.revokeSession(second.id, id, "2026-09-09T00:02:00.000Z")).toBe(0);
    expect(repository.revokeSession(first.id, id, "2026-09-09T00:02:00.000Z")).toBe(1);
    expect(repository.revokeSession(first.id, id, "2026-09-09T00:03:00.000Z")).toBe(0);
    expect(repository.getSession("first", "2026-09-09T00:03:00.000Z")).toBeNull();
    db.close();
  });

  it("revokes all other sessions and cleans old revoked records", () => {
    const { db, repository, first } = fixture();
    const expiresAt = "2027-01-01T00:00:00.000Z";
    for (const token of ["current", "other-a", "other-b"]) repository.createSession({ adminId: first.id, token, kind: "short", expiresAt, idleExpiresAt: null, remoteAddress: null, deviceLabel: null, now: "2026-09-01T00:00:00.000Z" });
    expect(repository.revokeOtherSessions(first.id, "current", "2026-09-01T00:00:00.000Z")).toBe(2);
    expect(repository.getSession("current", "2026-09-02T00:00:00.000Z")).not.toBeNull();
    expect(repository.getSession("other-a", "2026-09-02T00:00:00.000Z")).toBeNull();
    repository.pruneSessions("2026-09-09T00:00:00.000Z");
    expect((db.prepare("SELECT COUNT(*) AS count FROM sessions").get() as { count: number }).count).toBe(1);
    db.close();
  });
});
