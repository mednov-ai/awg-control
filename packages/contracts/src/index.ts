import { Type } from "@sinclair/typebox";
import type { Static } from "@sinclair/typebox";

export const API_VERSION = "v1" as const;
export const HELPER_PROTOCOL_VERSION = "1.0" as const;

export const UuidSchema = Type.String({ format: "uuid" });
export const TimestampSchema = Type.String({ format: "date-time" });
export const OperationIdSchema = Type.String({
  minLength: 1,
  maxLength: 128,
  pattern: "^[A-Za-z0-9._:-]+$",
});

export const NodeStatusSchema = Type.Union([
  Type.Literal("pending"),
  Type.Literal("discovered"),
  Type.Literal("healthy"),
  Type.Literal("degraded"),
  Type.Literal("offline"),
]);
export type NodeStatus = Static<typeof NodeStatusSchema>;

export const InstanceModeSchema = Type.Union([
  Type.Literal("observed"),
  Type.Literal("managed"),
  Type.Literal("read-only"),
]);
export type InstanceMode = Static<typeof InstanceModeSchema>;

export const AWGProtocolVersionSchema = Type.Union([
  Type.Literal("legacy"),
  Type.Literal("2"),
  Type.Literal("3.0"),
  Type.Literal("3.1"),
  Type.Literal("unknown"),
]);
export type AWGProtocolVersion = Static<typeof AWGProtocolVersionSchema>;

export const ManagementModeSchema = Type.Union([
  Type.Literal("observed"),
  Type.Literal("managed"),
]);
export type ManagementMode = Static<typeof ManagementModeSchema>;

export const ConnectionStatusSchema = Type.Union([
  Type.Literal("active"),
  Type.Literal("suspended"),
  Type.Literal("expired"),
  Type.Literal("quota-exceeded"),
  Type.Literal("revoked"),
  Type.Literal("error"),
]);
export type ConnectionStatus = Static<typeof ConnectionStatusSchema>;

export const NodeSchema = Type.Object(
  {
    id: UuidSchema,
    name: Type.String({ minLength: 1, maxLength: 120 }),
    description: Type.Union([Type.String({ maxLength: 1000 }), Type.Null()]),
    host: Type.String({ minLength: 1, maxLength: 253 }),
    port: Type.Integer({ minimum: 1, maximum: 65535 }),
    sshUsername: Type.String({ minLength: 1, maxLength: 64 }),
    hostKeyFingerprint: Type.String({ minLength: 16, maxLength: 256 }),
    status: NodeStatusSchema,
    helperVersion: Type.Union([Type.String(), Type.Null()]),
    lastSeenAt: Type.Union([TimestampSchema, Type.Null()]),
    lastErrorCode: Type.Union([Type.String(), Type.Null()]),
    pollIntervalSeconds: Type.Integer({ minimum: 15, maximum: 3600 }),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
  },
  { additionalProperties: false },
);
export type NodeRecord = Static<typeof NodeSchema>;

export const InstanceSchema = Type.Object(
  {
    id: UuidSchema,
    nodeId: UuidSchema,
    displayName: Type.String({ minLength: 1, maxLength: 120 }),
    adapter: Type.Union([Type.Literal("amneziawg-legacy"), Type.Literal("awg2"), Type.Literal("awg3")]),
    protocolVersion: AWGProtocolVersionSchema,
    containerRef: Type.String({ minLength: 1, maxLength: 128 }),
    interfaceName: Type.String({ minLength: 1, maxLength: 32 }),
    configRef: Type.String({ minLength: 1, maxLength: 128 }),
    capabilities: Type.Object(
      {
        stats: Type.Boolean(),
        create: Type.Boolean(),
        suspend: Type.Boolean(),
        resume: Type.Boolean(),
        revoke: Type.Boolean(),
        metadataUpdate: Type.Boolean(),
      },
      { additionalProperties: false },
    ),
    sourceFingerprint: Type.String({ minLength: 16, maxLength: 128 }),
    mode: InstanceModeSchema,
    lastDiscoveredAt: TimestampSchema,
  },
  { additionalProperties: false },
);
export type InstanceRecord = Static<typeof InstanceSchema>;

export const VpnUserSchema = Type.Object(
  {
    id: UuidSchema,
    nodeId: UuidSchema,
    displayName: Type.String({ minLength: 1, maxLength: 120 }),
    externalReference: Type.Union([Type.String({ maxLength: 255 }), Type.Null()]),
    status: Type.Union([
      Type.Literal("active"),
      Type.Literal("suspended"),
      Type.Literal("archived"),
    ]),
    notes: Type.Union([Type.String({ maxLength: 4000 }), Type.Null()]),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
  },
  { additionalProperties: false },
);
export type VpnUser = Static<typeof VpnUserSchema>;

export const ConnectionSchema = Type.Object(
  {
    id: UuidSchema,
    vpnUserId: UuidSchema,
    instanceId: UuidSchema,
    name: Type.String({ minLength: 1, maxLength: 120 }),
    publicKey: Type.String({ minLength: 20, maxLength: 128 }),
    addressCidr: Type.String({ minLength: 3, maxLength: 64 }),
    source: Type.Union([Type.Literal("created"), Type.Literal("imported")]),
    managementMode: ManagementModeSchema,
    status: ConnectionStatusSchema,
    expiresAt: Type.Union([TimestampSchema, Type.Null()]),
    quotaPolicyId: Type.Union([UuidSchema, Type.Null()]),
    quotaOverrideAt: Type.Union([TimestampSchema, Type.Null()]),
    lastHandshakeAt: Type.Union([TimestampSchema, Type.Null()]),
    rxBytesTotal: Type.Integer({ minimum: 0 }),
    txBytesTotal: Type.Integer({ minimum: 0 }),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
    revokedAt: Type.Union([TimestampSchema, Type.Null()]),
  },
  { additionalProperties: false },
);
export type Connection = Static<typeof ConnectionSchema>;

export const QuotaPolicySchema = Type.Object(
  {
    id: UuidSchema,
    nodeId: UuidSchema,
    name: Type.String({ minLength: 1, maxLength: 120 }),
    limitBytes: Type.Integer({ minimum: 1 }),
    period: Type.Union([
      Type.Literal("lifetime"),
      Type.Literal("month"),
      Type.Literal("calendar-month"),
    ]),
    resetTimezone: Type.String({ minLength: 1, maxLength: 64 }),
    action: Type.Literal("suspend"),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
  },
  { additionalProperties: false },
);
export type QuotaPolicy = Static<typeof QuotaPolicySchema>;

export const AdminSchema = Type.Object(
  {
    id: UuidSchema,
    username: Type.String({ minLength: 3, maxLength: 64 }),
    totpEnabled: Type.Boolean(),
    status: Type.Union([Type.Literal("active"), Type.Literal("disabled")]),
    lastLoginAt: Type.Union([TimestampSchema, Type.Null()]),
  },
  { additionalProperties: false },
);
export type Admin = Static<typeof AdminSchema>;

export const SessionKindSchema = Type.Union([Type.Literal("short"), Type.Literal("remembered")]);
export type SessionKind = Static<typeof SessionKindSchema>;

export const DeviceLabelSchema = Type.String({ minLength: 1, maxLength: 80, pattern: "^[^\\r\\n\\t]+$" });

export const LoginRequestSchema = Type.Object(
  {
    username: Type.String({ minLength: 3, maxLength: 64 }),
    password: Type.String({ minLength: 1, maxLength: 1024 }),
    totp: Type.Optional(Type.String({ minLength: 6, maxLength: 16 })),
    recoveryCode: Type.Optional(Type.String({ minLength: 8, maxLength: 32 })),
    rememberDevice: Type.Optional(Type.Boolean()),
    deviceLabel: Type.Optional(DeviceLabelSchema),
  },
  { additionalProperties: false },
);
export type LoginRequest = Static<typeof LoginRequestSchema>;

export const AdminSessionSchema = Type.Object(
  {
    id: UuidSchema,
    kind: SessionKindSchema,
    current: Type.Boolean(),
    deviceLabel: Type.Union([DeviceLabelSchema, Type.Null()]),
    createdAt: TimestampSchema,
    lastSeenAt: TimestampSchema,
    expiresAt: TimestampSchema,
    idleExpiresAt: Type.Union([TimestampSchema, Type.Null()]),
    remoteAddress: Type.Union([Type.String({ maxLength: 80 }), Type.Null()]),
  },
  { additionalProperties: false },
);
export type AdminSession = Static<typeof AdminSessionSchema>;

export const SessionListResponseSchema = Type.Object(
  { items: Type.Array(AdminSessionSchema) },
  { additionalProperties: false },
);
export type SessionListResponse = Static<typeof SessionListResponseSchema>;

export const SessionRevocationResponseSchema = Type.Object(
  { revoked: Type.Integer({ minimum: 0 }) },
  { additionalProperties: false },
);

export const ProblemSchema = Type.Object(
  {
    type: Type.String({ minLength: 1 }),
    code: Type.String({ minLength: 1, maxLength: 80 }),
    status: Type.Integer({ minimum: 400, maximum: 599 }),
    title: Type.String({ minLength: 1, maxLength: 200 }),
    traceId: Type.String({ minLength: 1, maxLength: 128 }),
    details: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  },
  { additionalProperties: false, $id: "Problem" },
);
export type Problem = Static<typeof ProblemSchema>;

export const ErrorCode = {
  AuthenticationRequired: "AUTHENTICATION_REQUIRED",
  InvalidCredentials: "INVALID_CREDENTIALS",
  RememberedSessionRequiresTotp: "REMEMBERED_SESSION_REQUIRES_TOTP",
  SessionNotFound: "SESSION_NOT_FOUND",
  CsrfRejected: "CSRF_REJECTED",
  RateLimited: "RATE_LIMITED",
  ValidationFailed: "VALIDATION_FAILED",
  NotFound: "NOT_FOUND",
  Conflict: "CONFLICT",
  IdempotencyConflict: "IDEMPOTENCY_CONFLICT",
  ConfigAlreadyIssued: "CONFIG_ALREADY_ISSUED",
  HostKeyMismatch: "HOST_KEY_MISMATCH",
  HelperIncompatible: "HELPER_INCOMPATIBLE",
  HelperUnavailable: "HELPER_UNAVAILABLE",
  FingerprintConflict: "FINGERPRINT_CONFLICT",
  AdapterReadOnly: "ADAPTER_READ_ONLY",
  MutationRolledBack: "MUTATION_ROLLED_BACK",
  InternalError: "INTERNAL_ERROR",
} as const;
export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode];

export const AllowedConnectionTransitions: Readonly<Record<ConnectionStatus, readonly ConnectionStatus[]>> = {
  active: ["suspended", "expired", "quota-exceeded", "revoked", "error"],
  suspended: ["active", "revoked", "error"],
  expired: ["active", "revoked"],
  "quota-exceeded": ["active", "revoked"],
  revoked: [],
  error: ["active", "suspended", "revoked"],
};

export function canTransitionConnection(from: ConnectionStatus, to: ConnectionStatus): boolean {
  return AllowedConnectionTransitions[from].includes(to);
}

export const HelperActionSchema = Type.Union([
  Type.Literal("discover"),
  Type.Literal("snapshot"),
  Type.Literal("list"),
  Type.Literal("stats"),
  Type.Literal("create"),
  Type.Literal("rename"),
  Type.Literal("enable"),
  Type.Literal("disable"),
  Type.Literal("revoke"),
  Type.Literal("apply-policy"),
  Type.Literal("health"),
]);
export type HelperAction = Static<typeof HelperActionSchema>;

export const HelperRequestSchema = Type.Object(
  {
    protocolVersion: Type.Literal(HELPER_PROTOCOL_VERSION),
    requestId: OperationIdSchema,
    operationId: OperationIdSchema,
    action: HelperActionSchema,
    parameters: Type.Record(Type.String(), Type.Unknown()),
  },
  { additionalProperties: false },
);
export type HelperRequest = Static<typeof HelperRequestSchema>;

export interface HelperError {
  code: string;
  message: string;
  retryable: boolean;
}

export type HelperResponse<T = unknown> =
  | { ok: true; requestId: string; result: T }
  | { ok: false; requestId: string; error: HelperError };

export interface DashboardSummary {
  nodes: Record<NodeStatus, number>;
  users: number;
  connections: Record<ConnectionStatus, number>;
  rxBytesTotal: number;
  txBytesTotal: number;
}
