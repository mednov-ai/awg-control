import { describe, expect, it } from "vitest";
import { coarseDeviceLabel } from "./device";

describe("coarseDeviceLabel", () => {
  it("does not retain a detailed mobile user agent", () => {
    const source = "Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 Version/19.0 Mobile/15E148 Safari/604.1";
    expect(coarseDeviceLabel(source)).toBe("Safari / iOS");
    expect(coarseDeviceLabel(source)).not.toContain("19.0");
  });
});
