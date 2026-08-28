import { describe, expect, it } from "vitest";

import { AllowedConnectionTransitions, InstanceSchema, canTransitionConnection } from "./index.js";

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

describe("instance contract", () => {
  it("accepts AWG 3.1 as a distinct adapter and protocol version", () => {
    const schema = JSON.stringify(InstanceSchema);
    expect(schema).toContain('"const":"awg3"');
    expect(schema).toContain('"const":"3.1"');
  });
});
