import { describe, expect, it } from "vitest";

import { AllowedConnectionTransitions, AdminSessionSchema, LoginRequestSchema, InstanceSchema, canTransitionConnection } from "./index.js";

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

describe("administrator session contracts", () => {
  it("describe remembered login without accepting arbitrary fields", () => {
    expect(LoginRequestSchema.additionalProperties).toBe(false);
    expect(JSON.stringify(LoginRequestSchema)).toContain("rememberDevice");
    expect(JSON.stringify(LoginRequestSchema)).toContain("deviceLabel");
  });

  it("exposes safe metadata but no cookie credential", () => {
    const schema = JSON.stringify(AdminSessionSchema);
    expect(schema).toContain("idleExpiresAt");
    expect(schema).not.toContain("token");
    expect(schema).not.toContain("id_hash");
  });
});

describe("instance contract", () => {
  it("accepts AWG 3.1 as a distinct adapter and protocol version", () => {
    const schema = JSON.stringify(InstanceSchema);
    expect(schema).toContain('"const":"awg3"');
    expect(schema).toContain('"const":"3.1"');
  });
});
