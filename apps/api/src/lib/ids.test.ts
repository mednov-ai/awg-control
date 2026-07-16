import { describe, expect, it } from "vitest";

import { uuidv7 } from "./ids.js";

describe("uuidv7", () => {
  it("encodes version and preserves chronological prefix", () => {
    const first = uuidv7(1_700_000_000_000);
    const second = uuidv7(1_700_000_000_001);
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(first.slice(0, 13) < second.slice(0, 13)).toBe(true);
  });
});

