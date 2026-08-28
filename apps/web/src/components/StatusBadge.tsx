import type { ConnectionStatus, NodeStatus } from "@awg-control/contracts";

import { useI18n, type MessageKey } from "../i18n";

const labels: Record<ConnectionStatus | NodeStatus, MessageKey> = {
  active: "active",
  suspended: "suspended",
  expired: "expired",
  "quota-exceeded": "quotaExceeded",
  revoked: "revoked",
  error: "error",
  healthy: "healthy",
  degraded: "degraded",
  offline: "offline",
  pending: "pending",
  discovered: "discovered",
};

export function StatusBadge({ status }: { status: ConnectionStatus | NodeStatus }) {
  const { t } = useI18n();
  return <span className={`status status-${status}`}>{t(labels[status])}</span>;
}

