import { existsSync } from "node:fs";

import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import swagger from "@fastify/swagger";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import Fastify, { type FastifyInstance } from "fastify";

import { ErrorCode, ProblemSchema } from "@awg-control/contracts";

import type { AppConfig } from "./config.js";
import type { HelperClient } from "./helper/client.js";
import { registerAuthentication } from "./http/auth.js";
import { AppError } from "./http/errors.js";
import { registerRoutes } from "./http/routes.js";
import type { Repository } from "./repository.js";

function requestOrigin(request: { protocol: string; hostname: string }): string {
  return `${request.protocol}://${request.hostname}`;
}

export async function buildServer(
  config: AppConfig,
  repository: Repository,
  helper: HelperClient,
): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: process.env.AWG_CONTROL_LOG_LEVEL ?? "info",
      redact: {
        paths: [
          "req.headers.authorization",
          "req.headers.cookie",
          "res.headers.set-cookie",
          "password",
          "transportPrivateKey",
          "clientConfig",
          "totp",
          "recoveryCode",
        ],
        censor: "[REDACTED]",
      },
    },
    bodyLimit: 256 * 1024,
    trustProxy: false,
    ajv: { customOptions: { removeAdditional: false } },
    genReqId: () => crypto.randomUUID(),
  }).withTypeProvider<TypeBoxTypeProvider>();

  await app.register(cookie);
  await app.register(rateLimit, { global: false });
  await app.register(swagger, {
    openapi: {
      info: { title: "AWG Control API", version: "1.0.0" },
      openapi: "3.1.0",
      servers: [{ url: "/api/v1" }],
    },
  });

  app.addSchema(ProblemSchema);
  app.addHook("onRequest", async (request) => {
    const unsafe = !["GET", "HEAD", "OPTIONS"].includes(request.method);
    if (!unsafe || !request.url.startsWith("/api/")) return;
    const origin = request.headers.origin;
    const expected = config.publicOrigin ?? requestOrigin(request);
    if (origin !== expected) {
      throw new AppError(403, ErrorCode.CsrfRejected, "Request origin is not allowed");
    }
  });

  app.addHook("onSend", async (request, reply, payload) => {
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("Referrer-Policy", "no-referrer");
    reply.header("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    reply.header(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    );
    if (request.url.startsWith("/api/") && !reply.hasHeader("Cache-Control")) reply.header("Cache-Control", "no-store");
    return payload;
  });

  app.setErrorHandler(async (error, request, reply) => {
    const appError = error instanceof AppError ? error : null;
    const validation = typeof error === "object" && error !== null && "validation" in error && Boolean((error as { validation?: unknown }).validation);
    const status = appError?.status ?? (validation ? 400 : 500);
    const code = appError?.code ?? (validation ? ErrorCode.ValidationFailed : ErrorCode.InternalError);
    const title = appError?.message ?? (validation ? "Request validation failed" : "Internal server error");
    if (status >= 500) request.log.error({ err: error, code }, "request failed");
    else request.log.info({ code, status }, "request rejected");
    return reply
      .code(status)
      .type("application/problem+json")
      .send({
        type: `https://awg-control.dev/problems/${String(code).toLowerCase().replaceAll("_", "-")}`,
        code,
        status,
        title,
        traceId: request.id,
        ...(appError?.details ? { details: appError.details } : {}),
      });
  });

  await registerAuthentication(app, repository, config);
  await registerRoutes(app, repository, helper, config);

  app.get("/api/v1/openapi.json", async () => app.swagger());

  if (config.webRoot && existsSync(config.webRoot)) {
    await app.register(fastifyStatic, { root: config.webRoot, wildcard: false });
    app.setNotFoundHandler(async (request, reply) => {
      if (request.method === "GET" && !request.url.startsWith("/api/")) return reply.sendFile("index.html");
      throw new AppError(404, ErrorCode.NotFound, "Resource not found");
    });
  }

  return app;
}
