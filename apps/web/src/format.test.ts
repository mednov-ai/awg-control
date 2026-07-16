import { describe, expect, it } from "vitest";

import { formatBytes, maskedKey } from "./format";

describe("safe UI formatting", () => {
  it("formats integer byte totals without changing source units", () => {
    expect(formatBytes(1024)).toContain("1");
    expect(formatBytes(1024)).toContain("KiB");
  });

  it("masks public keys in lists", () => {
    const key = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqr=";
    expect(maskedKey(key)).toBe("ABCDEF…mnopqr");
  });
});

