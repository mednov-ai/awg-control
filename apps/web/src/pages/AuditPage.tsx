import { useQuery } from "@tanstack/react-query";

import { api } from "../api";
import { AsyncPanel } from "../components/AsyncPanel";
import { useI18n } from "../i18n";

export default function AuditPage() {
  const { t } = useI18n();
  const audit = useQuery({ queryKey: ["audit"], queryFn: api.audit, refetchInterval: 30_000 });
  return <div className="page">
    <header className="page-header"><div><p className="eyebrow">AWG Control</p><h1>{t("audit")}</h1></div></header>
    <AsyncPanel pending={audit.isPending} error={audit.error} empty={audit.data?.items.length === 0}>
      <div className="panel table-wrap audit-table"><table><thead><tr><th>{t("time")}</th><th>{t("action")}</th><th>{t("target")}</th><th>{t("result")}</th></tr></thead>
        <tbody>{audit.data?.items.map((event) => <tr key={String(event.id)}><td>{new Date(String(event.occurredAt)).toLocaleString()}</td><td className="mono">{String(event.action)}</td><td>{String(event.targetType)}{event.targetId ? <small className="mono"> {String(event.targetId).slice(0, 8)}</small> : null}</td><td><span className={`status ${event.result === "success" ? "status-active" : "status-error"}`}>{String(event.result)}</span></td></tr>)}</tbody>
      </table></div>
    </AsyncPanel>
  </div>;
}

