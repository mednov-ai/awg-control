import { ErrorCode, HELPER_PROTOCOL_VERSION, type HelperRequest } from "@awg-control/contracts";

import type { HelperClient } from "./helper/client.js";
import { uuidv7 } from "./lib/ids.js";
import type { Repository } from "./repository.js";

interface StatsResult {
  peers: Array<{
    publicKey: string;
    rxBytes: number;
    txBytes: number;
    lastHandshakeAt: string | null;
  }>;
}

interface HealthResult {
  helperVersion: string;
  protocolVersion: string;
}

interface PolicyResult {
  statuses: Array<{
    connectionId: string;
    status: "active" | "suspended" | "expired" | "quota-exceeded";
  }>;
}

function request(action: HelperRequest["action"], parameters: Record<string, unknown>): HelperRequest {
  const id = uuidv7();
  return { protocolVersion: HELPER_PROTOCOL_VERSION, requestId: id, operationId: id, action, parameters };
}

export class PollingWorker {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private lastRetentionDay = "";

  public constructor(
    private readonly repository: Repository,
    private readonly helper: HelperClient,
  ) {}

  public start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), 5_000);
    this.timer.unref();
    void this.tick();
  }

  public stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  public async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const nodes = this.repository.nodesDueForPoll(5);
      await Promise.all(nodes.map(async (node) => this.pollNode(node)));
      this.applyRetention();
      this.repository.pruneSessions();
    } finally {
      this.repository.markWorkerHeartbeat();
      this.running = false;
    }
  }

  private async pollNode(node: ReturnType<Repository["nodesDueForPoll"]>[number]): Promise<void> {
    try {
      const health = await this.helper.call<HealthResult>(node, request("health", {}));
      if (!health.ok) throw new Error(health.error.code);
      if (health.result.protocolVersion !== HELPER_PROTOCOL_VERSION) throw new Error(ErrorCode.HelperIncompatible);
      const instances = this.repository.listInstances(node.node.id);
      await Promise.all(
        instances.map(async (instance) => {
          const response = await this.helper.call<StatsResult>(
            node,
            request("stats", { instanceId: instance.id, expectedFingerprint: instance.sourceFingerprint }),
          );
          if (!response.ok) throw new Error(response.error.code);
          const byPublicKey = new Map(this.repository.listConnectionsForInstance(instance.id).map((item) => [item.publicKey, item]));
          for (const peer of response.result.peers) {
            const connection = byPublicKey.get(peer.publicKey);
            if (connection) {
              this.repository.updateTraffic({
                connectionId: connection.id,
                rx: peer.rxBytes,
                tx: peer.txBytes,
                lastHandshakeAt: peer.lastHandshakeAt,
              });
            }
          }
        }),
      );
      const policies = this.repository.policyProjectionForNode(node.node.id).map((policy) => ({
        ...policy,
        limitBytes: policy.limitBytes,
      }));
      const policyResponse = await this.helper.call<PolicyResult>(
        node,
        request("apply-policy", { policies }),
      );
      if (!policyResponse.ok) throw new Error(policyResponse.error.code);
      for (const policy of policyResponse.result.statuses) {
        if (policy.status !== "expired" && policy.status !== "quota-exceeded") continue;
        const connection = this.repository.getConnection(policy.connectionId);
        if (!connection || connection.status === policy.status) continue;
        this.repository.updateConnectionStatus(connection.id, policy.status);
        this.repository.addAudit({
          action: "policy.enforce",
          targetType: "connection",
          targetId: connection.id,
          nodeId: node.node.id,
          result: "success",
          details: { status: policy.status, source: "node-enforcement" },
        });
      }
      this.repository.updateNodeHealth(node.node.id, "healthy", health.result.helperVersion, null);
    } catch (error) {
      this.repository.updateNodeHealth(
        node.node.id,
        "offline",
        null,
        error instanceof Error && /^[A-Z0-9_]+$/.test(error.message) ? error.message : ErrorCode.HelperUnavailable,
      );
    }
  }

  private applyRetention(): void {
    const today = new Date().toISOString().slice(0, 10);
    if (today === this.lastRetentionDay) return;
    this.lastRetentionDay = today;
    const hourlyBefore = new Date(Date.now() - 90 * 86_400_000).toISOString();
    const dailyBefore = new Date(Date.now() - 730 * 86_400_000).toISOString();
    this.repository.pruneTraffic(hourlyBefore, dailyBefore);
  }
}
