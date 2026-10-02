import { isIP } from "node:net";
import {
  RELAY_PROTOCOL_VERSION,
  type RelayAction,
  type RelayRoute,
  type RelayRequest,
  type RelayStatus,
} from "@awg-control/contracts";
import type { Repository } from "../repository.js";
import type { HelperClient } from "../helper/client.js";
import { HelperTransportError } from "../helper/client.js";
import { AppError, conflict, notFound } from "../http/errors.js";
import { utcNow, uuidv7 } from "../lib/ids.js";
import { requestFingerprint } from "../security/crypto.js";
import type { RelayClient } from "./client.js";
import type { StoredRelayOperation } from "./repository.js";

export function publicIpv4(value: string): boolean {
  if (isIP(value) !== 4) return false;
  const [a, b] = value.split(".").map(Number);
  return (
    a !== undefined &&
    b !== undefined &&
    a !== 0 &&
    a !== 10 &&
    a !== 127 &&
    a < 224 &&
    !(a === 169 && b === 254) &&
    !(a === 172 && b >= 16 && b <= 31) &&
    !(a === 192 && b === 168) &&
    !(a === 100 && b >= 64 && b <= 127)
  );
}
function validStatus(value: unknown): value is RelayStatus {
  if (!value || typeof value !== "object") return false;
  const s = value as RelayStatus;
  return (
    Object.keys(s).every((k) =>
      [
        "installed",
        "active",
        "sourceFingerprint",
        "helperVersion",
        "protocolVersion",
        "routes",
      ].includes(k),
    ) &&
    typeof s.installed === "boolean" &&
    typeof s.active === "boolean" &&
    /^[a-f0-9]{64}$/.test(s.sourceFingerprint) &&
    typeof s.helperVersion === "string" &&
    ["1.0", "1.1"].includes(s.protocolVersion) &&
    Array.isArray(s.routes) &&
    s.routes.length <= 100 &&
    s.routes.every(
      (r) =>
        r &&
        Object.keys(r).length === 5 &&
        /^[a-f0-9-]{36}$/.test(r.id) &&
        typeof r.upstreamIpv4 === "string" &&
        publicIpv4(r.upstreamIpv4) &&
        Number.isInteger(r.listenPort) &&
        r.listenPort >= 1024 &&
        r.listenPort <= 65535 &&
        Number.isInteger(r.upstreamPort) &&
        r.upstreamPort >= 1 &&
        r.upstreamPort <= 65535 &&
        typeof r.enabled === "boolean",
    )
  );
}
const wireRoute = (r: RelayRoute) => ({
  id: r.id,
  listenPort: r.listenPort,
  upstreamIpv4: r.upstreamIpv4,
  upstreamPort: r.upstreamPort,
  enabled: r.enabled,
});
export class RelayService {
  private readonly running = new Set<string>();
  constructor(
    private readonly repository: Repository,
    private readonly client: RelayClient,
    private readonly helper: HelperClient,
  ) {}
  private async call(
    id: string,
    action: RelayAction,
    operationId: string,
    parameters: Record<string, unknown>,
  ): Promise<RelayStatus> {
    const secret = this.repository.relays.secret(id);
    if (!secret) throw notFound("Relay not found");
    const request: RelayRequest = {
      protocolVersion: RELAY_PROTOCOL_VERSION,
      requestId: uuidv7(),
      operationId,
      action,
      parameters,
    };
    const response = await this.client.call<unknown>(secret, request);
    if (!response.ok)
      throw new AppError(
        409,
        response.error.code,
        "Relay operation was rejected",
      );
    if (!validStatus(response.result))
      throw new AppError(
        502,
        "INVALID_HELPER_RESPONSE",
        "Invalid relay status",
      );
    return response.result;
  }
  async status(id: string): Promise<RelayStatus> {
    try {
      const status = await this.call(id, "status", uuidv7(), {});
      const local = this.repository.relays
        .routes(id)
        .map(wireRoute)
        .sort((a, b) => a.id.localeCompare(b.id));
      const remote = [...status.routes].sort((a, b) =>
        a.id.localeCompare(b.id),
      );
      const known = this.repository.relays.get(id);
      const matches =
        requestFingerprint(local) === requestFingerprint(remote) &&
        (!known?.sourceFingerprint ||
          known.sourceFingerprint === status.sourceFingerprint);
      this.repository.relays.health(
        id,
        status.installed
          ? status.active && matches
            ? "ready"
            : "offline"
          : "uninstalled",
        matches ? status.sourceFingerprint : null,
        status.helperVersion,
        matches ? null : "RELAY_STATE_CONFLICT",
      );
      return status;
    } catch (error) {
      this.repository.relays.health(
        id,
        "offline",
        null,
        null,
        error instanceof AppError
          ? error.code
          : error instanceof HelperTransportError
            ? error.code
            : "HELPER_UNAVAILABLE",
      );
      throw error;
    }
  }
  async mutate(
    id: string,
    action: Exclude<RelayAction, "status">,
    op: string,
    body: Record<string, unknown>,
  ): Promise<StoredRelayOperation["record"]> {
    if (this.running.has(id))
      throw conflict("RELAY_BUSY", "Another relay operation is in progress");
    this.running.add(id);
    try {
      return await this.perform(id, action, op, body);
    } finally {
      this.running.delete(id);
    }
  }
  private async perform(
    id: string,
    action: Exclude<RelayAction, "status">,
    op: string,
    body: Record<string, unknown>,
  ): Promise<StoredRelayOperation["record"]> {
    const relay = this.repository.relays.get(id);
    if (!relay) throw notFound("Relay not found");
    const hash = requestFingerprint({ action, ...body });
    let stored = this.repository.relays.getOperation(id, op);
    if (stored) {
      if (stored.requestHash !== hash)
        throw conflict(
          "IDEMPOTENCY_CONFLICT",
          "Operation ID was used with another request",
        );
      if (stored.record.status === "succeeded") return stored.record;
      if (stored.record.status === "failed")
        throw conflict(
          stored.record.errorCode ?? "RELAY_APPLY_FAILED",
          "Previous relay operation failed",
        );
    } else {
      if (this.repository.relays.pending(id))
        throw conflict("RELAY_BUSY", "Reconcile the pending operation first");
      if (
        !relay.sourceFingerprint ||
        body.expectedFingerprint !== relay.sourceFingerprint
      )
        throw conflict(
          "SOURCE_FINGERPRINT_CONFLICT",
          "Check relay status before applying changes",
        );
      let routes = this.repository.relays.routes(id);
      const parameters: Record<string, unknown> = {
        expectedFingerprint: body.expectedFingerprint,
      };
      if (action === "apply") {
        const instanceId = String(body.instanceId);
        const instance = this.repository.getInstance(instanceId);
        if (
          !instance ||
          instance.protocolVersion !== "3.1" ||
          instance.mode !== "managed" ||
          !instance.capabilities.create
        )
          throw conflict(
            "ADAPTER_READ_ONLY",
            "A managed AWG 3.1 Instance is required",
          );
        const node = this.repository.getNodeSecret(instance.nodeId)!;
        if (!publicIpv4(node.node.host))
          throw new AppError(
            400,
            "VALIDATION_FAILED",
            "VPN Node must use a public IPv4 address for relay routing",
          );
        const discovery = await this.helper.call<{
          instances: Array<{
            id: string;
            protocolVersion?: string;
            udpPort?: number;
            readOnly?: boolean;
            sourceFingerprint: string;
          }>;
        }>(node, {
          protocolVersion: "1.0",
          requestId: uuidv7(),
          operationId: uuidv7(),
          action: "discover",
          parameters: {},
        });
        if (!discovery.ok)
          throw new AppError(502, discovery.error.code, "VPN discovery failed");
        const found = discovery.result.instances.find(
          (i) => i.id === instance.id,
        );
        if (
          !found ||
          found.protocolVersion !== "3.1" ||
          found.readOnly !== false ||
          !Number.isInteger(found.udpPort) ||
          found.udpPort! < 1 ||
          found.udpPort! > 65535 ||
          !/^[a-f0-9]{64}$/.test(found.sourceFingerprint)
        )
          throw conflict(
            "HELPER_INCOMPATIBLE",
            "Fresh AWG 3.1 UDP discovery is required",
          );
        if (found.sourceFingerprint !== instance.sourceFingerprint)
          throw conflict(
            "SOURCE_FINGERPRINT_CONFLICT",
            "Rediscover the VPN Instance before applying the relay route",
          );
        const previous = this.repository.relays.instanceRoute(instanceId);
        if (previous && previous.relayId !== id)
          throw conflict(
            "RELAY_ROUTE_CONFLICT",
            "Instance already has another relay route",
          );
        const listenPort = Number(body.listenPort ?? found.udpPort);
        if (
          !Number.isInteger(listenPort) ||
          listenPort < 1024 ||
          listenPort > 65535 ||
          routes.some(
            (r) => r.listenPort === listenPort && r.instanceId !== instanceId,
          )
        )
          throw conflict(
            "RELAY_ROUTE_CONFLICT",
            "Relay port is invalid or reserved",
          );
        const route: RelayRoute = {
          id: previous?.id ?? uuidv7(),
          relayId: id,
          instanceId,
          listenPort,
          upstreamIpv4: node.node.host,
          upstreamPort: found.udpPort!,
          enabled: true,
          createdAt: previous?.createdAt ?? utcNow(),
          updatedAt: utcNow(),
        };
        routes = [...routes.filter((r) => r.instanceId !== instanceId), route];
        parameters.route = wireRoute(route);
      } else if (action === "disable" || action === "remove") {
        const route = this.repository.relays.getRoute(String(body.routeId));
        if (!route || route.relayId !== id)
          throw notFound("Relay route not found");
        parameters.routeId = route.id;
        routes =
          action === "remove"
            ? routes.filter((r) => r.id !== route.id)
            : routes.map((r) =>
                r.id === route.id ? { ...r, enabled: false } : r,
              );
      } else if (action === "uninstall") routes = [];
      stored = this.repository.relays.begin(id, op, action, hash, {
        parameters,
        routes,
        body,
      });
    }
    try {
      const status = await this.call(
        id,
        action,
        op,
        stored.request.parameters as Record<string, unknown>,
      );
      const current = await this.call(id, "status", uuidv7(), {});
      if (current.sourceFingerprint !== status.sourceFingerprint)
        throw conflict(
          "RELAY_STATE_CONFLICT",
          "Remote state changed; operation reconciliation required",
        );
      const routes = stored.request.routes as RelayRoute[];
      const expected = routes
        .map(wireRoute)
        .sort((a, b) => a.id.localeCompare(b.id));
      if (
        requestFingerprint(expected) !==
        requestFingerprint(
          [...status.routes].sort((a, b) => a.id.localeCompare(b.id)),
        )
      )
        throw conflict(
          "RELAY_STATE_CONFLICT",
          "Remote route metadata does not match the operation",
        );
      this.repository.relays.commit(
        id,
        op,
        routes,
        status.sourceFingerprint,
        status.helperVersion,
        status.installed,
        status.active,
      );
      this.repository.addAudit({
        action: `relay.${action}`,
        targetType: "relay",
        targetId: id,
        operationId: op,
        result: "success",
      });
      return this.repository.relays.getOperation(id, op)!.record;
    } catch (error) {
      const code =
        error instanceof AppError
          ? error.code
          : error instanceof HelperTransportError
            ? error.code
            : "INTERNAL_ERROR";
      const definite =
        error instanceof AppError &&
        ![
          "RELAY_STATE_CONFLICT",
          "RELAY_ROLLBACK_FAILED",
          "RELAY_STATE_FAILED",
          "INVALID_HELPER_RESPONSE",
        ].includes(code);
      this.repository.relays.finish(
        id,
        op,
        definite ? "failed" : "uncertain",
        code,
      );
      this.repository.relays.health(id, "offline", null, null, code);
      this.repository.addAudit({
        action: `relay.${action}`,
        targetType: "relay",
        targetId: id,
        operationId: op,
        result: "failure",
        errorCode: code,
      });
      if (error instanceof HelperTransportError)
        throw new AppError(502, error.code, error.message);
      throw error;
    }
  }
  async reconcile(
    id: string,
    op: string,
  ): Promise<StoredRelayOperation["record"]> {
    const stored = this.repository.relays.getOperation(id, op);
    if (!stored) throw notFound("Relay operation not found");
    const action = stored.record.action as Exclude<RelayAction, "status">;
    if (this.running.has(id))
      throw conflict("RELAY_BUSY", "Relay operation is in progress");
    this.running.add(id);
    try {
      if (
        stored.record.status === "succeeded" ||
        stored.record.status === "failed"
      )
        return stored.record;
      return await this.replay(id, op, action, stored);
    } finally {
      this.running.delete(id);
    }
  }
  private async replay(
    id: string,
    op: string,
    action: Exclude<RelayAction, "status">,
    stored: StoredRelayOperation,
  ): Promise<StoredRelayOperation["record"]> {
    // perform's existing-operation branch validates the original HTTP fingerprint.
    const original = stored.request.body as Record<string, unknown> | undefined;
    if (original) return this.perform(id, action, op, original);
    throw conflict(
      "RELAY_STATE_CONFLICT",
      "Original operation body is unavailable",
    );
  }
}
