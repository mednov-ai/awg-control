#!/usr/bin/env node
import { chmodSync, copyFileSync, existsSync, readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";

import { loadConfig } from "./config.js";
import { openDatabase } from "./database.js";
import { Repository } from "./repository.js";
import { decryptSecret, encryptSecret, hashPassword } from "./security/crypto.js";

async function stdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8").trimEnd();
}

function option(args: string[], name: string): string | null {
  const index = args.indexOf(name);
  return index >= 0 ? (args[index + 1] ?? null) : null;
}

function usage(): never {
  process.stderr.write(
    "Usage:\n" +
      "  awg-control admin create --username NAME --password-stdin\n" +
      "  awg-control backup create --output PATH\n" +
      "  awg-control backup restore --input PATH --force\n" +
      "  awg-control master-key rotate --new-key-file PATH\n" +
      "  awg-control transport-key rotate --node ID --private-key-stdin\n",
  );
  process.exit(2);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const config = loadConfig();
  const database = openDatabase(config.databasePath, config.migrationsPath);
  const repository = new Repository(database);
  try {
    if (args[0] === "admin" && args[1] === "create" && args.includes("--password-stdin")) {
      const username = option(args, "--username");
      if (!username || !/^[A-Za-z0-9._-]{3,64}$/.test(username)) usage();
      const password = await stdin();
      const admin = repository.createAdmin(username, await hashPassword(password));
      process.stdout.write(`Administrator ${admin.username} created (${admin.id}).\n`);
      return;
    }

    if (args[0] === "backup" && args[1] === "create") {
      const output = option(args, "--output");
      if (!output) usage();
      await database.backup(resolve(output));
      process.stdout.write("Database backup created; embedded secrets remain encrypted.\n");
      return;
    }

    if (args[0] === "backup" && args[1] === "restore" && args.includes("--force")) {
      const input = option(args, "--input");
      if (!input || !existsSync(input)) usage();
      database.close();
      rmSync(`${config.databasePath}-wal`, { force: true });
      rmSync(`${config.databasePath}-shm`, { force: true });
      copyFileSync(resolve(input), config.databasePath);
      chmodSync(config.databasePath, 0o600);
      process.stdout.write("Database restored. Start Panel and verify readiness.\n");
      return;
    }

    if (args[0] === "transport-key" && args[1] === "rotate" && args.includes("--private-key-stdin")) {
      const nodeId = option(args, "--node");
      if (!nodeId || !repository.getNode(nodeId)) usage();
      const privateKey = await stdin();
      database
        .prepare("UPDATE nodes SET transport_private_key_encrypted = ?, updated_at = ? WHERE id = ?")
        .run(encryptSecret(config.masterKey, `transport-key:${nodeId}`, privateKey), new Date().toISOString(), nodeId);
      process.stdout.write("Node transport key rotated. Update authorized_keys before the next poll.\n");
      return;
    }

    if (args[0] === "master-key" && args[1] === "rotate") {
      const path = option(args, "--new-key-file");
      if (!path) usage();
      const nextKey = readFileSync(path);
      if (nextKey.length !== 32) throw new Error("new master key must contain exactly 32 bytes");
      database.transaction(() => {
        const nodes = database.prepare("SELECT id, transport_private_key_encrypted AS value FROM nodes").all() as Array<{
          id: string;
          value: string;
        }>;
        for (const row of nodes) {
          const secret = decryptSecret(config.masterKey, `transport-key:${row.id}`, row.value);
          database
            .prepare("UPDATE nodes SET transport_private_key_encrypted = ? WHERE id = ?")
            .run(encryptSecret(nextKey, `transport-key:${row.id}`, secret), row.id);
          secret.fill(0);
        }
        const admins = database
          .prepare("SELECT id, totp_secret_encrypted AS value FROM admins WHERE totp_secret_encrypted IS NOT NULL")
          .all() as Array<{ id: string; value: string }>;
        for (const row of admins) {
          const secret = decryptSecret(config.masterKey, `totp:${row.id}`, row.value);
          database
            .prepare("UPDATE admins SET totp_secret_encrypted = ? WHERE id = ?")
            .run(encryptSecret(nextKey, `totp:${row.id}`, secret), row.id);
          secret.fill(0);
        }
        database.prepare("UPDATE sessions SET pending_totp_secret_encrypted = NULL").run();
      })();
      process.stdout.write("Secrets re-encrypted. Replace the mounted master key before restarting Panel.\n");
      return;
    }

    usage();
  } finally {
    if (database.open) database.close();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : "CLI failed"}\n`);
  process.exitCode = 1;
});
