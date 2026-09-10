import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { NodeRecord } from "@awg-control/contracts";

import { api } from "../api";
import { LanguageProvider } from "../i18n";
import NodesPage from "./NodesPage";

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <LanguageProvider><NodesPage /></LanguageProvider>
    </QueryClientProvider>,
  );
}

const node: NodeRecord = {
  id: "018bcfe5-6800-7000-8000-000000000021",
  name: "Test node",
  description: null,
  host: "192.0.2.10",
  port: 22,
  sshUsername: "awg-control-agent",
  hostKeyFingerprint: "SHA256:fixture-host-fingerprint",
  status: "pending",
  helperVersion: null,
  lastSeenAt: null,
  lastErrorCode: null,
  pollIntervalSeconds: 60,
  createdAt: "2026-09-10T00:00:00.000Z",
  updatedAt: "2026-09-10T00:00:00.000Z",
};

describe("node registration", () => {
  beforeEach(() => {
    localStorage.setItem("awg-control:language:v1", "en");
    vi.restoreAllMocks();
  });

  it("closes the form after an asynchronous successful registration", async () => {
    vi.spyOn(api, "nodes").mockResolvedValueOnce({ items: [] }).mockResolvedValue({ items: [node] });
    vi.spyOn(api, "createNode").mockResolvedValue(node);
    renderPage();

    expect(await screen.findByText("Nothing here yet")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "+ Add node" }));
    fireEvent.change(screen.getByLabelText("Node name"), { target: { value: node.name } });
    fireEvent.change(screen.getByLabelText("SSH host"), { target: { value: node.host } });
    fireEvent.change(screen.getByLabelText("SHA-256 host key fingerprint"), { target: { value: node.hostKeyFingerprint } });
    fireEvent.change(screen.getByLabelText("Private transport key"), { target: { value: "nonsecret-fixture-material-".repeat(4) } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(api.createNode).toHaveBeenCalledOnce());
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Add node" })).not.toBeInTheDocument());
    expect(await screen.findByText(node.name)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
