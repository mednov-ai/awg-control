import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export interface AppConfig {
  host: string;
  port: number;
  databasePath: string;
  migrationsPath: string;
  webRoot: string | null;
  masterKey: Buffer;
  sessionTtlSeconds: number;
  rememberedSessionTtlSeconds: number;
  rememberedSessionIdleTtlSeconds: number;
  sessionActivityWriteIntervalSeconds: number;
  secureCookies: boolean;
  publicOrigin: string | null;
  trustedProxyHops: number;
  pollingEnabled: boolean;
}

function integer(value: string | undefined, fallback: number, name: string): number {
  const parsed = Number.parseInt(value ?? String(fallback), 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function boundedInteger(value: string | undefined, fallback: number, name: string, minimum: number, maximum: number): number {
  const parsed = integer(value, fallback, name);
  if (parsed < minimum || parsed > maximum) throw new Error(`${name} must be between ${minimum} and ${maximum}`);
  return parsed;
}

function nonNegativeInteger(value: string | undefined, fallback: number, name: string, maximum: number): number {
  const parsed = Number.parseInt(value ?? String(fallback), 10);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > maximum) {
    throw new Error(`${name} must be between 0 and ${maximum}`);
  }
  return parsed;
}

function readMasterKey(path: string | undefined): Buffer {
  if (!path) {
    throw new Error("AWG_CONTROL_MASTER_KEY_FILE is required");
  }
  const key = readFileSync(path);
  if (key.length !== 32) {
    throw new Error("AWG Control master key must contain exactly 32 bytes");
  }
  return key;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const port = integer(env.AWG_CONTROL_PORT, 8080, "AWG_CONTROL_PORT");
  if (port > 65535) {
    throw new Error("AWG_CONTROL_PORT must be at most 65535");
  }

  return {
    host: env.AWG_CONTROL_HOST ?? "127.0.0.1",
    port,
    databasePath: resolve(env.AWG_CONTROL_DATABASE ?? "/var/lib/awg-control/awg-control.db"),
    migrationsPath: resolve(env.AWG_CONTROL_MIGRATIONS ?? new URL("../migrations", import.meta.url).pathname),
    webRoot: env.AWG_CONTROL_WEB_ROOT ? resolve(env.AWG_CONTROL_WEB_ROOT) : null,
    masterKey: readMasterKey(env.AWG_CONTROL_MASTER_KEY_FILE),
    sessionTtlSeconds: boundedInteger(env.AWG_CONTROL_SESSION_TTL_SECONDS, 43_200, "AWG_CONTROL_SESSION_TTL_SECONDS", 300, 43_200),
    rememberedSessionTtlSeconds: boundedInteger(env.AWG_CONTROL_REMEMBERED_SESSION_TTL_SECONDS, 2_592_000, "AWG_CONTROL_REMEMBERED_SESSION_TTL_SECONDS", 3_600, 2_592_000),
    rememberedSessionIdleTtlSeconds: boundedInteger(env.AWG_CONTROL_REMEMBERED_SESSION_IDLE_TTL_SECONDS, 604_800, "AWG_CONTROL_REMEMBERED_SESSION_IDLE_TTL_SECONDS", 300, 604_800),
    sessionActivityWriteIntervalSeconds: boundedInteger(env.AWG_CONTROL_SESSION_ACTIVITY_WRITE_INTERVAL_SECONDS, 300, "AWG_CONTROL_SESSION_ACTIVITY_WRITE_INTERVAL_SECONDS", 30, 3_600),
    secureCookies: env.AWG_CONTROL_SECURE_COOKIES !== "false",
    publicOrigin: env.AWG_CONTROL_PUBLIC_ORIGIN ?? null,
    trustedProxyHops: nonNegativeInteger(env.AWG_CONTROL_TRUSTED_PROXY_HOPS, 0, "AWG_CONTROL_TRUSTED_PROXY_HOPS", 1),
    pollingEnabled: env.AWG_CONTROL_POLLING_ENABLED !== "false",
  };
}
