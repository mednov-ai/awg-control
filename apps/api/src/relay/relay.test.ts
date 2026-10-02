import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  type HelperRequest,
  type HelperResponse,
  type RelayRequest,
  type RelayStatus,
} from "@awg-control/contracts";
import { openDatabase } from "../database.js";
import { Repository } from "../repository.js";
import {
  encryptSecret,
  decryptSecret,
  hashPassword,
} from "../security/crypto.js";
import { RelayService } from "./service.js";
import type { RelayClient } from "./client.js";
import type { HelperClient } from "../helper/client.js";
import { buildServer } from "../server.js";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const relayId = "019a0000-0000-7000-8000-000000000001",
  nodeId = "019a0000-0000-7000-8000-000000000002",
  instanceId = "019a0000-0000-7000-8000-000000000003";
const masterKey = Buffer.alloc(32, 9),
  migrations = new URL("../../migrations", import.meta.url).pathname;
function setup() {
  const dir = mkdtempSync(join(tmpdir(), "awg-relay-test-"));
  dirs.push(dir);
  const db = openDatabase(join(dir, "test.db"), migrations),
    repo = new Repository(db);
  repo.relays.create({
    id: relayId,
    name: "Fixture relay",
    host: "203.0.113.20",
    publicIpv4: "203.0.113.20",
    port: 22,
    hostKeyFingerprint: "a".repeat(64),
    encryptedKey: encryptSecret(
      masterKey,
      `relay-transport-key:${relayId}`,
      "SYNTHETIC-SSH-KEY",
    ),
  });
  repo.createNode({
    id: nodeId,
    name: "Fixture VPN",
    description: null,
    host: "203.0.113.10",
    port: 22,
    sshUsername: "awg-control-agent",
    hostKeyFingerprint: "b".repeat(64),
    transportPrivateKeyEncrypted: "fixture-encrypted",
    pollIntervalSeconds: 60,
  });
  repo.upsertInstances(nodeId, [
    {
      id: instanceId,
      displayName: "Fixture AWG 3.1",
      adapter: "awg3",
      protocolVersion: "3.1",
      containerRef: "opaque-container",
      interfaceName: "awg0",
      configRef: "opaque-config",
      sourceFingerprint: "c".repeat(64),
      mode: "managed",
      lastDiscoveredAt: new Date().toISOString(),
      udpPort: 47300,
      capabilities: {
        create: true,
        stats: true,
        suspend: true,
        resume: true,
        revoke: true,
        metadataUpdate: false,
      },
    },
  ]);
  return { db, repo, dir };
}
class FakeRelay implements RelayClient {
  status: RelayStatus = {
    installed: false,
    active: false,
    sourceFingerprint: "d".repeat(64),
    helperVersion: "fixture",
    protocolVersion: "1.1",
    routes: [],
  };
  mutations = 0;
  loseResponse = false;
  history = new Map<string, RelayStatus>();
  async call<T>(_relay: never, r: RelayRequest): Promise<HelperResponse<T>> {
    if (r.action !== "status") {
      if (!this.history.has(r.operationId)) {
        this.mutations++;
        if (r.action === "install" || r.action === "update") {
          this.status.installed = true;
          this.status.active = true;
        }
        if (r.action === "apply") {
          const route = r.parameters.route as RelayStatus["routes"][number];
          this.status.routes = [
            ...this.status.routes.filter((i) => i.id !== route.id),
            route,
          ];
        }
        if (r.action === "disable")
          this.status.routes = this.status.routes.map((i) =>
            i.id === r.parameters.routeId ? { ...i, enabled: false } : i,
          );
        if (r.action === "remove")
          this.status.routes = this.status.routes.filter(
            (i) => i.id !== r.parameters.routeId,
          );
        if (r.action === "uninstall") {
          this.status.installed = false;
          this.status.active = false;
          this.status.routes = [];
        }
        this.status.sourceFingerprint = String(this.mutations % 10).repeat(64);
        this.history.set(r.operationId, structuredClone(this.status));
      }
      if (this.loseResponse) {
        this.loseResponse = false;
        throw new Error("synthetic lost response");
      }
    }
    return {
      ok: true,
      requestId: r.requestId,
      result: structuredClone(
        r.action === "status" ? this.status : this.history.get(r.operationId),
      ) as T,
    };
  }
}
const helper: HelperClient = {
  async call<T>(_node: never, r: HelperRequest): Promise<HelperResponse<T>> {
    return {
      ok: true,
      requestId: r.requestId,
      result: {
        instances: [
          {
            id: instanceId,
            protocolVersion: "3.1",
            udpPort: 47300,
            readOnly: false,
            sourceFingerprint: "c".repeat(64),
          },
        ],
      } as T,
    };
  },
};
describe("relay persistence and operations", () => {
  it("encrypts transport keys with a relay-specific purpose and never returns them", () => {
    const { db, repo } = setup();
    const secret = repo.relays.secret(relayId)!;
    expect(
      decryptSecret(
        masterKey,
        `relay-transport-key:${relayId}`,
        secret.transportPrivateKeyEncrypted,
      ).toString(),
    ).toBe("SYNTHETIC-SSH-KEY");
    expect(() =>
      decryptSecret(
        masterKey,
        `transport-key:${relayId}`,
        secret.transportPrivateKeyEncrypted,
      ),
    ).toThrow();
    expect(JSON.stringify(repo.relays.list())).not.toContain(
      "SYNTHETIC-SSH-KEY",
    );
    db.close();
  });
  it("reconciles a lost remote success once and preserves route/endpoint metadata", async () => {
    const { db, repo } = setup();
    const remote = new FakeRelay(),
      s = new RelayService(repo, remote, helper);
    await s.status(relayId);
    await s.mutate(relayId, "install", "install", {
      expectedFingerprint: remote.status.sourceFingerprint,
    });
    remote.loseResponse = true;
    const body = {
      expectedFingerprint: remote.status.sourceFingerprint,
      instanceId,
    };
    await expect(
      s.mutate(relayId, "apply", "create-route", body),
    ).rejects.toThrow();
    expect(
      repo.relays.getOperation(relayId, "create-route")!.record.status,
    ).toBe("uncertain");
    expect(repo.relays.endpoint(instanceId)).toBeNull();
    await expect(
      s.mutate(relayId, "update", "another", {
        expectedFingerprint: remote.status.sourceFingerprint,
      }),
    ).rejects.toMatchObject({ code: "RELAY_BUSY" });
    const count = remote.mutations;
    await s.reconcile(relayId, "create-route");
    expect(remote.mutations).toBe(count);
    expect(repo.relays.endpoint(instanceId)).toMatchObject({
      host: "203.0.113.20",
      port: 47300,
    });
    await s.mutate(relayId, "apply", "create-route", body);
    expect(remote.mutations).toBe(count);
    await expect(
      s.mutate(relayId, "apply", "create-route", {
        ...body,
        listenPort: 50000,
      }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    const route = repo.relays.instanceRoute(instanceId)!;
    await s.mutate(relayId, "disable", "disable", {
      expectedFingerprint: remote.status.sourceFingerprint,
      routeId: route.id,
    });
    expect(repo.relays.endpoint(instanceId)).toBeNull();
    await s.mutate(relayId, "uninstall", "uninstall", {
      expectedFingerprint: remote.status.sourceFingerprint,
    });
    expect(repo.getInstance(instanceId)).not.toBeNull();
    db.close();
  });
  it("fails closed for AWG2 and stale fingerprints", async () => {
    const { db, repo } = setup();
    const remote = new FakeRelay(),
      s = new RelayService(repo, remote, helper);
    await s.status(relayId);
    await expect(
      s.mutate(relayId, "install", "stale", {
        expectedFingerprint: "f".repeat(64),
      }),
    ).rejects.toMatchObject({ code: "SOURCE_FINGERPRINT_CONFLICT" });
    db.prepare("UPDATE instances SET protocol_version='2'").run();
    await expect(
      s.mutate(relayId, "apply", "awg2", {
        expectedFingerprint: remote.status.sourceFingerprint,
        instanceId,
      }),
    ).rejects.toMatchObject({ code: "ADAPTER_READ_ONLY" });
    expect(remote.mutations).toBe(0);
    db.close();
  });
  it("upgrades v5, preserves peer/address index and restores the pre-migration backup", () => {
    const { dir, db } = setup();
    db.close();
    const old = join(dir, "v5");
    mkdirSync(old);
    for (const f of readdirSync(migrations).filter((f) => /^000[1-5]_/.test(f)))
      copyFileSync(join(migrations, f), join(old, f));
    const path = join(dir, "upgrade.db");
    openDatabase(path, old).close();
    const upgraded = openDatabase(path, migrations);
    expect(
      upgraded
        .prepare("SELECT MAX(version) AS version FROM schema_migrations")
        .get(),
    ).toMatchObject({ version: 6 });
    expect(
      upgraded
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='index' AND name LIKE '%address%'",
        )
        .all().length,
    ).toBeGreaterThan(0);
    expect(upgraded.pragma("foreign_key_check")).toEqual([]);
    upgraded.close();
    const backup = readdirSync(dir).find(
      (f) => f.startsWith("upgrade.db.pre-migration-") && f.endsWith(".backup"),
    )!;
    copyFileSync(join(dir, backup), join(dir, "restore.db"));
    const restored = openDatabase(join(dir, "restore.db"), old);
    expect(
      restored
        .prepare("SELECT MAX(version) AS version FROM schema_migrations")
        .get(),
    ).toMatchObject({ version: 5 });
    expect(
      restored
        .prepare("SELECT name FROM sqlite_master WHERE name='relay_servers'")
        .get(),
    ).toBeUndefined();
    restored.close();
  });
  it("documents API contracts and rejects unauthenticated, CSRF and unknown fields", async () => {
    const { db, repo, dir } = setup();
    repo.createAdmin(
      "operator",
      await hashPassword("synthetic-fixture-password"),
    );
    const config = {
      host: "127.0.0.1",
      port: 8080,
      databasePath: join(dir, "test.db"),
      migrationsPath: migrations,
      webRoot: null,
      masterKey,
      sessionTtlSeconds: 3600,
      rememberedSessionTtlSeconds: 2592000,
      rememberedSessionIdleTtlSeconds: 604800,
      sessionActivityWriteIntervalSeconds: 300,
      secureCookies: false,
      publicOrigin: "http://panel.test",
      trustedProxyHops: 0,
      pollingEnabled: false,
    };
    let creates = 0;
    const issuingHelper: HelperClient = {
      async call<T>(node: never, r: HelperRequest): Promise<HelperResponse<T>> {
        if (r.action !== "create") return helper.call<T>(node, r);
        creates++;
        return { ok: true, requestId: r.requestId, result: {
          publicKey: "SYNTHETIC-CLIENT-PUBLIC-KEY", addressCidr: "10.8.3.2/32",
          clientConfig: "SYNTHETIC-ONE-TIME-CONFIG", sourceFingerprint: "e".repeat(64),
        } as T };
      },
    };
    const remote = new FakeRelay(),
      app = await buildServer(config, repo, issuingHelper, remote);
    expect(
      (await app.inject({ method: "GET", url: "/api/v1/relays" })).statusCode,
    ).toBe(401);
    const login = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      headers: { origin: "http://panel.test" },
      payload: { username: "operator", password: "synthetic-fixture-password" },
    });
    const cookie = String(login.headers["set-cookie"]).split(";")[0]!;
    const headers = {
      cookie,
      origin: "http://panel.test",
      "idempotency-key": "http-op",
    };
    const doc = (
      await app.inject({ url: "/api/v1/openapi.json", headers: { cookie } })
    ).json();
    expect(doc.paths).toHaveProperty("/relays/{id}/apply");
    expect(JSON.stringify(doc.paths["/relays/{id}/apply"])).not.toContain(
      "upstreamIpv4",
    );
    const url = `/api/v1/relays/${relayId}/apply`;
    expect(
      (
        await app.inject({
          method: "POST",
          url,
          headers: { ...headers, origin: "http://evil.test" },
          payload: {},
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: "POST",
          url,
          headers,
          payload: {
            expectedFingerprint: "d".repeat(64),
            instanceId,
            command: "sh",
          },
        })
      ).statusCode,
    ).toBe(400);
    await app.inject({
      method: "POST",
      url: `/api/v1/relays/${relayId}/check`,
      headers,
      payload: {},
    });
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/v1/relays/${relayId}/install`,
          headers,
          payload: { expectedFingerprint: "d".repeat(64) },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/api/v1/relays/${relayId}`,
          headers,
        })
      ).body,
    ).not.toContain("transportPrivateKey");
    const service = new RelayService(repo, remote, helper);
    await service.mutate(relayId, "apply", "http-route", { expectedFingerprint: remote.status.sourceFingerprint, instanceId });
    const user = repo.createUser({ nodeId, displayName: "Fixture device owner", externalReference: null, notes: null });
    const issueRequest = { method: "POST" as const, url: `/api/v1/users/${user.id}/connections`,
      headers: { ...headers, "idempotency-key": "http-issuance" }, payload: { instanceId, name: "Fixture phone" } };
    const issued = await app.inject(issueRequest);
    expect(issued.statusCode).toBe(201);
    expect(issued.json().relayEndpoint).toMatchObject({ host: "203.0.113.20", port: 47300 });
    expect(issued.json().clientConfig === "SYNTHETIC-ONE-TIME-CONFIG").toBe(true);
    const repeated = await app.inject(issueRequest);
    expect(repeated.statusCode).toBe(409);
    expect(repeated.json().code).toBe("CONFIG_ALREADY_ISSUED");
    expect(repeated.body.includes("SYNTHETIC-ONE-TIME-CONFIG")).toBe(false);
    expect(creates).toBe(1);
    expect(JSON.stringify(repo.listConnectionsForUser(user.id)).includes("SYNTHETIC-ONE-TIME-CONFIG")).toBe(false);
    await app.close();
    db.close();
  });
});
