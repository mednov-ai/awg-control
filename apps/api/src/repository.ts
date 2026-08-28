import type { Admin, Connection, InstanceRecord, NodeRecord, QuotaPolicy, VpnUser } from "@awg-control/contracts";

import type { SqliteDatabase } from "./database.js";
import { utcNow, uuidv7 } from "./lib/ids.js";
import { hashOpaque } from "./security/crypto.js";

type Row = Record<string, unknown>;

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function toAdmin(row: Row): Admin {
  return {
    id: String(row.id),
    username: String(row.username),
    totpEnabled: Boolean(row.totp_enabled),
    status: row.status as Admin["status"],
    lastLoginAt: stringOrNull(row.last_login_at),
  };
}

function toNode(row: Row): NodeRecord {
  return {
    id: String(row.id),
    name: String(row.name),
    description: stringOrNull(row.description),
    host: String(row.host),
    port: Number(row.port),
    sshUsername: String(row.ssh_username),
    hostKeyFingerprint: String(row.host_key_fingerprint),
    status: row.status as NodeRecord["status"],
    helperVersion: stringOrNull(row.helper_version),
    lastSeenAt: stringOrNull(row.last_seen_at),
    lastErrorCode: stringOrNull(row.last_error_code),
    pollIntervalSeconds: Number(row.poll_interval_seconds),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function toInstance(row: Row): InstanceRecord {
  return {
    id: String(row.id),
    nodeId: String(row.node_id),
    displayName: String(row.display_name),
    adapter: row.adapter as InstanceRecord["adapter"],
    protocolVersion: row.protocol_version as InstanceRecord["protocolVersion"],
    containerRef: String(row.container_ref),
    interfaceName: String(row.interface_name),
    configRef: String(row.config_ref),
    capabilities: JSON.parse(String(row.capabilities_json)) as InstanceRecord["capabilities"],
    sourceFingerprint: String(row.source_fingerprint),
    mode: row.mode as InstanceRecord["mode"],
    lastDiscoveredAt: String(row.last_discovered_at),
  };
}

function toUser(row: Row): VpnUser {
  return {
    id: String(row.id),
    nodeId: String(row.node_id),
    displayName: String(row.display_name),
    externalReference: stringOrNull(row.external_reference),
    status: row.status as VpnUser["status"],
    notes: stringOrNull(row.notes),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function toConnection(row: Row): Connection {
  return {
    id: String(row.id),
    vpnUserId: String(row.vpn_user_id),
    instanceId: String(row.instance_id),
    name: String(row.name),
    publicKey: String(row.public_key),
    addressCidr: String(row.address_cidr),
    source: row.source as Connection["source"],
    managementMode: row.management_mode as Connection["managementMode"],
    status: row.status as Connection["status"],
    expiresAt: stringOrNull(row.expires_at),
    quotaPolicyId: stringOrNull(row.quota_policy_id),
    quotaOverrideAt: stringOrNull(row.quota_override_at),
    lastHandshakeAt: stringOrNull(row.last_handshake_at),
    rxBytesTotal: Number(row.rx_bytes_total),
    txBytesTotal: Number(row.tx_bytes_total),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    revokedAt: stringOrNull(row.revoked_at),
  };
}

function toQuota(row: Row): QuotaPolicy {
  return {
    id: String(row.id),
    nodeId: String(row.node_id),
    name: String(row.name),
    limitBytes: Number(row.limit_bytes),
    period: row.period as QuotaPolicy["period"],
    resetTimezone: String(row.reset_timezone),
    action: "suspend",
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export interface AdminSecretRecord {
  id: string;
  username: string;
  passwordHash: string;
  totpEnabled: boolean;
  totpSecretEncrypted: string | null;
  status: "active" | "disabled";
}

export interface SessionRecord {
  admin: Admin;
  expiresAt: string;
  pendingTotpSecretEncrypted: string | null;
}

export interface NodeSecretRecord {
  node: NodeRecord;
  transportPrivateKeyEncrypted: string;
}

export interface AuditInput {
  adminId?: string | null;
  action: string;
  targetType: string;
  targetId?: string | null;
  nodeId?: string | null;
  operationId?: string | null;
  result: "success" | "failure" | "rejected";
  errorCode?: string | null;
  remoteAddress?: string | null;
  details?: Record<string, string | number | boolean | null>;
}

export class Repository {
  private workerHeartbeatAt: number | null = null;

  public constructor(private readonly db: SqliteDatabase) {}

  public markWorkerHeartbeat(): void {
    this.workerHeartbeatAt = Date.now();
  }

  public ready(pollingEnabled: boolean): boolean {
    try {
      this.db.prepare("SELECT 1").get();
    } catch {
      return false;
    }
    return !pollingEnabled || (this.workerHeartbeatAt !== null && Date.now() - this.workerHeartbeatAt < 120_000);
  }

  public countAdmins(): number {
    return Number((this.db.prepare("SELECT COUNT(*) AS count FROM admins").get() as { count: number }).count);
  }

  public createAdmin(username: string, passwordHash: string): Admin {
    const id = uuidv7();
    const now = utcNow();
    this.db
      .prepare(
        `INSERT INTO admins(id, username, password_hash, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(id, username, passwordHash, now, now);
    return this.getAdmin(id)!;
  }

  public getAdmin(id: string): Admin | null {
    const row = this.db.prepare("SELECT * FROM admins WHERE id = ?").get(id) as Row | undefined;
    return row ? toAdmin(row) : null;
  }

  public findAdminSecretByUsername(username: string): AdminSecretRecord | null {
    const row = this.db.prepare("SELECT * FROM admins WHERE username = ? COLLATE NOCASE").get(username) as Row | undefined;
    if (!row) return null;
    return {
      id: String(row.id),
      username: String(row.username),
      passwordHash: String(row.password_hash),
      totpEnabled: Boolean(row.totp_enabled),
      totpSecretEncrypted: stringOrNull(row.totp_secret_encrypted),
      status: row.status as AdminSecretRecord["status"],
    };
  }

  public updateAdminLogin(id: string): void {
    const now = utcNow();
    this.db.prepare("UPDATE admins SET last_login_at = ?, updated_at = ? WHERE id = ?").run(now, now, id);
  }

  public enableTotp(adminId: string, encryptedSecret: string, recoveryCodeHashes: string[]): void {
    const now = utcNow();
    this.db.transaction(() => {
      this.db
        .prepare("UPDATE admins SET totp_enabled = 1, totp_secret_encrypted = ?, updated_at = ? WHERE id = ?")
        .run(encryptedSecret, now, adminId);
      this.db.prepare("DELETE FROM admin_recovery_codes WHERE admin_id = ?").run(adminId);
      const insert = this.db.prepare(
        "INSERT INTO admin_recovery_codes(admin_id, code_hash, created_at) VALUES (?, ?, ?)",
      );
      for (const hash of recoveryCodeHashes) insert.run(adminId, hash, now);
    })();
  }

  public consumeRecoveryCode(adminId: string, code: string): boolean {
    const hash = hashOpaque(code.trim().toUpperCase());
    const result = this.db
      .prepare("UPDATE admin_recovery_codes SET used_at = ? WHERE admin_id = ? AND code_hash = ? AND used_at IS NULL")
      .run(utcNow(), adminId, hash);
    return result.changes === 1;
  }

  public createSession(adminId: string, token: string, expiresAt: string, remoteAddress: string | null): void {
    const now = utcNow();
    this.db
      .prepare(
        `INSERT INTO sessions(id_hash, admin_id, expires_at, created_at, last_seen_at, remote_address)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(hashOpaque(token), adminId, expiresAt, now, now, remoteAddress);
  }

  public getSession(token: string): SessionRecord | null {
    const row = this.db
      .prepare(
        `SELECT s.expires_at, s.pending_totp_secret_encrypted, a.*
         FROM sessions s JOIN admins a ON a.id = s.admin_id
         WHERE s.id_hash = ? AND s.expires_at > ? AND a.status = 'active'`,
      )
      .get(hashOpaque(token), utcNow()) as Row | undefined;
    if (!row) return null;
    return {
      admin: toAdmin(row),
      expiresAt: String(row.expires_at),
      pendingTotpSecretEncrypted: stringOrNull(row.pending_totp_secret_encrypted),
    };
  }

  public touchSession(token: string): void {
    this.db.prepare("UPDATE sessions SET last_seen_at = ? WHERE id_hash = ?").run(utcNow(), hashOpaque(token));
  }

  public deleteSession(token: string): void {
    this.db.prepare("DELETE FROM sessions WHERE id_hash = ?").run(hashOpaque(token));
  }

  public setPendingTotp(token: string, encryptedSecret: string | null): void {
    this.db
      .prepare("UPDATE sessions SET pending_totp_secret_encrypted = ? WHERE id_hash = ?")
      .run(encryptedSecret, hashOpaque(token));
  }

  public pruneSessions(): void {
    this.db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(utcNow());
  }

  public createNode(input: {
    id: string;
    name: string;
    description: string | null;
    host: string;
    port: number;
    sshUsername: string;
    hostKeyFingerprint: string;
    transportPrivateKeyEncrypted: string;
    pollIntervalSeconds: number;
  }): NodeRecord {
    const now = utcNow();
    this.db
      .prepare(
        `INSERT INTO nodes(
           id, name, description, host, port, ssh_username, host_key_fingerprint,
           transport_private_key_encrypted, poll_interval_seconds, next_poll_at, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.id,
        input.name,
        input.description,
        input.host,
        input.port,
        input.sshUsername,
        input.hostKeyFingerprint,
        input.transportPrivateKeyEncrypted,
        input.pollIntervalSeconds,
        now,
        now,
        now,
      );
    return this.getNode(input.id)!;
  }

  public listNodes(): NodeRecord[] {
    return (this.db.prepare("SELECT * FROM nodes ORDER BY name COLLATE NOCASE").all() as Row[]).map(toNode);
  }

  public getNode(id: string): NodeRecord | null {
    const row = this.db.prepare("SELECT * FROM nodes WHERE id = ?").get(id) as Row | undefined;
    return row ? toNode(row) : null;
  }

  public getNodeSecret(id: string): NodeSecretRecord | null {
    const row = this.db.prepare("SELECT * FROM nodes WHERE id = ?").get(id) as Row | undefined;
    return row
      ? { node: toNode(row), transportPrivateKeyEncrypted: String(row.transport_private_key_encrypted) }
      : null;
  }

  public nodesDueForPoll(limit = 5): NodeSecretRecord[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM nodes
         WHERE next_poll_at IS NULL OR next_poll_at <= ?
         ORDER BY COALESCE(next_poll_at, created_at) LIMIT ?`,
      )
      .all(utcNow(), limit) as Row[];
    return rows.map((row) => ({ node: toNode(row), transportPrivateKeyEncrypted: String(row.transport_private_key_encrypted) }));
  }

  public updateNodeHealth(
    id: string,
    status: NodeRecord["status"],
    helperVersion: string | null,
    errorCode: string | null,
  ): void {
    const now = utcNow();
    const node = this.getNode(id);
    if (!node) return;
    const nextPoll = new Date(Date.now() + node.pollIntervalSeconds * 1000).toISOString();
    this.db
      .prepare(
        `UPDATE nodes SET status = ?, helper_version = COALESCE(?, helper_version),
         last_seen_at = CASE WHEN ? IS NULL THEN ? ELSE last_seen_at END,
         last_error_code = ?, next_poll_at = ?, updated_at = ? WHERE id = ?`,
      )
      .run(status, helperVersion, errorCode, now, errorCode, nextPoll, now, id);
  }

  public upsertInstances(nodeId: string, instances: Omit<InstanceRecord, "nodeId">[]): InstanceRecord[] {
    const statement = this.db.prepare(
      `INSERT INTO instances(
         id, node_id, display_name, adapter, protocol_version, container_ref, interface_name, config_ref,
         capabilities_json, source_fingerprint, mode, last_discovered_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(node_id, container_ref, interface_name) DO UPDATE SET
         display_name = excluded.display_name,
         adapter = excluded.adapter,
         protocol_version = excluded.protocol_version,
         config_ref = excluded.config_ref,
         capabilities_json = excluded.capabilities_json,
         source_fingerprint = excluded.source_fingerprint,
         last_discovered_at = excluded.last_discovered_at`,
    );
    this.db.transaction(() => {
      for (const instance of instances) {
        statement.run(
          instance.id,
          nodeId,
          instance.displayName,
          instance.adapter,
          instance.protocolVersion,
          instance.containerRef,
          instance.interfaceName,
          instance.configRef,
          JSON.stringify(instance.capabilities),
          instance.sourceFingerprint,
          instance.mode,
          instance.lastDiscoveredAt,
        );
      }
    })();
    return this.listInstances(nodeId);
  }

  public listInstances(nodeId: string): InstanceRecord[] {
    return (this.db.prepare("SELECT * FROM instances WHERE node_id = ? ORDER BY display_name").all(nodeId) as Row[]).map(
      toInstance,
    );
  }

  public getInstance(id: string): InstanceRecord | null {
    const row = this.db.prepare("SELECT * FROM instances WHERE id = ?").get(id) as Row | undefined;
    return row ? toInstance(row) : null;
  }

  public updateInstanceFingerprint(id: string, sourceFingerprint: string): void {
    this.db.prepare("UPDATE instances SET source_fingerprint = ?, last_discovered_at = ? WHERE id = ?").run(sourceFingerprint, utcNow(), id);
  }

  public enableInstanceManagement(id: string): InstanceRecord | null {
    this.db
      .prepare(
        `UPDATE instances SET mode = 'managed'
         WHERE id = ? AND json_extract(capabilities_json, '$.create') = 1 AND mode != 'read-only'`,
      )
      .run(id);
    return this.getInstance(id);
  }

  public createUser(input: {
    nodeId: string;
    displayName: string;
    externalReference: string | null;
    notes: string | null;
  }): VpnUser {
    const id = uuidv7();
    const now = utcNow();
    this.db
      .prepare(
        `INSERT INTO vpn_users(id, node_id, display_name, external_reference, notes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, input.nodeId, input.displayName, input.externalReference, input.notes, now, now);
    return this.getUser(id)!;
  }

  public listUsers(search?: string): VpnUser[] {
    const rows = search
      ? (this.db
          .prepare("SELECT * FROM vpn_users WHERE display_name LIKE ? ESCAPE '\\' ORDER BY display_name LIMIT 200")
          .all(`%${search.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`) as Row[])
      : (this.db.prepare("SELECT * FROM vpn_users ORDER BY display_name LIMIT 200").all() as Row[]);
    return rows.map(toUser);
  }

  public getUser(id: string): VpnUser | null {
    const row = this.db.prepare("SELECT * FROM vpn_users WHERE id = ?").get(id) as Row | undefined;
    return row ? toUser(row) : null;
  }

  public listConnectionsForUser(userId: string): Connection[] {
    return (this.db.prepare("SELECT * FROM connections WHERE vpn_user_id = ? ORDER BY created_at DESC").all(userId) as Row[]).map(
      toConnection,
    );
  }

  public listConnectionsForInstance(instanceId: string): Connection[] {
    return (this.db.prepare("SELECT * FROM connections WHERE instance_id = ? AND status != 'revoked'").all(instanceId) as Row[]).map(
      toConnection,
    );
  }

  public getConnection(id: string): Connection | null {
    const row = this.db.prepare("SELECT * FROM connections WHERE id = ?").get(id) as Row | undefined;
    return row ? toConnection(row) : null;
  }

  public createConnection(input: {
    id: string;
    vpnUserId: string;
    instanceId: string;
    name: string;
    publicKey: string;
    addressCidr: string;
    source: Connection["source"];
    managementMode: Connection["managementMode"];
    status: Connection["status"];
    expiresAt: string | null;
    quotaPolicyId: string | null;
  }): Connection {
    const now = utcNow();
    this.db
      .prepare(
        `INSERT INTO connections(
           id, vpn_user_id, instance_id, name, public_key, address_cidr, source,
           management_mode, status, expires_at, quota_policy_id, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.id,
        input.vpnUserId,
        input.instanceId,
        input.name,
        input.publicKey,
        input.addressCidr,
        input.source,
        input.managementMode,
        input.status,
        input.expiresAt,
        input.quotaPolicyId,
        now,
        now,
      );
    return this.getConnection(input.id)!;
  }

  public updateConnectionStatus(id: string, status: Connection["status"]): Connection | null {
    const now = utcNow();
    this.db
      .prepare("UPDATE connections SET status = ?, revoked_at = CASE WHEN ? = 'revoked' THEN ? ELSE revoked_at END, updated_at = ? WHERE id = ?")
      .run(status, status, now, now, id);
    return this.getConnection(id);
  }

  public applyConnectionOverride(id: string, previousStatus: Connection["status"]): Connection | null {
    const now = utcNow();
    if (previousStatus === "quota-exceeded") {
      this.db
        .prepare(
          `UPDATE connections SET status = 'active', quota_override_at = ?, quota_override_used_bytes = 0,
           updated_at = ? WHERE id = ?`,
        )
        .run(now, now, id);
    } else if (previousStatus === "expired") {
      this.db
        .prepare("UPDATE connections SET status = 'active', expires_at = NULL, updated_at = ? WHERE id = ?")
        .run(now, id);
    } else {
      return this.updateConnectionStatus(id, "active");
    }
    return this.getConnection(id);
  }

  public adoptConnection(id: string): Connection | null {
    this.db
      .prepare("UPDATE connections SET management_mode = 'managed', updated_at = ? WHERE id = ? AND source = 'imported'")
      .run(utcNow(), id);
    return this.getConnection(id);
  }

  public importConnection(input: {
    vpnUserId: string;
    instanceId: string;
    name: string;
    publicKey: string;
    addressCidr: string;
  }): Connection {
    return this.createConnection({
      id: uuidv7(),
      ...input,
      source: "imported",
      managementMode: "observed",
      status: "active",
      expiresAt: null,
      quotaPolicyId: null,
    });
  }

  public importConnections(
    inputs: Array<{
      vpnUserId: string;
      instanceId: string;
      name: string;
      publicKey: string;
      addressCidr: string;
    }>,
  ): Connection[] {
    return this.db.transaction(() => inputs.map((input) => this.importConnection(input)))();
  }

  public connectionsByPublicKeys(instanceId: string, publicKeys: string[]): Connection[] {
    if (publicKeys.length === 0) return [];
    const placeholders = publicKeys.map(() => "?").join(",");
    const rows = this.db
      .prepare(`SELECT * FROM connections WHERE instance_id = ? AND public_key IN (${placeholders}) ORDER BY created_at`)
      .all(instanceId, ...publicKeys) as Row[];
    return rows.map(toConnection);
  }

  public updateTraffic(input: {
    connectionId: string;
    rx: number;
    tx: number;
    lastHandshakeAt: string | null;
  }): void {
    const row = this.db
      .prepare("SELECT last_counter_rx, last_counter_tx, counter_epoch FROM connections WHERE id = ?")
      .get(input.connectionId) as { last_counter_rx: number; last_counter_tx: number; counter_epoch: number } | undefined;
    if (!row) return;
    const reset = input.rx < row.last_counter_rx || input.tx < row.last_counter_tx;
    const deltaRx = reset ? input.rx : input.rx - row.last_counter_rx;
    const deltaTx = reset ? input.tx : input.tx - row.last_counter_tx;
    const now = utcNow();
    const hour = `${now.slice(0, 13)}:00:00.000Z`;
    const day = `${now.slice(0, 10)}T00:00:00.000Z`;
    this.db.transaction(() => {
      this.db
        .prepare(
          `UPDATE connections SET rx_bytes_total = rx_bytes_total + ?, tx_bytes_total = tx_bytes_total + ?,
           last_counter_rx = ?, last_counter_tx = ?, counter_epoch = counter_epoch + ?,
           quota_override_used_bytes = quota_override_used_bytes + ?,
           last_handshake_at = ?, updated_at = ? WHERE id = ?`,
        )
        .run(
          deltaRx,
          deltaTx,
          input.rx,
          input.tx,
          reset ? 1 : 0,
          deltaRx + deltaTx,
          input.lastHandshakeAt,
          now,
          input.connectionId,
        );
      const rollup = this.db.prepare(
        `INSERT INTO traffic_rollups(connection_id, bucket_start, bucket_kind, rx_bytes, tx_bytes)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(connection_id, bucket_start, bucket_kind) DO UPDATE SET
         rx_bytes = rx_bytes + excluded.rx_bytes, tx_bytes = tx_bytes + excluded.tx_bytes`,
      );
      rollup.run(input.connectionId, hour, "hourly", deltaRx, deltaTx);
      rollup.run(input.connectionId, day, "daily", deltaRx, deltaTx);
    })();
  }

  public traffic(connectionId: string): {
    totals: { rxBytes: number; txBytes: number };
    hourly: Array<{ bucketStart: string; rxBytes: number; txBytes: number }>;
    daily: Array<{ bucketStart: string; rxBytes: number; txBytes: number }>;
  } | null {
    const connection = this.getConnection(connectionId);
    if (!connection) return null;
    const rows = this.db
      .prepare("SELECT * FROM traffic_rollups WHERE connection_id = ? ORDER BY bucket_start")
      .all(connectionId) as Row[];
    const map = (kind: string) =>
      rows
        .filter((row) => row.bucket_kind === kind)
        .map((row) => ({ bucketStart: String(row.bucket_start), rxBytes: Number(row.rx_bytes), txBytes: Number(row.tx_bytes) }));
    return {
      totals: { rxBytes: connection.rxBytesTotal, txBytes: connection.txBytesTotal },
      hourly: map("hourly"),
      daily: map("daily"),
    };
  }

  public pruneTraffic(hourlyBefore: string, dailyBefore: string): void {
    this.db
      .prepare("DELETE FROM traffic_rollups WHERE (bucket_kind = 'hourly' AND bucket_start < ?) OR (bucket_kind = 'daily' AND bucket_start < ?)")
      .run(hourlyBefore, dailyBefore);
  }

  public createQuota(input: {
    nodeId: string;
    name: string;
    limitBytes: number;
    period: QuotaPolicy["period"];
    resetTimezone: string;
  }): QuotaPolicy {
    const id = uuidv7();
    const now = utcNow();
    this.db
      .prepare(
        `INSERT INTO quota_policies(id, node_id, name, limit_bytes, period, reset_timezone, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, input.nodeId, input.name, input.limitBytes, input.period, input.resetTimezone, now, now);
    return this.getQuota(id)!;
  }

  public getQuota(id: string): QuotaPolicy | null {
    const row = this.db.prepare("SELECT * FROM quota_policies WHERE id = ?").get(id) as Row | undefined;
    return row ? toQuota(row) : null;
  }

  public listQuotas(): QuotaPolicy[] {
    return (this.db.prepare("SELECT * FROM quota_policies ORDER BY name").all() as Row[]).map(toQuota);
  }

  public policyProjectionForNode(nodeId: string): Array<{
    connectionId: string;
    instanceId: string;
    publicKey: string;
    expiresAt: string | null;
    limitBytes: number | null;
    usedBytes: number;
    status: Extract<Connection["status"], "active" | "suspended" | "expired" | "quota-exceeded">;
    usageEpoch: string;
  }> {
    const rows = this.db
      .prepare(
        `SELECT c.id AS connection_id, c.instance_id, c.public_key, c.expires_at, c.status,
                c.rx_bytes_total, c.tx_bytes_total, c.quota_override_at, c.quota_override_used_bytes,
                q.limit_bytes, q.period, q.reset_timezone
         FROM connections c
         JOIN instances i ON i.id = c.instance_id
         LEFT JOIN quota_policies q ON q.id = c.quota_policy_id
         WHERE i.node_id = ?
           AND c.management_mode = 'managed'
           AND c.status IN ('active', 'suspended', 'expired', 'quota-exceeded')
           AND (c.expires_at IS NOT NULL OR c.quota_policy_id IS NOT NULL OR c.status != 'active')`,
      )
      .all(nodeId) as Row[];
    return rows.map((row) => {
      let usedBytes = Number(row.rx_bytes_total) + Number(row.tx_bytes_total);
      const period = stringOrNull(row.period);
      let usageEpoch = "lifetime";
      if (period === "month" || period === "calendar-month") {
        const start = period === "month"
          ? new Date(Date.now() - 30 * 86_400_000).toISOString()
          : calendarMonthStart(String(row.reset_timezone));
        usageEpoch = period === "calendar-month" ? start : "rolling-month";
        const total = this.db
          .prepare(
            `SELECT COALESCE(SUM(rx_bytes + tx_bytes), 0) AS used
             FROM traffic_rollups WHERE connection_id = ? AND bucket_kind = 'daily' AND bucket_start >= ?`,
          )
          .get(String(row.connection_id), start) as { used: number };
        usedBytes = Number(total.used);
      }
      const overrideAt = stringOrNull(row.quota_override_at);
      const overrideApplies = overrideAt !== null && (
        period === "lifetime" ||
        (period === "month" && overrideAt >= new Date(Date.now() - 30 * 86_400_000).toISOString()) ||
        (period === "calendar-month" && overrideAt >= calendarMonthStart(String(row.reset_timezone)))
      );
      if (overrideApplies) {
        usedBytes = Number(row.quota_override_used_bytes);
        usageEpoch = `override:${overrideAt}`;
      }
      return {
        connectionId: String(row.connection_id),
        instanceId: String(row.instance_id),
        publicKey: String(row.public_key),
        expiresAt: stringOrNull(row.expires_at),
        limitBytes: row.limit_bytes === null || row.limit_bytes === undefined ? null : Number(row.limit_bytes),
        usedBytes,
        status: row.status as "active" | "suspended" | "expired" | "quota-exceeded",
        usageEpoch,
      };
    });
  }

  public addAudit(input: AuditInput): void {
    const details = input.details ?? {};
    this.db
      .prepare(
        `INSERT INTO audit_events(
           id, occurred_at, admin_id, action, target_type, target_id, node_id, operation_id,
           result, error_code, remote_address, details_json
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        uuidv7(),
        utcNow(),
        input.adminId ?? null,
        input.action,
        input.targetType,
        input.targetId ?? null,
        input.nodeId ?? null,
        input.operationId ?? null,
        input.result,
        input.errorCode ?? null,
        input.remoteAddress ?? null,
        JSON.stringify(details),
      );
  }

  public listAudit(limit = 100): Array<Record<string, unknown>> {
    return (this.db.prepare("SELECT * FROM audit_events ORDER BY occurred_at DESC LIMIT ?").all(Math.min(limit, 500)) as Row[]).map(
      (row) => ({
        id: row.id,
        occurredAt: row.occurred_at,
        adminId: row.admin_id,
        action: row.action,
        targetType: row.target_type,
        targetId: row.target_id,
        nodeId: row.node_id,
        operationId: row.operation_id,
        result: row.result,
        errorCode: row.error_code,
        remoteAddress: row.remote_address,
        details: JSON.parse(String(row.details_json)) as unknown,
      }),
    );
  }

  public beginIdempotency(scope: string, operationId: string, fingerprint: string): "new" | "repeat" | "conflict" {
    const existing = this.db
      .prepare("SELECT request_hash FROM idempotency_records WHERE scope = ? AND operation_id = ?")
      .get(scope, operationId) as { request_hash: string } | undefined;
    if (existing) return existing.request_hash === fingerprint ? "repeat" : "conflict";
    const now = utcNow();
    this.db
      .prepare(
        `INSERT INTO idempotency_records(scope, operation_id, request_hash, result_type, status, created_at, updated_at)
         VALUES (?, ?, ?, 'metadata-only', 'started', ?, ?)`,
      )
      .run(scope, operationId, fingerprint, now, now);
    return "new";
  }

  public finishIdempotency(
    scope: string,
    operationId: string,
    status: "succeeded" | "failed",
    resultId: string | null,
    errorCode: string | null,
  ): void {
    this.db
      .prepare(
        `UPDATE idempotency_records SET status = ?, result_id = ?, error_code = ?, updated_at = ?
         WHERE scope = ? AND operation_id = ?`,
      )
      .run(status, resultId, errorCode, utcNow(), scope, operationId);
  }

  public idempotencyResult(scope: string, operationId: string): { status: string; resultId: string | null; errorCode: string | null } | null {
    const row = this.db
      .prepare("SELECT status, result_id, error_code FROM idempotency_records WHERE scope = ? AND operation_id = ?")
      .get(scope, operationId) as Row | undefined;
    return row ? { status: String(row.status), resultId: stringOrNull(row.result_id), errorCode: stringOrNull(row.error_code) } : null;
  }

  public dashboard(): Record<string, unknown> {
    const group = (table: string, field: string): Record<string, number> => {
      const rows = this.db.prepare(`SELECT ${field} AS value, COUNT(*) AS count FROM ${table} GROUP BY ${field}`).all() as Array<{
        value: string;
        count: number;
      }>;
      return Object.fromEntries(rows.map((row) => [row.value, Number(row.count)]));
    };
    const users = Number((this.db.prepare("SELECT COUNT(*) AS count FROM vpn_users").get() as { count: number }).count);
    const traffic = this.db
      .prepare("SELECT COALESCE(SUM(rx_bytes_total), 0) AS rx, COALESCE(SUM(tx_bytes_total), 0) AS tx FROM connections")
      .get() as { rx: number; tx: number };
    return {
      nodes: group("nodes", "status"),
      users,
      connections: group("connections", "status"),
      rxBytesTotal: Number(traffic.rx),
      txBytesTotal: Number(traffic.tx),
    };
  }
}

function calendarMonthStart(timeZone: string, now = new Date()): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(formatter.formatToParts(now).map((part) => [part.type, part.value]));
  const localGuess = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
  const offset = localGuess - now.getTime();
  return new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, 1) - offset).toISOString();
}
