import type { FastifyInstance, FastifyRequest } from "fastify";
import { Type } from "@sinclair/typebox";
import * as OTPAuth from "otpauth";

import { AdminSchema, ErrorCode } from "@awg-control/contracts";
import type { Admin } from "@awg-control/contracts";

import type { AppConfig } from "../config.js";
import type { Repository } from "../repository.js";
import {
  createRecoveryCodes,
  createSessionToken,
  decryptSecret,
  encryptSecret,
  hashOpaque,
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

  app.addHook("onRequest", async (request) => {
    const token = request.cookies[SESSION_COOKIE];
    if (!token) return;
    const session = repository.getSession(token);
    if (!session) return;
    request.admin = session.admin;
    request.sessionToken = token;
    repository.touchSession(token);
  });

  app.get("/api/v1/auth/bootstrap", async () => ({ required: repository.countAdmins() === 0 }));

  app.post(
    "/api/v1/auth/login",
    {
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
      schema: {
        tags: ["auth"],
        body: Type.Object(
          {
            username: Type.String({ minLength: 3, maxLength: 64 }),
            password: Type.String({ minLength: 1, maxLength: 1024 }),
            totp: Type.Optional(Type.String({ minLength: 6, maxLength: 16 })),
            recoveryCode: Type.Optional(Type.String({ minLength: 8, maxLength: 32 })),
          },
          { additionalProperties: false },
        ),
        response: { 200: Type.Object({ admin: AdminSchema }, { additionalProperties: false }) },
      },
    },
    async (request, reply) => {
      const body = request.body as { username: string; password: string; totp?: string; recoveryCode?: string };
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

      if (record.totpEnabled) {
        if (!record.totpSecretEncrypted) {
          throw new AppError(500, ErrorCode.InternalError, "TOTP state is invalid");
        }
        const secret = decryptSecret(config.masterKey, `totp:${record.id}`, record.totpSecretEncrypted).toString("utf8");
        const tokenValid = body.totp ? verifyTotp(secret, record.username, body.totp) : false;
        const recoveryValid = !tokenValid && body.recoveryCode
          ? repository.consumeRecoveryCode(record.id, body.recoveryCode)
          : false;
        if (!tokenValid && !recoveryValid) {
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

      const token = createSessionToken();
      const expires = new Date(Date.now() + config.sessionTtlSeconds * 1000);
      repository.createSession(record.id, token, expires.toISOString(), request.ip);
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

  app.post(
    "/api/v1/auth/totp/enroll",
    { preHandler: requireAdmin, schema: { tags: ["auth"] } },
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
      preHandler: requireAdmin,
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
