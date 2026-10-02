import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RelayServer } from "@awg-control/contracts";
import { api } from "../api";
import { LanguageProvider } from "../i18n";
import RelaysPage from "./RelaysPage";
const relay: RelayServer = {
  id: "019a0000-0000-7000-8000-000000000001",
  name: "Fixture relay",
  host: "203.0.113.20",
  publicIpv4: "203.0.113.20",
  port: 22,
  sshUsername: "awg-control-relay-agent",
  hostKeyFingerprint: "a".repeat(64),
  status: "ready",
  sourceFingerprint: "b".repeat(64),
  helperVersion: "fixture",
  lastCheckedAt: new Date().toISOString(),
  lastErrorCode: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};
function show() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <LanguageProvider>
        <RelaysPage />
      </LanguageProvider>
    </QueryClientProvider>,
  );
  return client;
}
describe("relay administration", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.setItem("awg-control:language:v1", "en");
    vi.spyOn(api, "relays").mockResolvedValue({ items: [relay] });
    vi.spyOn(api, "relay").mockResolvedValue({
      relay,
      routes: [],
      operations: [],
    });
    vi.spyOn(api, "nodes").mockResolvedValue({ items: [] });
    vi.spyOn(window, "confirm").mockReturnValue(true);
  });
  it("keeps service health distinct from VPN acceptance and uses fingerprint for updates", async () => {
    const change = vi
      .spyOn(api, "relayAction")
      .mockResolvedValue({
        id: relay.id,
        relayId: relay.id,
        operationId: "fixture",
        action: "update",
        status: "succeeded",
        errorCode: null,
        createdAt: relay.createdAt,
        updatedAt: relay.updatedAt,
      });
    show();
    expect(await screen.findByText("Service available")).toBeInTheDocument();
    expect(
      screen.getByText(/Service status does not prove a working VPN/),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Update service and configuration" }),
    );
    await waitFor(() =>
      expect(change).toHaveBeenCalledWith(
        relay.id,
        "update",
        { expectedFingerprint: relay.sourceFingerprint },
        expect.any(String),
      ),
    );
  });
  it("blocks new changes while an operation needs reconciliation", async () => {
    vi.mocked(api.relay).mockResolvedValue({
      relay,
      routes: [],
      operations: [
        {
          id: relay.id,
          relayId: relay.id,
          operationId: "lost-response",
          action: "apply",
          status: "uncertain",
          errorCode: "HELPER_UNAVAILABLE",
          createdAt: relay.createdAt,
          updatedAt: relay.updatedAt,
        },
      ],
    });
    const reconcile = vi
      .spyOn(api, "reconcileRelay")
      .mockResolvedValue({
        id: relay.id,
        relayId: relay.id,
        operationId: "lost-response",
        action: "apply",
        status: "succeeded",
        errorCode: null,
        createdAt: relay.createdAt,
        updatedAt: relay.updatedAt,
      });
    show();
    await screen.findByText(/An operation requires reconciliation/);
    expect(
      screen.getByRole("button", { name: "Update service and configuration" }),
    ).toBeDisabled();
    fireEvent.click(
      screen.getByRole("button", { name: "Reconcile operation result" }),
    );
    await waitFor(() =>
      expect(reconcile).toHaveBeenCalledWith(relay.id, "lost-response"),
    );
  });
});
