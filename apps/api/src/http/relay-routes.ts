import type { FastifyInstance, FastifyRequest } from "fastify";
import { Type } from "@sinclair/typebox";
import {
  OperationIdSchema,
  RegisterRelaySchema,
  RelayServerSchema,
  RelayRouteSchema,
  RelayOperationSchema,
  RelayStatusSchema,
  UuidSchema,
  RelayPortSchema,
  type RegisterRelay,
} from "@awg-control/contracts";
import type { Repository } from "../repository.js";
import type { AppConfig } from "../config.js";
import { publicIpv4 } from "../relay/service.js";
import type { RelayService } from "../relay/service.js";
import { uuidv7 } from "../lib/ids.js";
import {
  encryptSecret,
  hashOpaque,
  requestFingerprint,
} from "../security/crypto.js";
import { AppError, conflict, notFound } from "./errors.js";

const IdParams = Type.Object(
  { id: UuidSchema },
  { additionalProperties: false },
);
const Headers = Type.Object(
  { "idempotency-key": OperationIdSchema },
  { additionalProperties: true },
);
const Fingerprint = Type.String({ pattern: "^[a-f0-9]{64}$" });
const Empty = Type.Object({}, { additionalProperties: false });
function op(request: FastifyRequest): string {
  return String(request.headers["idempotency-key"]);
}
export async function registerRelayRoutes(
  app: FastifyInstance,
  repository: Repository,
  service: RelayService,
  config: AppConfig,
): Promise<void> {
  const metadata = async (id: string) => ({
    relay:
      repository.relays.get(id) ??
      (() => {
        throw notFound("Relay not found");
      })(),
    routes: repository.relays.routes(id),
    operations: repository.relays.operations(id),
  });
  app.get(
    "/api/v1/relays",
    {
      schema: {
        tags: ["relays"],
        response: {
          200: Type.Object({ items: Type.Array(RelayServerSchema) }),
        },
      },
    },
    async () => ({ items: repository.relays.list() }),
  );
  app.get(
    "/api/v1/relays/:id",
    {
      schema: {
        tags: ["relays"],
        params: IdParams,
        response: {
          200: Type.Object({
            relay: RelayServerSchema,
            routes: Type.Array(RelayRouteSchema),
            operations: Type.Array(RelayOperationSchema),
          }),
        },
      },
    },
    async (request) => metadata((request.params as { id: string }).id),
  );
  app.post(
    "/api/v1/relays",
    {
      schema: {
        tags: ["relays"],
        headers: Headers,
        body: RegisterRelaySchema,
        response: { 201: RelayServerSchema, 200: RelayServerSchema },
      },
    },
    async (request, reply) => {
      const body = request.body as RegisterRelay;
      if (!publicIpv4(body.host) || !publicIpv4(body.publicIpv4))
        throw new AppError(
          400,
          "VALIDATION_FAILED",
          "Relay requires public IPv4 addresses",
        );
      const operationId = op(request),
        scope = "relays.register";
      const start = repository.beginIdempotency(
        scope,
        operationId,
        requestFingerprint({
          ...body,
          transportPrivateKey: hashOpaque(body.transportPrivateKey),
        }),
      );
      if (start === "conflict")
        throw conflict(
          "IDEMPOTENCY_CONFLICT",
          "Operation ID was used with another request",
        );
      if (start === "repeat") {
        const result = repository.idempotencyResult(scope, operationId);
        if (result?.resultId) {
          const relay = repository.relays.get(result.resultId);
          if (relay) return relay;
          throw notFound("Relay was removed");
        }
        throw conflict("RELAY_BUSY", "Registration is in progress");
      }
      const id = uuidv7();
      const relay = repository.relays.create({
        id,
        name: body.name,
        host: body.host,
        publicIpv4: body.publicIpv4,
        port: body.port ?? 22,
        hostKeyFingerprint: body.hostKeyFingerprint,
        encryptedKey: encryptSecret(
          config.masterKey,
          `relay-transport-key:${id}`,
          body.transportPrivateKey,
        ),
      });
      repository.finishIdempotency(scope, operationId, "succeeded", id, null);
      repository.addAudit({
        adminId: request.admin!.id,
        action: "relay.register",
        targetType: "relay",
        targetId: id,
        operationId,
        result: "success",
        remoteAddress: request.ip,
      });
      return reply.code(201).send(relay);
    },
  );
  app.post(
    "/api/v1/relays/:id/check",
    {
      schema: {
        tags: ["relays"],
        params: IdParams,
        headers: Headers,
        body: Empty,
        response: { 200: RelayStatusSchema },
      },
    },
    async (request) => service.status((request.params as { id: string }).id),
  );
  for (const action of [
    "install",
    "update",
    "apply",
    "disable",
    "remove",
    "uninstall",
  ] as const) {
    const body =
      action === "apply"
        ? Type.Object(
            {
              expectedFingerprint: Fingerprint,
              instanceId: UuidSchema,
              listenPort: Type.Optional(RelayPortSchema),
            },
            { additionalProperties: false },
          )
        : action === "disable" || action === "remove"
          ? Type.Object(
              { expectedFingerprint: Fingerprint, routeId: UuidSchema },
              { additionalProperties: false },
            )
          : Type.Object(
              { expectedFingerprint: Fingerprint },
              { additionalProperties: false },
            );
    app.post(
      `/api/v1/relays/:id/${action}`,
      {
        schema: {
          tags: ["relays"],
          params: IdParams,
          headers: Headers,
          body,
          response: { 200: RelayOperationSchema },
        },
      },
      async (request) => {
        const id = (request.params as { id: string }).id,
          operationId = op(request);
        repository.addAudit({
          adminId: request.admin!.id,
          action: `relay.${action}.request`,
          targetType: "relay",
          targetId: id,
          operationId,
          result: "success",
          remoteAddress: request.ip,
        });
        return service.mutate(
          id,
          action,
          operationId,
          request.body as Record<string, unknown>,
        );
      },
    );
  }
  app.post(
    "/api/v1/relays/:id/operations/:operationId/reconcile",
    {
      schema: {
        tags: ["relays"],
        params: Type.Object(
          { id: UuidSchema, operationId: OperationIdSchema },
          { additionalProperties: false },
        ),
        headers: Headers,
        body: Empty,
        response: { 200: RelayOperationSchema },
      },
    },
    async (request) => {
      const p = request.params as { id: string; operationId: string };
      return service.reconcile(p.id, p.operationId);
    },
  );
  app.delete(
    "/api/v1/relays/:id",
    { schema: { tags: ["relays"], params: IdParams, headers: Headers } },
    async (request, reply) => {
      const id = (request.params as { id: string }).id,
        operationId = op(request),
        scope = `relays.delete:${id}`;
      const result = repository.idempotencyResult(scope, operationId);
      if (result?.status === "succeeded") return reply.code(204).send();
      const relay = repository.relays.get(id);
      if (!relay) throw notFound("Relay not found");
      if (repository.relays.pending(id))
        throw conflict(
          "RELAY_BUSY",
          "Reconcile pending operations before deletion",
        );
      const status = await service.status(id);
      if (status.installed || status.active || status.routes.length)
        throw conflict(
          "RELAY_NOT_UNINSTALLED",
          "Uninstall the relay service before deleting registration",
        );
      repository.beginIdempotency(
        scope,
        operationId,
        requestFingerprint({ id }),
      );
      repository.relays.delete(id);
      repository.finishIdempotency(scope, operationId, "succeeded", id, null);
      repository.addAudit({
        adminId: request.admin!.id,
        action: "relay.delete",
        targetType: "relay",
        targetId: id,
        operationId,
        result: "success",
        remoteAddress: request.ip,
      });
      return reply.code(204).send();
    },
  );
}
