import type { FastifyInstance, FastifyRequest } from "fastify";
import { Type } from "@sinclair/typebox";

import {
  API_VERSION,
  canTransitionConnection,
  ErrorCode,
  HELPER_PROTOCOL_VERSION,
  InstanceSchema,
  NodeSchema,
  OperationIdSchema,
  QuotaPolicySchema,
  UuidSchema,
  VpnUserSchema,
  type HelperRequest,
  type InstanceRecord,
} from "@awg-control/contracts";

import type { AppConfig } from "../config.js";
import type { HelperClient } from "../helper/client.js";
import { HelperTransportError } from "../helper/client.js";
import { utcNow, uuidv7 } from "../lib/ids.js";
import type { Repository } from "../repository.js";
import { encryptSecret, hashOpaque, requestFingerprint } from "../security/crypto.js";
import { AppError, conflict, notFound } from "./errors.js";
import { requireAdmin } from "./auth.js";

const IdParams = Type.Object({ id: UuidSchema }, { additionalProperties: false });
const IDEMPOTENCY_HEADER = "idempotency-key";

function operationId(request: FastifyRequest): string {
  const value = request.headers[IDEMPOTENCY_HEADER];
  if (typeof value !== "string" || value.length < 1 || value.length > 128 || !/^[A-Za-z0-9._:-]+$/.test(value)) {
    throw new AppError(400, ErrorCode.ValidationFailed, "A valid Idempotency-Key header is required");
  }
  return value;
}

function helperRequest(action: HelperRequest["action"], operation: string, parameters: Record<string, unknown>): HelperRequest {
  return {
    protocolVersion: HELPER_PROTOCOL_VERSION,
    requestId: uuidv7(),
    operationId: operation,
    action,
    parameters,
  };
}

function handleHelperError(error: unknown): never {
  if (error instanceof HelperTransportError) throw new AppError(502, error.code, error.message);
  throw error;
}

interface DiscoveryResult {
  helperVersion: string;
  instances: Array<{
    id: string;
    displayName: string;
    adapter: "amneziawg-legacy" | "awg2" | "awg3";
    protocolVersion?: InstanceRecord["protocolVersion"];
    containerRef: string;
    interfaceName: string;
    configRef: string;
    capabilities: InstanceRecord["capabilities"];
    sourceFingerprint: string;
    readOnly: boolean;
  }>;
}

interface CreateResult {
  publicKey: string;
  addressCidr: string;
  clientConfig: string;
  sourceFingerprint: string;
}

interface PeerListResult {
  peers: Array<{ publicKey: string; publicKeyFingerprint: string; addressCidr: string; name: string }>;
  sourceFingerprint: string;
}

interface StatsResult {
  peers: Array<{ publicKey: string; rxBytes: number; txBytes: number; lastHandshakeAt: string | null }>;
}

interface MutationResult {
  connectionId: string;
  sourceFingerprint: string;
}

export async function registerRoutes(
  app: FastifyInstance,
  repository: Repository,
  helper: HelperClient,
  config: AppConfig,
): Promise<void> {
  app.addHook("preHandler", async (request) => {
    if (request.url.startsWith(`/api/${API_VERSION}/`) && !request.url.includes("/auth/") && !request.url.includes("/health/")) {
      requireAdmin(request);
    }
  });

  app.get("/api/v1/dashboard", async () => repository.dashboard());

  app.get(
    "/api/v1/nodes",
    { schema: { tags: ["nodes"], response: { 200: Type.Object({ items: Type.Array(NodeSchema) }) } } },
    async () => ({ items: repository.listNodes() }),
  );

  app.post(
    "/api/v1/nodes/:id/verify-host-key",
    {
      schema: {
        tags: ["nodes"],
        params: IdParams,
        headers: Type.Object({ "idempotency-key": OperationIdSchema }, { additionalProperties: true }),
      },
    },
    async (request) => {
      const id = (request.params as { id: string }).id;
      const node = repository.getNode(id);
      if (!node) throw notFound("Node not found");
      const op = operationId(request);
      repository.addAudit({
        adminId: request.admin!.id,
        action: "node.host-key-confirm",
        targetType: "node",
        targetId: id,
        nodeId: id,
        operationId: op,
        result: "success",
        remoteAddress: request.ip,
        details: { fingerprintConfirmed: true },
      });
      return node;
    },
  );

  app.post(
    "/api/v1/nodes",
    {
      schema: {
        tags: ["nodes"],
        headers: Type.Object({ "idempotency-key": OperationIdSchema }, { additionalProperties: true }),
        body: Type.Object(
          {
            name: Type.String({ minLength: 1, maxLength: 120 }),
            description: Type.Optional(Type.Union([Type.String({ maxLength: 1000 }), Type.Null()])),
            host: Type.String({ minLength: 1, maxLength: 253 }),
            port: Type.Optional(Type.Integer({ minimum: 1, maximum: 65535 })),
            sshUsername: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
            hostKeyFingerprint: Type.String({ minLength: 16, maxLength: 256 }),
            transportPrivateKey: Type.String({ minLength: 64, maxLength: 32_768 }),
            pollIntervalSeconds: Type.Optional(Type.Integer({ minimum: 15, maximum: 3600 })),
          },
          { additionalProperties: false },
        ),
        response: { 201: NodeSchema },
      },
    },
    async (request, reply) => {
      const op = operationId(request);
      const body = request.body as {
        name: string;
        description?: string | null;
        host: string;
        port?: number;
        sshUsername?: string;
        hostKeyFingerprint: string;
        transportPrivateKey: string;
        pollIntervalSeconds?: number;
      };
      const fingerprint = requestFingerprint({ ...body, transportPrivateKey: hashOpaque(body.transportPrivateKey) });
      const start = repository.beginIdempotency("nodes.create", op, fingerprint);
      if (start === "conflict") throw conflict(ErrorCode.IdempotencyConflict, "Idempotency key was used with another request");
      if (start === "repeat") {
        const result = repository.idempotencyResult("nodes.create", op);
        if (result?.resultId) return repository.getNode(result.resultId) ?? notFound();
        throw conflict(ErrorCode.Conflict, "Node registration is already in progress");
      }
      const id = uuidv7();
      const node = repository.createNode({
        id,
        name: body.name,
        description: body.description ?? null,
        host: body.host,
        port: body.port ?? 22,
        sshUsername: body.sshUsername ?? "awg-control-agent",
        hostKeyFingerprint: body.hostKeyFingerprint,
        transportPrivateKeyEncrypted: encryptSecret(config.masterKey, `transport-key:${id}`, body.transportPrivateKey),
        pollIntervalSeconds: body.pollIntervalSeconds ?? 60,
      });
      repository.finishIdempotency("nodes.create", op, "succeeded", node.id, null);
      repository.addAudit({
        adminId: request.admin!.id,
        action: "node.register",
        targetType: "node",
        targetId: node.id,
        nodeId: node.id,
        operationId: op,
        result: "success",
        remoteAddress: request.ip,
      });
      return reply.code(201).send(node);
    },
  );

  app.post(
    "/api/v1/nodes/:id/discover",
    {
      schema: {
        tags: ["nodes"],
        params: IdParams,
        headers: Type.Object({ "idempotency-key": OperationIdSchema }, { additionalProperties: true }),
      },
    },
    async (request) => {
      const { id } = request.params as { id: string };
      const node = repository.getNodeSecret(id);
      if (!node) throw notFound("Node not found");
      const op = operationId(request);
      try {
        const response = await helper.call<DiscoveryResult>(node, helperRequest("discover", op, {}));
        if (!response.ok) throw new AppError(502, response.error.code, response.error.message);
        const discovered = response.result.instances.map((instance) => ({
          id: instance.id,
          displayName: instance.displayName,
          adapter: instance.adapter,
          protocolVersion: instance.protocolVersion ?? (instance.adapter === "awg2" ? "2" : "legacy"),
          containerRef: instance.containerRef,
          interfaceName: instance.interfaceName,
          configRef: instance.configRef,
          capabilities: instance.capabilities,
          sourceFingerprint: instance.sourceFingerprint,
          mode: instance.readOnly ? ("read-only" as const) : ("observed" as const),
          lastDiscoveredAt: utcNow(),
        }));
        const instances = repository.upsertInstances(id, discovered);
        repository.updateNodeHealth(id, "discovered", response.result.helperVersion, null);
        repository.addAudit({
          adminId: request.admin!.id,
          action: "node.discover",
          targetType: "node",
          targetId: id,
          nodeId: id,
          operationId: op,
          result: "success",
          remoteAddress: request.ip,
          details: { instances: instances.length },
        });
        return { items: instances };
      } catch (error) {
        repository.updateNodeHealth(id, "degraded", null, error instanceof AppError ? error.code : ErrorCode.HelperUnavailable);
        handleHelperError(error);
      }
    },
  );

  app.get(
    "/api/v1/nodes/:id/instances",
    { schema: { tags: ["nodes"], params: IdParams, response: { 200: Type.Object({ items: Type.Array(InstanceSchema) }) } } },
    async (request) => ({ items: repository.listInstances((request.params as { id: string }).id) }),
  );

  app.post(
    "/api/v1/instances/:id/manage",
    {
      schema: {
        tags: ["instances"],
        params: IdParams,
        headers: Type.Object({ "idempotency-key": OperationIdSchema }, { additionalProperties: true }),
      },
    },
    async (request) => {
      const id = (request.params as { id: string }).id;
      const instance = repository.getInstance(id);
      if (!instance) throw notFound("Instance not found");
      const op = operationId(request);
      if (!instance.capabilities.create || instance.mode === "read-only") {
        throw conflict(ErrorCode.AdapterReadOnly, "Helper did not confirm safe mutation capabilities");
      }
      const scope = `instances.manage:${id}`;
      const start = repository.beginIdempotency(scope, op, requestFingerprint({ id }));
      if (start === "conflict") throw conflict(ErrorCode.IdempotencyConflict, "Idempotency key was used with another request");
      if (start === "repeat") return repository.getInstance(id)!;
      const managed = repository.enableInstanceManagement(id);
      repository.finishIdempotency(scope, op, "succeeded", id, null);
      repository.addAudit({
        adminId: request.admin!.id,
        action: "instance.management-enable",
        targetType: "instance",
        targetId: id,
        nodeId: instance.nodeId,
        operationId: op,
        result: "success",
        remoteAddress: request.ip,
      });
      return managed;
    },
  );

  app.get(
    "/api/v1/instances/:id/peers",
    { schema: { tags: ["instances"], params: IdParams } },
    async (request) => {
      const id = (request.params as { id: string }).id;
      const instance = repository.getInstance(id);
      if (!instance) throw notFound("Instance not found");
      const node = repository.getNodeSecret(instance.nodeId)!;
      try {
        const response = await helper.call<PeerListResult>(
          node,
          helperRequest("list", uuidv7(), { instanceId: id }),
        );
        if (!response.ok) throw new AppError(502, response.error.code, response.error.message);
        return response.result;
      } catch (error) {
        handleHelperError(error);
      }
    },
  );

  app.post(
    "/api/v1/instances/:id/import",
    {
      schema: {
        tags: ["instances"],
        params: IdParams,
        headers: Type.Object({ "idempotency-key": OperationIdSchema }, { additionalProperties: true }),
        body: Type.Object(
          {
            peers: Type.Array(
              Type.Object(
                {
                  vpnUserId: UuidSchema,
                  name: Type.String({ minLength: 1, maxLength: 120 }),
                  publicKey: Type.String({ minLength: 20, maxLength: 128 }),
                  addressCidr: Type.String({ minLength: 3, maxLength: 64 }),
                },
                { additionalProperties: false },
              ),
              { minItems: 1, maxItems: 2000 },
            ),
          },
          { additionalProperties: false },
        ),
      },
    },
    async (request) => {
      const { id } = request.params as { id: string };
      const instance = repository.getInstance(id);
      if (!instance) throw notFound("Instance not found");
      const op = operationId(request);
      const body = request.body as {
        peers: Array<{ vpnUserId: string; name: string; publicKey: string; addressCidr: string }>;
      };
      const scope = `instances.import:${id}`;
      const start = repository.beginIdempotency(scope, op, requestFingerprint(body));
      if (start === "conflict") throw conflict(ErrorCode.IdempotencyConflict, "Idempotency key was used with another request");
      if (start === "repeat") {
        const prior = repository.idempotencyResult(scope, op);
        if (prior?.status === "succeeded") {
          return { items: repository.connectionsByPublicKeys(id, body.peers.map((peer) => peer.publicKey)) };
        }
        throw conflict(prior?.errorCode ?? ErrorCode.Conflict, "Previous import did not complete successfully");
      }
      const node = repository.getNodeSecret(instance.nodeId)!;
      try {
        const response = await helper.call<PeerListResult>(node, helperRequest("list", op, { instanceId: id }));
        if (!response.ok) throw new AppError(502, response.error.code, response.error.message);
        if (response.result.sourceFingerprint !== instance.sourceFingerprint) {
          throw conflict(ErrorCode.FingerprintConflict, "Instance configuration changed after discovery");
        }
        const observedByKey = new Map(response.result.peers.map((peer) => [peer.publicKey, peer]));
        for (const peer of body.peers) {
          const user = repository.getUser(peer.vpnUserId);
          if (!user || user.nodeId !== instance.nodeId) throw new AppError(400, ErrorCode.ValidationFailed, "User belongs to another Node");
          const actual = observedByKey.get(peer.publicKey);
          if (!actual || actual.addressCidr !== peer.addressCidr) {
            throw new AppError(409, ErrorCode.FingerprintConflict, "Peer no longer matches read-only discovery");
          }
        }
        const imported = repository.importConnections(body.peers.map((peer) => ({ ...peer, instanceId: id })));
        repository.finishIdempotency(scope, op, "succeeded", id, null);
        repository.addAudit({
          adminId: request.admin!.id,
          action: "instance.import",
          targetType: "instance",
          targetId: id,
          nodeId: instance.nodeId,
          operationId: op,
          result: "success",
          remoteAddress: request.ip,
          details: { connections: imported.length, managementMode: "observed" },
        });
        return { items: imported };
      } catch (error) {
        const code = error instanceof AppError ? error.code : ErrorCode.HelperUnavailable;
        repository.finishIdempotency(scope, op, "failed", id, code);
        repository.addAudit({
          adminId: request.admin!.id,
          action: "instance.import",
          targetType: "instance",
          targetId: id,
          nodeId: instance.nodeId,
          operationId: op,
          result: "failure",
          errorCode: code,
          remoteAddress: request.ip,
        });
        handleHelperError(error);
      }
    },
  );

  app.get(
    "/api/v1/users",
    {
      schema: {
        tags: ["users"],
        querystring: Type.Object({ search: Type.Optional(Type.String({ maxLength: 120 })) }, { additionalProperties: false }),
        response: { 200: Type.Object({ items: Type.Array(VpnUserSchema) }) },
      },
    },
    async (request) => ({ items: repository.listUsers((request.query as { search?: string }).search) }),
  );

  app.post(
    "/api/v1/users",
    {
      schema: {
        tags: ["users"],
        headers: Type.Object({ "idempotency-key": OperationIdSchema }, { additionalProperties: true }),
        body: Type.Object(
          {
            nodeId: UuidSchema,
            displayName: Type.String({ minLength: 1, maxLength: 120 }),
            externalReference: Type.Optional(Type.Union([Type.String({ maxLength: 255 }), Type.Null()])),
            notes: Type.Optional(Type.Union([Type.String({ maxLength: 4000 }), Type.Null()])),
          },
          { additionalProperties: false },
        ),
        response: { 201: VpnUserSchema },
      },
    },
    async (request, reply) => {
      const body = request.body as { nodeId: string; displayName: string; externalReference?: string | null; notes?: string | null };
      if (!repository.getNode(body.nodeId)) throw notFound("Node not found");
      const op = operationId(request);
      const fingerprint = requestFingerprint(body);
      const start = repository.beginIdempotency("users.create", op, fingerprint);
      if (start === "conflict") throw conflict(ErrorCode.IdempotencyConflict, "Idempotency key was used with another request");
      if (start === "repeat") {
        const record = repository.idempotencyResult("users.create", op);
        if (record?.resultId) return repository.getUser(record.resultId) ?? notFound();
        throw conflict(ErrorCode.Conflict, "User creation is already in progress");
      }
      const user = repository.createUser({
        nodeId: body.nodeId,
        displayName: body.displayName,
        externalReference: body.externalReference ?? null,
        notes: body.notes ?? null,
      });
      repository.finishIdempotency("users.create", op, "succeeded", user.id, null);
      repository.addAudit({
        adminId: request.admin!.id,
        action: "user.create",
        targetType: "vpn-user",
        targetId: user.id,
        nodeId: user.nodeId,
        operationId: op,
        result: "success",
        remoteAddress: request.ip,
      });
      return reply.code(201).send(user);
    },
  );

  app.get(
    "/api/v1/users/:id",
    { schema: { tags: ["users"], params: IdParams } },
    async (request) => {
      const id = (request.params as { id: string }).id;
      const user = repository.getUser(id);
      if (!user) throw notFound("VPN user not found");
      return { user, connections: repository.listConnectionsForUser(id) };
    },
  );

  app.post(
    "/api/v1/users/:id/connections",
    {
      schema: {
        tags: ["connections"],
        params: IdParams,
        headers: Type.Object({ "idempotency-key": OperationIdSchema }, { additionalProperties: true }),
        body: Type.Object(
          {
            instanceId: UuidSchema,
            name: Type.String({ minLength: 1, maxLength: 120 }),
            addressCidr: Type.String({ minLength: 3, maxLength: 64 }),
            expiresAt: Type.Optional(Type.Union([Type.String({ format: "date-time" }), Type.Null()])),
            quotaPolicyId: Type.Optional(Type.Union([UuidSchema, Type.Null()])),
          },
          { additionalProperties: false },
        ),
      },
    },
    async (request, reply) => {
      const userId = (request.params as { id: string }).id;
      const user = repository.getUser(userId);
      if (!user) throw notFound("VPN user not found");
      const body = request.body as {
        instanceId: string;
        name: string;
        addressCidr: string;
        expiresAt?: string | null;
        quotaPolicyId?: string | null;
      };
      const instance = repository.getInstance(body.instanceId);
      if (!instance || instance.nodeId !== user.nodeId) throw new AppError(400, ErrorCode.ValidationFailed, "Invalid Instance");
      if (instance.mode !== "managed" || !instance.capabilities.create) {
        throw conflict(ErrorCode.AdapterReadOnly, "Instance is not enabled for managed mutations");
      }
      if (body.quotaPolicyId) {
        const quota = repository.getQuota(body.quotaPolicyId);
        if (!quota || quota.nodeId !== user.nodeId) throw new AppError(400, ErrorCode.ValidationFailed, "Invalid quota policy");
      }
      const op = operationId(request);
      const scope = `connections.create:${userId}`;
      const start = repository.beginIdempotency(scope, op, requestFingerprint(body));
      if (start === "conflict") throw conflict(ErrorCode.IdempotencyConflict, "Idempotency key was used with another request");
      if (start === "repeat") {
        const record = repository.idempotencyResult(scope, op);
        const connection = record?.resultId ? repository.getConnection(record.resultId) : null;
        if (record?.status === "succeeded") {
          throw conflict(ErrorCode.ConfigAlreadyIssued, "Client configuration was already issued", { connection });
        }
        if (record?.status === "failed") throw conflict(record.errorCode ?? ErrorCode.Conflict, "Previous issuance failed");
        throw conflict(ErrorCode.Conflict, "Connection issuance is already in progress");
      }
      const node = repository.getNodeSecret(user.nodeId)!;
      const connectionId = uuidv7();
      try {
        const response = await helper.call<CreateResult>(
          node,
          helperRequest("create", op, {
            instanceId: instance.id,
            expectedFingerprint: instance.sourceFingerprint,
            connectionId,
            name: body.name,
            addressCidr: body.addressCidr,
            endpointHost: node.node.host,
            expiresAt: body.expiresAt ?? null,
          }),
        );
        if (!response.ok) throw new AppError(409, response.error.code, response.error.message);
        const connection = repository.createConnection({
          id: connectionId,
          vpnUserId: userId,
          instanceId: instance.id,
          name: body.name,
          publicKey: response.result.publicKey,
          addressCidr: response.result.addressCidr,
          source: "created",
          managementMode: "managed",
          status: "active",
          expiresAt: body.expiresAt ?? null,
          quotaPolicyId: body.quotaPolicyId ?? null,
        });
        repository.updateInstanceFingerprint(instance.id, response.result.sourceFingerprint);
        repository.finishIdempotency(scope, op, "succeeded", connection.id, null);
        repository.addAudit({
          adminId: request.admin!.id,
          action: "connection.issue",
          targetType: "connection",
          targetId: connection.id,
          nodeId: user.nodeId,
          operationId: op,
          result: "success",
          remoteAddress: request.ip,
          details: { instanceId: instance.id, configIssued: true },
        });
        reply.header("Cache-Control", "no-store, max-age=0");
        reply.header("Pragma", "no-cache");
        return reply.code(201).send({ connection, clientConfig: response.result.clientConfig });
      } catch (error) {
        repository.finishIdempotency(scope, op, "failed", null, error instanceof AppError ? error.code : ErrorCode.InternalError);
        handleHelperError(error);
      }
    },
  );

  app.post(
    "/api/v1/connections/:id/adopt",
    {
      schema: {
        tags: ["connections"],
        params: IdParams,
        headers: Type.Object({ "idempotency-key": OperationIdSchema }, { additionalProperties: true }),
        body: Type.Object({}, { additionalProperties: false }),
      },
    },
    async (request) => {
      const op = operationId(request);
      const id = (request.params as { id: string }).id;
      const connection = repository.getConnection(id);
      if (!connection) throw notFound("Connection not found");
      if (connection.source !== "imported") throw conflict(ErrorCode.Conflict, "Only imported connections require adoption");
      const instance = repository.getInstance(connection.instanceId);
      if (!instance || instance.mode !== "managed" || !instance.capabilities.create) {
        throw conflict(ErrorCode.AdapterReadOnly, "Instance management must be enabled before adoption");
      }
      const scope = `connections.adopt:${id}`;
      const start = repository.beginIdempotency(scope, op, requestFingerprint({ id, action: "adopt" }));
      if (start === "conflict") throw conflict(ErrorCode.IdempotencyConflict, "Idempotency key was used with another request");
      if (start === "repeat") return repository.getConnection(id)!;
      const updated = repository.adoptConnection(id)!;
      repository.finishIdempotency(scope, op, "succeeded", id, null);
      repository.addAudit({
        adminId: request.admin!.id,
        action: "connection.adopt",
        targetType: "connection",
        targetId: id,
        operationId: op,
        result: "success",
        remoteAddress: request.ip,
      });
      return updated;
    },
  );

  for (const action of ["suspend", "resume", "revoke"] as const) {
    const actionBody = action === "resume"
      ? Type.Object({ override: Type.Optional(Type.Boolean()) }, { additionalProperties: false })
      : Type.Object({}, { additionalProperties: false });
    app.post(
      `/api/v1/connections/:id/${action}`,
      {
        schema: {
          tags: ["connections"],
          params: IdParams,
          headers: Type.Object({ "idempotency-key": OperationIdSchema }, { additionalProperties: true }),
          body: actionBody,
        },
      },
      async (request) => {
        const id = (request.params as { id: string }).id;
        const connection = repository.getConnection(id);
        if (!connection) throw notFound("Connection not found");
        if (connection.managementMode !== "managed") throw conflict(ErrorCode.AdapterReadOnly, "Observed connection must be adopted first");
        const target = action === "suspend" ? "suspended" : action === "resume" ? "active" : "revoked";
        if (!canTransitionConnection(connection.status, target)) throw conflict(ErrorCode.Conflict, "Connection state transition is not allowed");
        const override = action === "resume" && Boolean((request.body as { override?: boolean }).override);
        const requiresOverride = action === "resume" && (connection.status === "expired" || connection.status === "quota-exceeded");
        if (requiresOverride && !override) {
          throw conflict(ErrorCode.Conflict, "Expired or quota-enforced connections require an explicit override");
        }
        const instance = repository.getInstance(connection.instanceId)!;
        const node = repository.getNodeSecret(instance.nodeId)!;
        const op = operationId(request);
        const scope = `connections.${action}:${id}`;
        const start = repository.beginIdempotency(scope, op, requestFingerprint({ id, action, override }));
        if (start === "conflict") throw conflict(ErrorCode.IdempotencyConflict, "Idempotency key was used with another request");
        if (start === "repeat") {
          const prior = repository.idempotencyResult(scope, op);
          if (prior?.status === "succeeded") return repository.getConnection(id)!;
          if (prior?.status === "failed") throw conflict(prior.errorCode ?? ErrorCode.Conflict, "Previous operation failed");
          throw conflict(ErrorCode.Conflict, "Connection operation is already in progress");
        }
        const rpcAction = action === "suspend" ? "disable" : action === "resume" ? "enable" : "revoke";
        try {
          const response = await helper.call<MutationResult>(
            node,
            helperRequest(rpcAction, op, {
              instanceId: instance.id,
              expectedFingerprint: instance.sourceFingerprint,
              connectionId: connection.id,
              publicKey: connection.publicKey,
              override,
            }),
          );
          if (!response.ok) throw new AppError(409, response.error.code, response.error.message);
          repository.updateInstanceFingerprint(instance.id, response.result.sourceFingerprint);
          const updated = override
            ? repository.applyConnectionOverride(id, connection.status)!
            : repository.updateConnectionStatus(id, target)!;
          repository.finishIdempotency(scope, op, "succeeded", id, null);
          repository.addAudit({
            adminId: request.admin!.id,
            action: `connection.${action}`,
            targetType: "connection",
            targetId: id,
            nodeId: instance.nodeId,
            operationId: op,
            result: "success",
            remoteAddress: request.ip,
            details: { override },
          });
          return updated;
        } catch (error) {
          const code = error instanceof AppError ? error.code : ErrorCode.HelperUnavailable;
          repository.finishIdempotency(scope, op, "failed", id, code);
          repository.addAudit({
            adminId: request.admin!.id,
            action: `connection.${action}`,
            targetType: "connection",
            targetId: id,
            nodeId: instance.nodeId,
            operationId: op,
            result: "failure",
            errorCode: code,
            remoteAddress: request.ip,
            details: { override },
          });
          handleHelperError(error);
        }
      },
    );
  }

  app.get(
    "/api/v1/connections/:id/traffic",
    { schema: { tags: ["connections"], params: IdParams } },
    async (request) => {
      const traffic = repository.traffic((request.params as { id: string }).id);
      if (!traffic) throw notFound("Connection not found");
      return traffic;
    },
  );

  app.get(
    "/api/v1/quota-policies",
    { schema: { tags: ["quotas"], response: { 200: Type.Object({ items: Type.Array(QuotaPolicySchema) }) } } },
    async () => ({ items: repository.listQuotas() }),
  );

  app.post(
    "/api/v1/quota-policies",
    {
      schema: {
        tags: ["quotas"],
        headers: Type.Object({ "idempotency-key": OperationIdSchema }, { additionalProperties: true }),
        body: Type.Object(
          {
            nodeId: UuidSchema,
            name: Type.String({ minLength: 1, maxLength: 120 }),
            limitBytes: Type.Integer({ minimum: 1 }),
            period: Type.Union([Type.Literal("lifetime"), Type.Literal("month"), Type.Literal("calendar-month")]),
            resetTimezone: Type.String({ minLength: 1, maxLength: 64 }),
          },
          { additionalProperties: false },
        ),
        response: { 201: QuotaPolicySchema },
      },
    },
    async (request, reply) => {
      const op = operationId(request);
      const body = request.body as {
        nodeId: string;
        name: string;
        limitBytes: number;
        period: "lifetime" | "month" | "calendar-month";
        resetTimezone: string;
      };
      if (!repository.getNode(body.nodeId)) throw notFound("Node not found");
      try {
        new Intl.DateTimeFormat("en", { timeZone: body.resetTimezone }).format();
      } catch {
        throw new AppError(400, ErrorCode.ValidationFailed, "Invalid reset timezone");
      }
      const scope = "quota-policies.create";
      const start = repository.beginIdempotency(scope, op, requestFingerprint(body));
      if (start === "conflict") throw conflict(ErrorCode.IdempotencyConflict, "Idempotency key was used with another request");
      if (start === "repeat") {
        const prior = repository.idempotencyResult(scope, op);
        if (prior?.resultId) return repository.getQuota(prior.resultId) ?? notFound();
        throw conflict(prior?.errorCode ?? ErrorCode.Conflict, "Quota creation did not complete successfully");
      }
      try {
        const quota = repository.createQuota(body);
        repository.finishIdempotency(scope, op, "succeeded", quota.id, null);
        repository.addAudit({
          adminId: request.admin!.id,
          action: "quota.create",
          targetType: "quota-policy",
          targetId: quota.id,
          nodeId: quota.nodeId,
          operationId: op,
          result: "success",
          remoteAddress: request.ip,
        });
        return reply.code(201).send(quota);
      } catch (error) {
        repository.finishIdempotency(scope, op, "failed", null, ErrorCode.InternalError);
        throw error;
      }
    },
  );

  app.get("/api/v1/audit-events", async (request) => {
    const limitValue = (request.query as { limit?: string }).limit;
    const limit = limitValue ? Number.parseInt(limitValue, 10) : 100;
    return { items: repository.listAudit(Number.isFinite(limit) ? limit : 100) };
  });

  app.get("/api/v1/health/live", { logLevel: "silent" }, async () => ({ status: "ok" }));
  app.get("/api/v1/health/ready", { logLevel: "silent" }, async (_request, reply) => {
    if (!repository.ready(config.pollingEnabled)) return reply.code(503).send({ status: "not-ready" });
    return { status: "ready" };
  });
}

export type { StatsResult };
