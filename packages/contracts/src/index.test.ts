import { describe, expect, it } from "vitest";

import { AllowedConnectionTransitions, canTransitionConnection } from "./index.js";

describe("connection state machine", () => {
  it("allows suspension and irrevocable revocation", () => {
    expect(canTransitionConnection("active", "suspended")).toBe(true);
    expect(canTransitionConnection("active", "revoked")).toBe(true);
    expect(AllowedConnectionTransitions.revoked).toEqual([]);
  });

  it("does not reactivate a revoked connection", () => {
    expect(canTransitionConnection("revoked", "active")).toBe(false);
  });
});

