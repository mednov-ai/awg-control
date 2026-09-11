import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { HelperClient } from "./helper/client.js";
import type { HelperRequest, HelperResponse } from "@awg-control/contracts";
import { openDatabase } from "./database.js";
import { Repository } from "./repository.js";
import { hashPassword } from "./security/crypto.js";
import { encryptSecret } from "./security/crypto.js";
import * as OTPAuth from "otpauth";
import { buildServer } from "./server.js";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

const helper: HelperClient = {
  async call<T>(_node: never, request: HelperRequest): Promise<HelperResponse<T>> {
    return { ok: false, requestId: request.requestId, error: { code: "TEST_ONLY", message: "not connected", retryable: false } };
  },
};

describe("Panel HTTP boundary", () => {
  it("authenticates with a server-side session and rejects unknown privileged fields", async () => {
    const directory = mkdtempSync(join(tmpdir(), "awg-control-api-"));
    directories.push(directory);
    const db = openDatabase(join(directory, "test.db"), new URL("../migrations", import.meta.url).pathname);
    const repository = new Repository(db);
    repository.createAdmin("operator", await hashPassword("correct horse battery staple"));
    const app = await buildServer(
      {
        host: "127.0.0.1",
        port: 8080,
        databasePath: join(directory, "test.db"),
        migrationsPath: new URL("../migrations", import.meta.url).pathname,
        webRoot: null,
        masterKey: Buffer.alloc(32, 7),
        sessionTtlSeconds: 3600,
        rememberedSessionTtlSeconds: 2_592_000,
        rememberedSessionIdleTtlSeconds: 604_800,
        sessionActivityWriteIntervalSeconds: 300,
        secureCookies: false,
        publicOrigin: "http://panel.test",
        trustedProxyHops: 0,
        pollingEnabled: false,
      },
      repository,
      helper,
    );

    const login = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      headers: { origin: "http://panel.test" },
      payload: { username: "operator", password: "correct horse battery staple" },
    });
    expect(login.statusCode).toBe(200);
    const cookie = login.headers["set-cookie"];
    expect(cookie).toContain("HttpOnly");

    const readiness = await app.inject({ method: "GET", url: "/api/v1/health/ready" });
    expect(readiness.statusCode).toBe(200);

    const openapi = await app.inject({
      method: "GET",
      url: "/api/v1/openapi.json",
      headers: { cookie: String(cookie).split(";")[0]! },
    });
    expect(openapi.statusCode).toBe(200);
    const openapiDocument = openapi.json();
    expect(openapiDocument).toMatchObject({ openapi: "3.1.0" });
    expect(openapiDocument.paths).toHaveProperty("/nodes");
    expect(openapiDocument.paths).toHaveProperty("/auth/sessions");
    expect(openapiDocument.paths).toHaveProperty("/auth/sessions/{id}");
    expect(openapiDocument.paths).toHaveProperty("/auth/sessions/revoke-others");
    expect(JSON.stringify(openapiDocument.paths["/auth/login"])).toContain("rememberDevice");
    expect(JSON.stringify(openapiDocument.paths["/auth/login"])).toContain("deviceLabel");
    expect(JSON.stringify(openapiDocument.paths["/users/{id}/connections"])).not.toContain("addressCidr");

    const rejected = await app.inject({
      method: "POST",
      url: "/api/v1/users",
      headers: {
        origin: "http://panel.test",
        cookie: String(cookie).split(";")[0]!,
        "idempotency-key": "test-operation",
      },
      payload: {
        nodeId: "018bcfe5-6800-7000-8000-000000000000",
        displayName: "Fixture user",
        privateKey: "must-be-rejected",
      },
    });
    expect(rejected.statusCode).toBe(400);
    expect(rejected.json()).toMatchObject({ code: "VALIDATION_FAILED" });

    const rejectedAddressOverride = await app.inject({
      method: "POST",
      url: "/api/v1/users/018bcfe5-6800-7000-8000-000000000000/connections",
      headers: {
        origin: "http://panel.test",
        cookie: String(cookie).split(";")[0]!,
        "idempotency-key": "manual-address-override",
      },
      payload: {
        instanceId: "018bcfe5-6800-7000-8000-000000000001",
        name: "Phone",
        addressCidr: "10.8.0.2/32",
      },
    });
    expect(rejectedAddressOverride.statusCode).toBe(400);
    expect(rejectedAddressOverride.json()).toMatchObject({ code: "VALIDATION_FAILED" });
    await app.close();
    db.close();
  });

  it("rejects a cross-origin mutation", async () => {
    const directory = mkdtempSync(join(tmpdir(), "awg-control-origin-"));
    directories.push(directory);
    const db = openDatabase(join(directory, "test.db"), new URL("../migrations", import.meta.url).pathname);
    const app = await buildServer(
      {
        host: "127.0.0.1",
        port: 8080,
        databasePath: join(directory, "test.db"),
        migrationsPath: new URL("../migrations", import.meta.url).pathname,
        webRoot: null,
        masterKey: Buffer.alloc(32, 9),
        sessionTtlSeconds: 3600,
        rememberedSessionTtlSeconds: 2_592_000,
        rememberedSessionIdleTtlSeconds: 604_800,
        sessionActivityWriteIntervalSeconds: 300,
        secureCookies: false,
        publicOrigin: "https://panel.example",
        trustedProxyHops: 0,
        pollingEnabled: false,
      },
      new Repository(db),
      helper,
    );
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      headers: { origin: "https://attacker.example" },
      payload: { username: "operator", password: "irrelevant" },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ code: "CSRF_REJECTED" });
    await app.close();
    db.close();
  });

  it("requires verified TOTP for remembered login and exposes revocable safe session metadata", async () => {
    const directory = mkdtempSync(join(tmpdir(), "awg-control-remembered-"));
    directories.push(directory);
    const db = openDatabase(join(directory, "test.db"), new URL("../migrations", import.meta.url).pathname);
    const repository = new Repository(db);
    const masterKey = Buffer.alloc(32, 5);
    const admin = repository.createAdmin("operator", await hashPassword("correct horse battery staple"));
    const baseConfig = {
      host: "127.0.0.1", port: 8080, databasePath: join(directory, "test.db"),
      migrationsPath: new URL("../migrations", import.meta.url).pathname, webRoot: null, masterKey,
      sessionTtlSeconds: 3600, rememberedSessionTtlSeconds: 2_592_000,
      rememberedSessionIdleTtlSeconds: 604_800, sessionActivityWriteIntervalSeconds: 300,
      secureCookies: false, publicOrigin: "https://panel.example", trustedProxyHops: 0, pollingEnabled: false,
    };
    const app = await buildServer(baseConfig, repository, helper);
    const rejected = await app.inject({ method: "POST", url: "/api/v1/auth/login", headers: { origin: "https://panel.example" }, payload: {
      username: "operator", password: "correct horse battery staple", rememberDevice: true, deviceLabel: "Mobile Safari / iOS",
    } });
    expect(rejected.statusCode).toBe(403);
    expect(rejected.json()).toMatchObject({ code: "REMEMBERED_SESSION_REQUIRES_TOTP" });
    expect(db.prepare("SELECT COUNT(*) AS count FROM sessions").get()).toMatchObject({ count: 0 });

    const secret = new OTPAuth.Secret({ size: 20 }).base32;
    repository.enableTotp(admin.id, encryptSecret(masterKey, `totp:${admin.id}`, secret), []);
    const code = new OTPAuth.TOTP({ issuer: "AWG Control", label: "operator", algorithm: "SHA1", digits: 6, period: 30,
      secret: OTPAuth.Secret.fromBase32(secret) }).generate();
    const login = await app.inject({ method: "POST", url: "/api/v1/auth/login", headers: {
      origin: "https://panel.example", cookie: "awg_control_session=attacker-fixed",
    }, payload: { username: "operator", password: "correct horse battery staple", totp: code, rememberDevice: true, deviceLabel: "Mobile Safari / iOS" } });
    expect(login.statusCode).toBe(200);
    const setCookies = login.headers["set-cookie"];
    const cookie = String(Array.isArray(setCookies) ? setCookies.at(-1) : setCookies);
    expect(cookie).not.toContain("attacker-fixed");
    const issuedTokens = [...cookie.matchAll(/awg_control_session=([^;,\s]+)/g)];
    const credential = `awg_control_session=${issuedTokens.at(-1)?.[1] ?? ""}`;
    expect(issuedTokens.at(-1)?.[1]).toBeTruthy();
    const sessions = await app.inject({ method: "GET", url: "/api/v1/auth/sessions", headers: { cookie: credential } });
    expect(sessions.statusCode).toBe(200);
    expect(sessions.json().items[0]).toMatchObject({ kind: "remembered", current: true, deviceLabel: "Mobile Safari / iOS" });
    expect(JSON.stringify(sessions.json())).not.toContain(credential.split("=")[1]);

    const shortLogin = await app.inject({ method: "POST", url: "/api/v1/auth/login", headers: { origin: "https://panel.example" },
      payload: { username: "operator", password: "correct horse battery staple", totp: code } });
    expect(shortLogin.statusCode).toBe(200);
    const refreshedSessions = await app.inject({ method: "GET", url: "/api/v1/auth/sessions", headers: { cookie: credential } });
    const otherId = refreshedSessions.json().items.find((item: { current: boolean }) => !item.current)?.id as string;
    const revokeHeaders = { origin: "https://panel.example", cookie: credential, "idempotency-key": "revoke-one-1" };
    const revoked = await app.inject({ method: "DELETE", url: `/api/v1/auth/sessions/${otherId}`, headers: revokeHeaders });
    const repeated = await app.inject({ method: "DELETE", url: `/api/v1/auth/sessions/${otherId}`, headers: revokeHeaders });
    expect(revoked.json()).toEqual({ revoked: 1 });
    expect(repeated.json()).toEqual({ revoked: 1 });

    const revokeOthers = await app.inject({ method: "POST", url: "/api/v1/auth/sessions/revoke-others", headers: {
      origin: "https://panel.example", cookie: credential, "idempotency-key": "revoke-others-1",
    }, payload: {} });
    expect(revokeOthers.statusCode).toBe(200);
    expect(revokeOthers.json()).toEqual({ revoked: 0 });
    const logout = await app.inject({ method: "POST", url: "/api/v1/auth/logout", headers: { origin: "https://panel.example", cookie: credential } });
    expect(logout.statusCode).toBe(204);
    const afterLogout = await app.inject({ method: "GET", url: "/api/v1/auth/me", headers: { cookie: credential } });
    expect(afterLogout.statusCode).toBe(401);
    await app.close();
    db.close();
  });

  it("ignores bearer and forged forwarding fallback and clears an invalid cookie", async () => {
    const directory = mkdtempSync(join(tmpdir(), "awg-control-cookie-boundary-"));
    directories.push(directory);
    const databasePath = join(directory, "test.db");
    const db = openDatabase(databasePath, new URL("../migrations", import.meta.url).pathname);
    const app = await buildServer({
      host: "127.0.0.1", port: 8080, databasePath, migrationsPath: new URL("../migrations", import.meta.url).pathname,
      webRoot: null, masterKey: Buffer.alloc(32, 3), sessionTtlSeconds: 3600,
      rememberedSessionTtlSeconds: 2_592_000, rememberedSessionIdleTtlSeconds: 604_800,
      sessionActivityWriteIntervalSeconds: 300, secureCookies: false, publicOrigin: "https://panel.example",
      trustedProxyHops: 0, pollingEnabled: false,
    }, new Repository(db), helper);
    const response = await app.inject({ method: "GET", url: "/api/v1/auth/me?token=ignored", headers: {
      authorization: "Bearer ignored", cookie: "awg_control_session=invalid", "x-forwarded-for": "198.51.100.8",
    } });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ code: "AUTHENTICATION_REQUIRED" });
    expect(String(response.headers["set-cookie"])).toContain("awg_control_session=;");
    await app.close();
    db.close();
  });

  it("rate limits repeated invalid logins", async () => {
    const directory = mkdtempSync(join(tmpdir(), "awg-control-rate-limit-"));
    directories.push(directory);
    const databasePath = join(directory, "test.db");
    const db = openDatabase(databasePath, new URL("../migrations", import.meta.url).pathname);
    const app = await buildServer({
      host: "127.0.0.1", port: 8080, databasePath, migrationsPath: new URL("../migrations", import.meta.url).pathname,
      webRoot: null, masterKey: Buffer.alloc(32, 4), sessionTtlSeconds: 3600,
      rememberedSessionTtlSeconds: 2_592_000, rememberedSessionIdleTtlSeconds: 604_800,
      sessionActivityWriteIntervalSeconds: 300, secureCookies: false, publicOrigin: "https://panel.example",
      trustedProxyHops: 0, pollingEnabled: false,
    }, new Repository(db), helper);
    let status = 0;
    for (let attempt = 0; attempt < 11; attempt += 1) {
      status = (await app.inject({ method: "POST", url: "/api/v1/auth/login", headers: { origin: "https://panel.example" },
        payload: { username: "missing", password: "wrong" } })).statusCode;
    }
    expect(status).toBe(429);
    await app.close();
    db.close();
  });
});
