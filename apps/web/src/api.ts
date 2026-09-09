import type {
  Admin,
  AdminSession,
  Connection,
  InstanceRecord,
  NodeRecord,
  Problem,
  QuotaPolicy,
  VpnUser,
} from "@awg-control/contracts";

export class ApiProblem extends Error {
  public constructor(public readonly problem: Problem) {
    super(problem.title);
    this.name = "ApiProblem";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/v1${path}`, {
    credentials: "same-origin",
    ...init,
    headers: {
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  if (response.status === 204) return undefined as T;
  const data = (await response.json()) as T | Problem;
  if (!response.ok) throw new ApiProblem(data as Problem);
  return data as T;
}

function idempotency(): string {
  return crypto.randomUUID();
}

export const api = {
  bootstrap: () => request<{ required: boolean }>("/auth/bootstrap"),
  me: () => request<{ admin: Admin }>("/auth/me"),
  login: (username: string, password: string, options?: { totp?: string; rememberDevice?: boolean; deviceLabel?: string }) =>
    request<{ admin: Admin }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password, ...(options?.totp ? { totp: options.totp } : {}),
        ...(options?.rememberDevice ? { rememberDevice: true, deviceLabel: options.deviceLabel } : {}) }),
    }),
  logout: () => request<void>("/auth/logout", { method: "POST" }),
  dashboard: () => request<Record<string, unknown>>("/dashboard"),
  nodes: () => request<{ items: NodeRecord[] }>("/nodes"),
  createNode: (body: Record<string, unknown>) =>
    request<NodeRecord>("/nodes", {
      method: "POST",
      headers: { "Idempotency-Key": idempotency() },
      body: JSON.stringify(body),
    }),
  discoverNode: (id: string) =>
    request<{ items: InstanceRecord[] }>(`/nodes/${encodeURIComponent(id)}/discover`, {
      method: "POST",
      headers: { "Idempotency-Key": idempotency() },
    }),
  instances: (nodeId: string) => request<{ items: InstanceRecord[] }>(`/nodes/${encodeURIComponent(nodeId)}/instances`),
  manageInstance: (id: string) =>
    request<InstanceRecord>(`/instances/${encodeURIComponent(id)}/manage`, {
      method: "POST",
      headers: { "Idempotency-Key": idempotency() },
    }),
  instancePeers: (id: string) =>
    request<{ peers: Array<{ publicKey: string; publicKeyFingerprint: string; addressCidr: string; name: string }> }>(
      `/instances/${encodeURIComponent(id)}/peers`,
    ),
  importPeers: (
    id: string,
    peers: Array<{ vpnUserId: string; name: string; publicKey: string; addressCidr: string }>,
  ) =>
    request<{ items: Connection[] }>(`/instances/${encodeURIComponent(id)}/import`, {
      method: "POST",
      headers: { "Idempotency-Key": idempotency() },
      body: JSON.stringify({ peers }),
    }),
  users: (search = "") => request<{ items: VpnUser[] }>(`/users${search ? `?search=${encodeURIComponent(search)}` : ""}`),
  user: (id: string) => request<{ user: VpnUser; connections: Connection[] }>(`/users/${encodeURIComponent(id)}`),
  createUser: (body: { nodeId: string; displayName: string; notes?: string }) =>
    request<VpnUser>("/users", {
      method: "POST",
      headers: { "Idempotency-Key": idempotency() },
      body: JSON.stringify(body),
    }),
  issueConnection: (
    userId: string,
    body: { instanceId: string; name: string; addressCidr: string; expiresAt?: string | null; quotaPolicyId?: string | null },
  ) =>
    request<{ connection: Connection; clientConfig: string }>(`/users/${encodeURIComponent(userId)}/connections`, {
      method: "POST",
      headers: { "Idempotency-Key": idempotency() },
      body: JSON.stringify(body),
    }),
  connectionAction: (id: string, action: "adopt" | "suspend" | "resume" | "revoke", override = false) =>
    request<Connection>(`/connections/${encodeURIComponent(id)}/${action}`, {
      method: "POST",
      headers: { "Idempotency-Key": idempotency() },
      body: JSON.stringify(action === "resume" ? { override } : {}),
    }),
  traffic: (id: string) =>
    request<{
      totals: { rxBytes: number; txBytes: number };
      hourly: Array<{ bucketStart: string; rxBytes: number; txBytes: number }>;
      daily: Array<{ bucketStart: string; rxBytes: number; txBytes: number }>;
    }>(`/connections/${encodeURIComponent(id)}/traffic`),
  quotas: () => request<{ items: QuotaPolicy[] }>("/quota-policies"),
  createQuota: (body: { nodeId: string; name: string; limitBytes: number; period: string; resetTimezone: string }) =>
    request<QuotaPolicy>("/quota-policies", {
      method: "POST",
      headers: { "Idempotency-Key": idempotency() },
      body: JSON.stringify(body),
    }),
  audit: () => request<{ items: Array<Record<string, unknown>> }>("/audit-events"),
  enrollTotp: () => request<{ secret: string; uri: string }>("/auth/totp/enroll", { method: "POST" }),
  confirmTotp: (token: string) =>
    request<{ recoveryCodes: string[] }>("/auth/totp/confirm", {
      method: "POST",
      body: JSON.stringify({ token }),
    }),
  sessions: () => request<{ items: AdminSession[] }>("/auth/sessions"),
  revokeSession: (id: string) => request<{ revoked: number }>(`/auth/sessions/${encodeURIComponent(id)}`, {
    method: "DELETE", headers: { "Idempotency-Key": idempotency() },
  }),
  revokeOtherSessions: () => request<{ revoked: number }>("/auth/sessions/revoke-others", {
    method: "POST", headers: { "Idempotency-Key": idempotency() }, body: JSON.stringify({}),
  }),
};
