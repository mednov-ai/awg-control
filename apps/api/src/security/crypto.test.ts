import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";

import { decryptSecret, encryptSecret, hashPassword, verifyPassword } from "./crypto.js";

describe("secret protection", () => {
  it("round-trips an AES-GCM secret with purpose-bound AAD", () => {
    const key = randomBytes(32);
    const encrypted = encryptSecret(key, "transport-key:node", "fixture-secret");
    expect(encrypted).not.toContain("fixture-secret");
    expect(decryptSecret(key, "transport-key:node", encrypted).toString()).toBe("fixture-secret");
    expect(() => decryptSecret(key, "totp:admin", encrypted)).toThrow();
  });

  it("hashes passwords with scrypt", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(hash).not.toContain("correct horse");
    await expect(verifyPassword("correct horse battery staple", hash)).resolves.toBe(true);
    await expect(verifyPassword("wrong password", hash)).resolves.toBe(false);
  });
});

