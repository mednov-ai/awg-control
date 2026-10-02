import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it } from "vitest";
import { openDatabase } from "./database.js";
import { Repository } from "./repository.js";
import { decryptSecret, encryptSecret } from "./security/crypto.js";

const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });
const oldKey = Buffer.alloc(32, 11), nextKey = Buffer.alloc(32, 12);
const nodeId = "019a0000-0000-7000-8000-000000000001", relayId = "019a0000-0000-7000-8000-000000000002";
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "awg-cli-rotation-"));
  directories.push(directory);
  const databasePath = join(directory, "test.db"), migrations = new URL("../migrations", import.meta.url).pathname;
  const db = openDatabase(databasePath, migrations), repository = new Repository(db);
  const nodePurpose = `transport-key:${nodeId}`, relayPurpose = `relay-transport-key:${relayId}`;
  repository.createNode({ id: nodeId, name: "Synthetic node", description: null, host: "203.0.113.10", port: 22,
    sshUsername: "awg-control-agent", hostKeyFingerprint: "a".repeat(64), pollIntervalSeconds: 60,
    transportPrivateKeyEncrypted: encryptSecret(oldKey, nodePurpose, "SYNTHETIC-NODE-KEY") });
  repository.relays.create({ id: relayId, name: "Synthetic relay", host: "203.0.113.20", publicIpv4: "203.0.113.20", port: 22,
    hostKeyFingerprint: "b".repeat(64), encryptedKey: encryptSecret(oldKey, relayPurpose, "SYNTHETIC-RELAY-KEY") });
  const admin = repository.createAdmin("fixture-admin", "synthetic-password-hash"), totpPurpose = `totp:${admin.id}`;
  db.prepare("UPDATE admins SET totp_secret_encrypted=? WHERE id=?")
    .run(encryptSecret(oldKey, totpPurpose, "SYNTHETIC-TOTP"), admin.id);
  repository.createSession({ adminId: admin.id, token: "synthetic-session-token", kind: "short", expiresAt: "2030-01-01T00:00:00Z",
    idleExpiresAt: null, remoteAddress: null, deviceLabel: null });
  db.prepare("UPDATE sessions SET pending_totp_secret_encrypted='synthetic-pending'").run();
  const oldPath = join(directory, "old-key"), nextPath = join(directory, "next-key");
  writeFileSync(oldPath, oldKey, { mode: 0o600 }); writeFileSync(nextPath, nextKey, { mode: 0o600 });
  const run = () => spawnSync(process.execPath,
    [...(import.meta.url.endsWith(".ts") ? ["--import", "tsx"] : []),
      fileURLToPath(new URL(import.meta.url.endsWith(".ts") ? "./cli.ts" : "./cli.js", import.meta.url)),
      "master-key", "rotate", "--new-key-file", nextPath], {
      encoding: "utf8", timeout: 10000, env: { ...process.env, AWG_CONTROL_DATABASE: databasePath,
        AWG_CONTROL_MIGRATIONS: migrations, AWG_CONTROL_MASTER_KEY_FILE: oldPath },
    });
  const values = () => ({
    node: repository.getNodeSecret(nodeId)!.transportPrivateKeyEncrypted,
    relay: repository.relays.secret(relayId)!.transportPrivateKeyEncrypted,
    totp: (db.prepare("SELECT totp_secret_encrypted AS value FROM admins WHERE id=?").get(admin.id) as { value: string }).value,
    pending: (db.prepare("SELECT pending_totp_secret_encrypted AS value FROM sessions").get() as { value: string | null }).value,
  });
  return { db, run, values, nodePurpose, relayPurpose, totpPurpose };
}

it("CLI rotates Node, relay and TOTP credentials together and clears pending enrollment", () => {
  const f = fixture();
  try {
    const result = f.run();
    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain("SYNTHETIC");
    const values = f.values();
    for (const [field, purpose, expected] of [
      ["node", f.nodePurpose, "SYNTHETIC-NODE-KEY"], ["relay", f.relayPurpose, "SYNTHETIC-RELAY-KEY"],
      ["totp", f.totpPurpose, "SYNTHETIC-TOTP"],
    ] as const) {
      expect(decryptSecret(nextKey, purpose, values[field]).toString()).toBe(expected);
      expect(() => decryptSecret(oldKey, purpose, values[field])).toThrow();
    }
    expect(values.pending).toBeNull();
  } finally { f.db.close(); }
});

it("CLI rolls back all credential changes when relay decryption fails", () => {
  const f = fixture();
  try {
    f.db.prepare("UPDATE relay_servers SET transport_private_key_encrypted='synthetic-corrupt'").run();
    const before = f.values();
    expect(f.run().status).toBe(1);
    expect(f.values()).toEqual(before);
  } finally { f.db.close(); }
});
