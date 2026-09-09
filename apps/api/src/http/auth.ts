import type { FastifyInstance, FastifyRequest } from "fastify";
import { Type } from "@sinclair/typebox";
import * as OTPAuth from "otpauth";

import {
  AdminSchema,
  ErrorCode,
  LoginRequestSchema,
  OperationIdSchema,
  SessionListResponseSchema,
  SessionRevocationResponseSchema,
  UuidSchema,
} from "@awg-control/contracts";
import type { Admin, LoginRequest } from "@awg-control/contracts";

import type { AppConfig } from "../config.js";
import type { Repository } from "../repository.js";
import {
  createRecoveryCodes,
  createSessionToken,
  decryptSecret,
  encryptSecret,
  hashOpaque,
  requestFingerprint,
  verifyPassword,
} from "../security/crypto.js";
import { AppError } from "./errors.js";

const SESSION_COOKIE = "awg_control_session";

declare module "fastify" {
  interface FastifyRequest {
    admin: Admin | null;
    sessionToken: string | null;
  }
}

function sessionOptions(config: AppConfig, expires: Date) {
  return {
    path: "/",
    httpOnly: true,
    secure: config.secureCookies,
    sameSite: "strict" as const,
    expires,
  };
}

function operationId(request: FastifyRequest): string {
  const value = request.headers["idempotency-key"];
  if (typeof value !== "string" || value.length < 1 || value.length > 128 || !/^[A-Za-z0-9._:-]+$/.test(value)) {
    throw new AppError(400, ErrorCode.ValidationFailed, "A valid Idempotency-Key header is required");
  }
  return value;
}

function totp(secret: string, username: string): OTPAuth.TOTP {
  return new OTPAuth.TOTP({
    issuer: "AWG Control",
    label: username,
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secret),
  });
}

function verifyTotp(secret: string, username: string, token: string): boolean {
  return totp(secret, username).validate({ token: token.replaceAll(" ", ""), window: 1 }) !== null;
}

export async function registerAuthentication(
  app: FastifyInstance,
  repository: Repository,
  config: AppConfig,
): Promise<void> {
  app.decorateRequest("admin", null);
  app.decorateRequest("sessionToken", null);

  app.addHook("onRequest", async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE];
    if (!token) return;
    const session = repository.getSession(token);
    if (!session) {
      reply.clearCookie(SESSION_COOKIE, { path: "/" });
      return;
    }
    request.admin = session.admin;
    request.sessionToken = token;
  });

  app.addHook("onResponse", async (request) => {
    if (!request.admin || !request.sessionToken) return;
    repository.touchSession(request.sessionToken, config.rememberedSessionIdleTtlSeconds, config.sessionActivityWriteIntervalSeconds);
  });

  app.get("/api/v1/auth/bootstrap", async () => ({ required: repository.countAdmins() === 0 }));

  app.post(
    "/api/v1/auth/login",
    {
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
      schema: {
        tags: ["auth"],
        body: LoginRequestSchema,
        response: { 200: Type.Object({ admin: AdminSchema }, { additionalProperties: false }) },
      },
    },
    async (request, reply) => {
      const body = request.body as LoginRequest;
      const record = repository.findAdminSecretByUsername(body.username);
      const passwordValid = record ? await verifyPassword(body.password, record.passwordHash) : false;
      if (!record || !passwordValid || record.status !== "active") {
        repository.addAudit({
          action: "auth.login",
          targetType: "admin",
          result: "rejected",
          errorCode: ErrorCode.InvalidCredentials,
          remoteAddress: request.ip,
        });
        throw new AppError(401, ErrorCode.InvalidCredentials, "Invalid username or password");
      }

      let totpVerified = false;
      if (record.totpEnabled) {
        if (!record.totpSecretEncrypted) {
          throw new AppError(500, ErrorCode.InternalError, "TOTP state is invalid");
        }
        const secret = decryptSecret(config.masterKey, `totp:${record.id}`, record.totpSecretEncrypted).toString("utf8");
        totpVerified = body.totp ? verifyTotp(secret, record.username, body.totp) : false;
        const recoveryValid = !totpVerified && body.recoveryCode
          ? repository.consumeRecoveryCode(record.id, body.recoveryCode)
          : false;
        if (!totpVerified && !recoveryValid) {
          repository.addAudit({
            adminId: record.id,
            action: "auth.login",
            targetType: "admin",
            targetId: record.id,
            result: "rejected",
            errorCode: ErrorCode.InvalidCredentials,
            remoteAddress: request.ip,
          });
          throw new AppError(401, ErrorCode.InvalidCredentials, "A valid one-time code is required");
        }
      }

      if (body.rememberDevice && (!record.totpEnabled || !totpVerified)) {
        repository.addAudit({
          adminId: record.id,
          action: "auth.login",
          targetType: "admin",
          targetId: record.id,
          result: "rejected",
          errorCode: ErrorCode.RememberedSessionRequiresTotp,
          remoteAddress: request.ip,
        });
        throw new AppError(403, ErrorCode.RememberedSessionRequiresTotp, "Remembered sessions require an enabled and verified TOTP code");
      }

      const token = createSessionToken();
      const remembered = body.rememberDevice === true;
      const expires = new Date(Date.now() + (remembered ? config.rememberedSessionTtlSeconds : config.sessionTtlSeconds) * 1000);
      const idleExpires = remembered
        ? new Date(Math.min(expires.getTime(), Date.now() + config.rememberedSessionIdleTtlSeconds * 1000))
        : null;
      repository.createSession({
        adminId: record.id,
        token,
        kind: remembered ? "remembered" : "short",
        expiresAt: expires.toISOString(),
        idleExpiresAt: idleExpires?.toISOString() ?? null,
        remoteAddress: request.ip,
        deviceLabel: body.deviceLabel ?? null,
      });
      repository.updateAdminLogin(record.id);
      repository.addAudit({
        adminId: record.id,
        action: "auth.login",
        targetType: "admin",
        targetId: record.id,
        result: "success",
        remoteAddress: request.ip,
      });
      reply.setCookie(SESSION_COOKIE, token, sessionOptions(config, expires));
      return { admin: repository.getAdmin(record.id)! };
    },
  );

  app.post("/api/v1/auth/logout", async (request, reply) => {
    if (request.sessionToken) repository.deleteSession(request.sessionToken);
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return reply.code(204).send();
  });

  app.get(
    "/api/v1/auth/me",
    { schema: { tags: ["auth"], response: { 200: Type.Object({ admin: AdminSchema }, { additionalProperties: false }) } } },
    async (request) => {
      requireAdmin(request);
      return { admin: request.admin };
    },
  );

  app.get(
    "/api/v1/auth/sessions",
    {
      preHandler: async (request) => requireAdmin(request),
      schema: { tags: ["auth"], response: { 200: SessionListResponseSchema } },
    },
    async (request) => ({ items: repository.listSessions(request.admin!.id, request.sessionToken!) }),
  );

  app.delete(
    "/api/v1/auth/sessions/:id",
    {
      preHandler: async (request) => requireAdmin(request),
      config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
      schema: {
        tags: ["auth"],
        params: Type.Object({ id: UuidSchema }, { additionalProperties: false }),
        headers: Type.Object({ "idempotency-key": OperationIdSchema }, { additionalProperties: true }),
        response: { 200: SessionRevocationResponseSchema },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const op = operationId(request);
      const scope = `auth.sessions.revoke:${request.admin!.id}`;
      const start = repository.beginIdempotency(scope, op, requestFingerprint({ id }));
      if (start === "conflict") throw new AppError(409, ErrorCode.IdempotencyConflict, "Idempotency key was already used");
      let revoked = 0;
      if (start === "repeat") revoked = Number(repository.idempotencyResult(scope, op)?.resultId ?? 0);
      else {
        revoked = repository.revokeSession(request.admin!.id, id);
        repository.finishIdempotency(scope, op, "succeeded", String(revoked), null);
        repository.addAudit({ adminId: request.admin!.id, action: "auth.session-revoked", targetType: "session", targetId: id,
          operationId: op, result: "success", remoteAddress: request.ip, details: { revoked } });
      }
      const current = repository.getSession(request.sessionToken!);
      if (!current) reply.clearCookie(SESSION_COOKIE, { path: "/" });
      return { revoked };
    },
  );

  app.post(
    "/api/v1/auth/sessions/revoke-others",
    {
      preHandler: async (request) => requireAdmin(request),
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
      schema: {
        tags: ["auth"],
        headers: Type.Object({ "idempotency-key": OperationIdSchema }, { additionalProperties: true }),
        body: Type.Object({}, { additionalProperties: false }),
        response: { 200: SessionRevocationResponseSchema },
      },
    },
    async (request) => {
      const op = operationId(request);
      const scope = `auth.sessions.revoke-others:${request.admin!.id}`;
      const start = repository.beginIdempotency(scope, op, requestFingerprint({ current: hashOpaque(request.sessionToken!) }));
      if (start === "conflict") throw new AppError(409, ErrorCode.IdempotencyConflict, "Idempotency key was already used");
      if (start === "repeat") return { revoked: Number(repository.idempotencyResult(scope, op)?.resultId ?? 0) };
      const revoked = repository.revokeOtherSessions(request.admin!.id, request.sessionToken!);
      repository.finishIdempotency(scope, op, "succeeded", String(revoked), null);
      repository.addAudit({ adminId: request.admin!.id, action: "auth.sessions-revoked-others", targetType: "session",
        operationId: op, result: "success", remoteAddress: request.ip, details: { revoked } });
      return { revoked };
    },
  );

  app.post(
    "/api/v1/auth/totp/enroll",
    { preHandler: async (request) => requireAdmin(request), schema: { tags: ["auth"] } },
    async (request, reply) => {
      const secret = new OTPAuth.Secret({ size: 20 }).base32;
      repository.setPendingTotp(
        request.sessionToken!,
        encryptSecret(config.masterKey, `pending-totp:${request.admin!.id}`, secret),
      );
      reply.header("Cache-Control", "no-store");
      return { secret, uri: totp(secret, request.admin!.username).toString() };
    },
  );

  app.post(
    "/api/v1/auth/totp/confirm",
    {
      preHandler: async (request) => requireAdmin(request),
      schema: {
        tags: ["auth"],
        body: Type.Object({ token: Type.String({ minLength: 6, maxLength: 16 }) }, { additionalProperties: false }),
      },
    },
    async (request, reply) => {
      const session = repository.getSession(request.sessionToken!);
      if (!session?.pendingTotpSecretEncrypted) {
        throw new AppError(409, ErrorCode.Conflict, "No pending TOTP enrollment");
      }
      const secret = decryptSecret(
        config.masterKey,
        `pending-totp:${request.admin!.id}`,
        session.pendingTotpSecretEncrypted,
      ).toString("utf8");
      const { token } = request.body as { token: string };
      if (!verifyTotp(secret, request.admin!.username, token)) {
        throw new AppError(400, ErrorCode.ValidationFailed, "Invalid one-time code");
      }
      const codes = createRecoveryCodes();
      repository.enableTotp(
        request.admin!.id,
        encryptSecret(config.masterKey, `totp:${request.admin!.id}`, secret),
        codes.map(hashOpaque),
      );
      repository.setPendingTotp(request.sessionToken!, null);
      repository.addAudit({
        adminId: request.admin!.id,
        action: "auth.totp-enabled",
        targetType: "admin",
        targetId: request.admin!.id,
        result: "success",
        remoteAddress: request.ip,
      });
      reply.header("Cache-Control", "no-store");
      return { recoveryCodes: codes };
    },
  );
}

export function requireAdmin(request: FastifyRequest): void {
  if (!request.admin || !request.sessionToken) {
    throw new AppError(401, ErrorCode.AuthenticationRequired, "Authentication required");
  }
}
