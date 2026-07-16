import { useQuery } from "@tanstack/react-query";

import { api } from "../api";
import { AsyncPanel } from "../components/AsyncPanel";
import { formatBytes } from "../format";
import { useI18n } from "../i18n";

interface Dashboard {
  nodes?: Record<string, number>;
  users?: number;
  connections?: Record<string, number>;
  rxBytesTotal?: number;
  txBytesTotal?: number;
}

export default function DashboardPage() {
  const { t } = useI18n();
  const query = useQuery({ queryKey: ["dashboard"], queryFn: api.dashboard, refetchInterval: 60_000 });
  const data = (query.data ?? {}) as Dashboard;
  const connectionTotal = Object.values(data.connections ?? {}).reduce((sum, value) => sum + value, 0);
  const healthyNodes = data.nodes?.healthy ?? 0;
  const allNodes = Object.values(data.nodes ?? {}).reduce((sum, value) => sum + value, 0);
  return (
    <div className="page">
      <header className="page-header"><div><p className="eyebrow">AWG Control</p><h1>{t("dashboard")}</h1></div></header>
      <AsyncPanel pending={query.isPending} error={query.error}>
        <div className="metrics-grid">
          <article className="metric-card"><span>{t("nodes")}</span><strong>{healthyNodes}<small> / {allNodes}</small></strong><em>{t("healthy")}</em></article>
          <article className="metric-card"><span>{t("users")}</span><strong>{data.users ?? 0}</strong><em>{t("active")}</em></article>
          <article className="metric-card"><span>{t("connections")}</span><strong>{connectionTotal}</strong><em>{data.connections?.active ?? 0} {t("active").toLowerCase()}</em></article>
          <article className="metric-card traffic"><span>{t("totalTraffic")}</span><strong>{formatBytes((data.rxBytesTotal ?? 0) + (data.txBytesTotal ?? 0))}</strong><em>↓ {formatBytes(data.rxBytesTotal ?? 0)} · ↑ {formatBytes(data.txBytesTotal ?? 0)}</em></article>
        </div>
        <section className="panel overview-panel">
          <div><h2>{t("nodes")}</h2><p>{healthyNodes === allNodes ? t("healthy") : t("stale")}</p></div>
          <div className="health-orbit" aria-hidden="true"><span>{healthyNodes}</span></div>
        </section>
      </AsyncPanel>
    </div>
  );
}

