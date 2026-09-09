import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "../api";
import { LanguageProvider } from "../i18n";
import { LoginPage } from "./LoginPage";
import SettingsPage from "./SettingsPage";

function renderWithProviders(node: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><LanguageProvider>{node}</LanguageProvider></QueryClientProvider>);
}

describe("mobile administrator sessions", () => {
  beforeEach(() => {
    localStorage.setItem("awg-control:language:v1", "en");
    vi.restoreAllMocks();
  });

  it("submits remembered login with only a coarse device label at a narrow viewport", async () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 });
    vi.spyOn(api, "bootstrap").mockResolvedValue({ required: false });
    const login = vi.spyOn(api, "login").mockResolvedValue({ admin: {
      id: "018bcfe5-6800-7000-8000-000000000001", username: "operator", totpEnabled: true, status: "active", lastLoginAt: null,
    } });
    renderWithProviders(<LoginPage />);
    fireEvent.change(screen.getByLabelText("Administrator username"), { target: { value: "operator" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "password" } });
    fireEvent.change(screen.getByLabelText("One-time code"), { target: { value: "123456" } });
    fireEvent.click(screen.getByLabelText(/Remember this device/));
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(login).toHaveBeenCalledOnce());
    expect(login.mock.calls[0]?.[2]).toMatchObject({ totp: "123456", rememberDevice: true });
    expect(login.mock.calls[0]?.[2]?.deviceLabel).toMatch(/Browser|Chrome|Safari|Firefox|Edge/);
    expect(localStorage.getItem("awg_control_session")).toBeNull();
    expect(sessionStorage.length).toBe(0);
  });

  it("shows loading then safe current/other sessions and performs selective and all-other revocation", async () => {
    let resolveSessions!: (value: Awaited<ReturnType<typeof api.sessions>>) => void;
    vi.spyOn(api, "sessions").mockReturnValue(new Promise((resolve) => { resolveSessions = resolve; }));
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const revokeOne = vi.spyOn(api, "revokeSession").mockResolvedValue({ revoked: 1 });
    const revokeOthers = vi.spyOn(api, "revokeOtherSessions").mockResolvedValue({ revoked: 1 });
    renderWithProviders(<SettingsPage />);
    expect(screen.getByText("Loading…")).toBeInTheDocument();
    resolveSessions({ items: [
      { id: "018bcfe5-6800-7000-8000-000000000011", kind: "remembered", current: true, deviceLabel: "Safari / iOS", createdAt: "2026-09-01T00:00:00.000Z", lastSeenAt: "2026-09-09T00:00:00.000Z", expiresAt: "2026-10-01T00:00:00.000Z", idleExpiresAt: "2026-09-16T00:00:00.000Z", remoteAddress: "203.0.113.xxx" },
      { id: "018bcfe5-6800-7000-8000-000000000012", kind: "short", current: false, deviceLabel: "Chrome / Desktop", createdAt: "2026-09-09T00:00:00.000Z", lastSeenAt: "2026-09-09T00:00:00.000Z", expiresAt: "2026-09-09T12:00:00.000Z", idleExpiresAt: null, remoteAddress: null },
    ] });
    expect(await screen.findByText("Safari / iOS")).toBeInTheDocument();
    expect(screen.getByText("Current")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Revoke session: Chrome / Desktop" }));
    await waitFor(() => expect(revokeOne).toHaveBeenCalledWith("018bcfe5-6800-7000-8000-000000000012"));
    fireEvent.click(screen.getByRole("button", { name: "Revoke all others" }));
    await waitFor(() => expect(revokeOthers).toHaveBeenCalledOnce());
  });

  it("shows a localized session-loading failure", async () => {
    vi.spyOn(api, "sessions").mockRejectedValue(new Error("offline"));
    renderWithProviders(<SettingsPage />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load active sessions.");
  });
});
