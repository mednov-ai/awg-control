import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { HelperClient } from "./helper/client.js";
import type { HelperRequest, HelperResponse } from "@awg-control/contracts";
import { openDatabase } from "./database.js";
import { Repository } from "./repository.js";
import { hashPassword } from "./security/crypto.js";
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
        secureCookies: false,
        publicOrigin: "http://panel.test",
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
    expect(openapi.json()).toMatchObject({ openapi: "3.1.0" });
    expect(openapi.json().paths).toHaveProperty("/nodes");

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
        secureCookies: false,
        publicOrigin: "https://panel.example",
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
});
