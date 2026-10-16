import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import Database from "better-sqlite3";
import { openDatabase } from "./database.js";
import { Repository } from "./repository.js";

it("upgrades v6 with AWG peers and relay relations, preserves reservations and restores its backup", () => {
  const dir = mkdtempSync(join(tmpdir(), "awg-wireguard-migration-"));
  const migrations = new URL("../migrations", import.meta.url).pathname;
  const v6 = join(dir, "v6");
  mkdirSync(v6);
  for (const name of readdirSync(migrations).filter(n => /^000[1-6]_/.test(n))) copyFileSync(join(migrations, name), join(v6, name));
  const path = join(dir, "fixture.db");
  let db = openDatabase(path, v6);
  try {
    let repo = new Repository(db);
    const now = new Date().toISOString();
    repo.createNode({ id: "node", name: "synthetic", description: null, host: "203.0.113.10", port: 22, sshUsername: "agent", hostKeyFingerprint: "a".repeat(64), transportPrivateKeyEncrypted: "SYNTHETIC-ENCRYPTED", pollIntervalSeconds: 60 });
    repo.upsertInstances("node", [{ id: "instance", displayName: "AWG", adapter: "awg3", protocolVersion: "3.1", containerRef: "container", interfaceName: "awg0", configRef: "config", sourceFingerprint: "b".repeat(64), mode: "managed", lastDiscoveredAt: now, udpPort: 47300, capabilities: { create: true, stats: true, suspend: true, resume: true, revoke: true, metadataUpdate: false } }]);
    const user = repo.createUser({ nodeId: "node", displayName: "fixture", externalReference: null, notes: null });
    repo.createConnection({ id: "peer", vpnUserId: user.id, instanceId: "instance", name: "router", publicKey: "SYNTHETIC-PUBLIC", addressCidr: "10.9.0.2/32", source: "created", managementMode: "managed", status: "suspended", expiresAt: null, quotaPolicyId: null });
    db.prepare("INSERT INTO relay_servers(id,name,host,port,public_ipv4,host_key_fingerprint,transport_private_key_encrypted,created_at,updated_at) VALUES('relay','relay','203.0.113.20',22,'203.0.113.20',?,'SYNTHETIC',?,?)").run("c".repeat(64), now, now);
    db.prepare("INSERT INTO relay_routes(id,relay_id,instance_id,listen_port,upstream_ipv4,upstream_port,enabled,created_at,updated_at) VALUES('route','relay','instance',47300,'203.0.113.10',47300,1,?,?)").run(now, now);
    db.close();
    db = openDatabase(path, migrations);
    repo = new Repository(db);
    expect(repo.getConnection("peer")).toMatchObject({ status: "suspended", instanceId: "instance" });
    expect(repo.getInstance("instance")).toMatchObject({ mode: "managed", udpPort: 47300 });
    expect(repo.relays.instanceRoute("instance")).toMatchObject({ id: "route", upstreamPort: 47300 });
    expect(db.pragma("foreign_key_check")).toEqual([]);
    expect(db.pragma("integrity_check", { simple: true })).toBe("ok");
    expect(db.prepare("SELECT sql FROM sqlite_master WHERE type='index' AND tbl_name='connections'").all().some(row => String((row as {sql:unknown}).sql).includes("WHERE status != 'revoked'"))).toBe(true);
    const original = repo.getInstance("instance")!;
    repo.upsertInstances("node", [{ ...original, adapter: "wireguard", protocolVersion: "wireguard" }]);
    expect(repo.getInstance("instance")).toMatchObject({ id: "instance", mode: "observed", adapter: "wireguard" });
    // Caller passes observed after real discovery; protocol changes must not retain management.
    repo.upsertInstances("node", [{ ...original, mode: "observed" }]);
    expect(repo.getInstance("instance")).toMatchObject({ mode: "observed" });
    const backup = readdirSync(dir).find(n => n.includes(".pre-migration-") && n.endsWith(".backup"))!;
    const restored = new Database(join(dir, backup), { readonly: true });
    expect(restored.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()).toMatchObject({ version: 6 });
    expect(restored.prepare("SELECT instance_id FROM relay_routes WHERE id='route'").get()).toMatchObject({ instance_id: "instance" });
    expect(restored.pragma("integrity_check", { simple: true })).toBe("ok");
    restored.close();
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
});
