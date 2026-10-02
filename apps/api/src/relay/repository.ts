import type {
  RelayServer,
  RelayRoute,
  RelayOperation,
  RelayEndpoint,
} from "@awg-control/contracts";
import type { SqliteDatabase } from "../database.js";
import { utcNow, uuidv7 } from "../lib/ids.js";

type Row = Record<string, unknown>;
function server(row: Row): RelayServer {
  return {
    id: String(row.id),
    name: String(row.name),
    host: String(row.host),
    publicIpv4: String(row.public_ipv4),
    port: Number(row.port),
    sshUsername: "awg-control-relay-agent",
    hostKeyFingerprint: String(row.host_key_fingerprint),
    status: row.status as RelayServer["status"],
    sourceFingerprint: row.source_fingerprint as string | null,
    helperVersion: row.helper_version as string | null,
    lastCheckedAt: row.last_checked_at as string | null,
    lastErrorCode: row.last_error_code as string | null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}
function route(row: Row): RelayRoute {
  return {
    id: String(row.id),
    relayId: String(row.relay_id),
    instanceId: String(row.instance_id),
    listenPort: Number(row.listen_port),
    upstreamIpv4: String(row.upstream_ipv4),
    upstreamPort: Number(row.upstream_port),
    enabled: Boolean(row.enabled),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}
function operation(row: Row): RelayOperation {
  return {
    id: String(row.id),
    relayId: String(row.relay_id),
    operationId: String(row.operation_id),
    action: String(row.action),
    status: row.status as RelayOperation["status"],
    errorCode: row.error_code as string | null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}
export interface RelaySecret {
  relay: RelayServer;
  transportPrivateKeyEncrypted: string;
}
export interface StoredRelayOperation {
  record: RelayOperation;
  requestHash: string;
  request: Record<string, unknown>;
}
export class RelayRepository {
  constructor(private readonly db: SqliteDatabase) {}
  list(): RelayServer[] {
    return (
      this.db
        .prepare("SELECT * FROM relay_servers ORDER BY name")
        .all() as Row[]
    ).map(server);
  }
  get(id: string): RelayServer | null {
    const row = this.db
      .prepare("SELECT * FROM relay_servers WHERE id=?")
      .get(id) as Row | undefined;
    return row ? server(row) : null;
  }
  secret(id: string): RelaySecret | null {
    const row = this.db
      .prepare("SELECT * FROM relay_servers WHERE id=?")
      .get(id) as Row | undefined;
    return row
      ? {
          relay: server(row),
          transportPrivateKeyEncrypted: String(
            row.transport_private_key_encrypted,
          ),
        }
      : null;
  }
  create(input: {
    id: string;
    name: string;
    host: string;
    publicIpv4: string;
    port: number;
    hostKeyFingerprint: string;
    encryptedKey: string;
  }): RelayServer {
    const now = utcNow();
    this.db
      .prepare(
        `INSERT INTO relay_servers(id,name,host,public_ipv4,port,host_key_fingerprint,transport_private_key_encrypted,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        input.id,
        input.name,
        input.host,
        input.publicIpv4,
        input.port,
        input.hostKeyFingerprint,
        input.encryptedKey,
        now,
        now,
      );
    return this.get(input.id)!;
  }
  routes(relayId: string): RelayRoute[] {
    return (
      this.db
        .prepare(
          "SELECT * FROM relay_routes WHERE relay_id=? ORDER BY listen_port",
        )
        .all(relayId) as Row[]
    ).map(route);
  }
  getRoute(id: string): RelayRoute | null {
    const row = this.db
      .prepare("SELECT * FROM relay_routes WHERE id=?")
      .get(id) as Row | undefined;
    return row ? route(row) : null;
  }
  instanceRoute(instanceId: string): RelayRoute | null {
    const row = this.db
      .prepare("SELECT * FROM relay_routes WHERE instance_id=?")
      .get(instanceId) as Row | undefined;
    return row ? route(row) : null;
  }
  operations(relayId: string): RelayOperation[] {
    return (
      this.db
        .prepare(
          "SELECT * FROM relay_operations WHERE relay_id=? ORDER BY created_at DESC LIMIT 50",
        )
        .all(relayId) as Row[]
    ).map(operation);
  }
  getOperation(
    relayId: string,
    operationId: string,
  ): StoredRelayOperation | null {
    const row = this.db
      .prepare(
        "SELECT * FROM relay_operations WHERE relay_id=? AND operation_id=?",
      )
      .get(relayId, operationId) as Row | undefined;
    return row
      ? {
          record: operation(row),
          requestHash: String(row.request_hash),
          request: JSON.parse(String(row.request_json)) as Record<
            string,
            unknown
          >,
        }
      : null;
  }
  pending(relayId: string): boolean {
    return Boolean(
      this.db
        .prepare(
          "SELECT 1 FROM relay_operations WHERE relay_id=? AND status IN ('pending','uncertain')",
        )
        .get(relayId),
    );
  }
  begin(
    relayId: string,
    operationId: string,
    action: string,
    requestHash: string,
    request: Record<string, unknown>,
  ): StoredRelayOperation {
    const now = utcNow();
    this.db
      .prepare(
        `INSERT INTO relay_operations(id,relay_id,operation_id,action,request_hash,request_json,status,created_at,updated_at)
      VALUES (?,?,?,?,?,?,'pending',?,?)`,
      )
      .run(
        uuidv7(),
        relayId,
        operationId,
        action,
        requestHash,
        JSON.stringify(request),
        now,
        now,
      );
    return this.getOperation(relayId, operationId)!;
  }
  finish(
    relayId: string,
    operationId: string,
    status: RelayOperation["status"],
    errorCode: string | null,
  ): void {
    this.db
      .prepare(
        "UPDATE relay_operations SET status=?,error_code=?,updated_at=? WHERE relay_id=? AND operation_id=?",
      )
      .run(status, errorCode, utcNow(), relayId, operationId);
  }
  health(
    id: string,
    status: RelayServer["status"],
    fingerprint: string | null,
    helperVersion: string | null,
    errorCode: string | null,
  ): void {
    this.db
      .prepare(
        `UPDATE relay_servers SET status=?, source_fingerprint=COALESCE(?,source_fingerprint),
      helper_version=COALESCE(?,helper_version),last_checked_at=?,last_error_code=?,updated_at=? WHERE id=?`,
      )
      .run(
        status,
        fingerprint,
        helperVersion,
        utcNow(),
        errorCode,
        utcNow(),
        id,
      );
  }
  commit(
    relayId: string,
    operationId: string,
    routes: RelayRoute[],
    fingerprint: string,
    helperVersion: string,
    installed: boolean,
    active: boolean,
  ): void {
    this.db.transaction(() => {
      this.db.prepare("DELETE FROM relay_routes WHERE relay_id=?").run(relayId);
      const insert = this.db.prepare(
        `INSERT INTO relay_routes(id,relay_id,instance_id,listen_port,upstream_ipv4,upstream_port,enabled,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)`,
      );
      for (const r of routes)
        insert.run(
          r.id,
          relayId,
          r.instanceId,
          r.listenPort,
          r.upstreamIpv4,
          r.upstreamPort,
          Number(r.enabled),
          r.createdAt,
          utcNow(),
        );
      this.health(
        relayId,
        installed ? (active ? "ready" : "offline") : "uninstalled",
        fingerprint,
        helperVersion,
        null,
      );
      this.finish(relayId, operationId, "succeeded", null);
    })();
  }
  endpoint(instanceId: string): RelayEndpoint | null {
    const r = this.instanceRoute(instanceId);
    if (!r?.enabled) return null;
    const s = this.get(r.relayId);
    if (
      !s ||
      s.status !== "ready" ||
      !s.lastCheckedAt ||
      Date.now() - Date.parse(s.lastCheckedAt) > 120_000 ||
      this.pending(s.id)
    )
      return null;
    return { routeId: r.id, host: s.publicIpv4, port: r.listenPort };
  }
  delete(id: string): void {
    this.db.transaction(() => {
      this.db.prepare("DELETE FROM relay_operations WHERE relay_id=?").run(id);
      this.db.prepare("DELETE FROM relay_routes WHERE relay_id=?").run(id);
      this.db.prepare("DELETE FROM relay_servers WHERE id=?").run(id);
    })();
  }
}
