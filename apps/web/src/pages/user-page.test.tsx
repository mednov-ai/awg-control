import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Connection, InstanceRecord, VpnUser } from "@awg-control/contracts";

import { api } from "../api";
import { LanguageProvider } from "../i18n";
import UserPage from "./UserPage";

const nodeId = "018bcfe5-6800-7000-8000-000000000021";
const userId = "018bcfe5-6800-7000-8000-000000000022";
const instanceId = "018bcfe5-6800-7000-8000-000000000023";

const user: VpnUser = {
  id: userId, nodeId, displayName: "Fixture user", externalReference: null,
  status: "active", notes: null, createdAt: "2026-09-11T00:00:00.000Z", updatedAt: "2026-09-11T00:00:00.000Z",
};

const instance: InstanceRecord = {
  id: instanceId, nodeId, displayName: "AmneziaWG 3.1 / awg0", adapter: "awg3", protocolVersion: "3.1",
  containerRef: "fixture", interfaceName: "awg0", configRef: "fixture-config",
  capabilities: { stats: true, create: true, suspend: true, resume: true, revoke: true, metadataUpdate: false },
  sourceFingerprint: "fixture-source-fingerprint", mode: "managed", lastDiscoveredAt: "2026-09-11T00:00:00.000Z",
};

const connection: Connection = {
  id: "018bcfe5-6800-7000-8000-000000000024", vpnUserId: userId, instanceId, name: "Phone",
  publicKey: "fixture-public-key-material", addressCidr: "10.8.0.2/32", source: "created", managementMode: "managed",
  status: "active", expiresAt: null, quotaPolicyId: null, quotaOverrideAt: null, lastHandshakeAt: null,
  rxBytesTotal: 0, txBytesTotal: 0, createdAt: "2026-09-11T00:00:00.000Z", updatedAt: "2026-09-11T00:00:00.000Z", revokedAt: null,
};

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <LanguageProvider>
        <MemoryRouter initialEntries={[`/users/${userId}`]}>
          <Routes><Route path="/users/:id" element={<UserPage />} /></Routes>
        </MemoryRouter>
      </LanguageProvider>
    </QueryClientProvider>,
  );
}

describe("connection issuance", () => {
  beforeEach(() => {
    localStorage.setItem("awg-control:language:v1", "en");
    vi.restoreAllMocks();
    vi.spyOn(api, "user").mockResolvedValue({ user, connections: [] });
    vi.spyOn(api, "instances").mockResolvedValue({ items: [instance] });
    vi.spyOn(api, "quotas").mockResolvedValue({ items: [] });
    vi.spyOn(api, "issueConnection").mockResolvedValue({ connection, clientConfig: "fixture-one-time-config" });
  });

  it("does not ask for a CIDR and lets Helper allocate it", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "+ Create connection" }));
    expect(screen.queryByLabelText("VPN address CIDR")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Device name"), { target: { value: "Phone" } });
    fireEvent.click(screen.getByRole("button", { name: "Create and show once" }));

    await waitFor(() => expect(api.issueConnection).toHaveBeenCalledWith(userId, {
      instanceId,
      name: "Phone",
      expiresAt: null,
      quotaPolicyId: null,
    }));
  });
});
