import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
const SCRYPT_N = 131_072;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 32;

function scryptAsync(password: string, salt: Buffer, length: number, options: { N: number; r: number; p: number; maxmem: number }): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, length, options, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey);
    });
  });
}

function b64url(value: Buffer): string {
  return value.toString("base64url");
}

export async function hashPassword(password: string): Promise<string> {
  if (password.length < 12 || password.length > 1024) {
    throw new Error("password must contain between 12 and 1024 characters");
  }
  const salt = randomBytes(16);
  const derived = await scryptAsync(password, salt, KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: 256 * 1024 * 1024,
  });
  return `scrypt$v1$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${b64url(salt)}$${b64url(derived)}`;
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const parts = encoded.split("$");
  if (parts.length !== 7 || parts[0] !== "scrypt" || parts[1] !== "v1") {
    return false;
  }
  const n = Number(parts[2]);
  const r = Number(parts[3]);
  const p = Number(parts[4]);
  const salt = Buffer.from(parts[5]!, "base64url");
  const expected = Buffer.from(parts[6]!, "base64url");
  if (!Number.isSafeInteger(n) || !Number.isSafeInteger(r) || !Number.isSafeInteger(p) || expected.length !== KEY_LENGTH) {
    return false;
  }
  try {
    const actual = await scryptAsync(password, salt, expected.length, {
      N: n,
      r,
      p,
      maxmem: 256 * 1024 * 1024,
    });
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

export function encryptSecret(masterKey: Buffer, purpose: string, plaintext: Buffer | string): string {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", masterKey, nonce);
  cipher.setAAD(Buffer.from(`awg-control:${purpose}:v1`, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", b64url(nonce), b64url(tag), b64url(ciphertext)].join(".");
}

export function decryptSecret(masterKey: Buffer, purpose: string, encoded: string): Buffer {
  const [version, nonceValue, tagValue, ciphertextValue, extra] = encoded.split(".");
  if (version !== "v1" || !nonceValue || !tagValue || !ciphertextValue || extra !== undefined) {
    throw new Error("invalid encrypted secret envelope");
  }
  const decipher = createDecipheriv("aes-256-gcm", masterKey, Buffer.from(nonceValue, "base64url"));
  decipher.setAAD(Buffer.from(`awg-control:${purpose}:v1`, "utf8"));
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertextValue, "base64url")), decipher.final()]);
}

export function hashOpaque(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("base64url");
}

export function requestFingerprint(value: unknown): string {
  return createHash("sha256").update(stableJson(value), "utf8").digest("hex");
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(object[key])}`)
    .join(",")}}`;
}

export function createSessionToken(): string {
  return b64url(randomBytes(32));
}

export function createRecoveryCodes(count = 10): string[] {
  return Array.from({ length: count }, () => randomBytes(8).toString("hex").toUpperCase());
}
