import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "../api";
import { AsyncPanel } from "../components/AsyncPanel";
import { Modal } from "../components/Modal";
import { formatBytes } from "../format";
import { useI18n } from "../i18n";

export default function QuotasPage() {
  const { t } = useI18n();
  const client = useQueryClient();
  const quotas = useQuery({ queryKey: ["quotas"], queryFn: api.quotas });
  const nodes = useQuery({ queryKey: ["nodes"], queryFn: api.nodes });
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState("");

  const create = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    try {
      await api.createQuota({
        nodeId: String(data.get("nodeId")), name: String(data.get("name")),
        limitBytes: Math.round(Number(data.get("limitGiB")) * 1024 ** 3),
        period: String(data.get("period")), resetTimezone: String(data.get("resetTimezone")),
      });
      setShowForm(false);
      await client.invalidateQueries({ queryKey: ["quotas"] });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("error"));
    }
  };

  const periodLabel = (period: string) => period === "lifetime" ? t("lifetime") : period === "month" ? t("month") : t("calendarMonth");
  return <div className="page">
    <header className="page-header"><div><p className="eyebrow">AWG Control</p><h1>{t("quotas")}</h1></div><button className="button primary" onClick={() => setShowForm(true)}>+ {t("addQuota")}</button></header>
    <AsyncPanel pending={quotas.isPending} error={quotas.error} empty={quotas.data?.items.length === 0}>
      <div className="card-list">{quotas.data?.items.map((quota) => <article className="panel quota-card" key={quota.id}><div><h3>{quota.name}</h3><p>{periodLabel(quota.period)} · {quota.resetTimezone}</p></div><strong>{formatBytes(quota.limitBytes)}</strong></article>)}</div>
    </AsyncPanel>
    {showForm ? <Modal title={t("addQuota")} onClose={() => setShowForm(false)}><form onSubmit={(event) => void create(event)}>
      <label>{t("quotaName")}<input name="name" required maxLength={120} /></label>
      <label>{t("node")}<select name="nodeId" required>{nodes.data?.items.map((node) => <option key={node.id} value={node.id}>{node.name}</option>)}</select></label>
      <label>{t("limitGiB")}<input name="limitGiB" type="number" min="0.001" step="0.001" required /></label>
      <label>{t("period")}<select name="period"><option value="lifetime">{t("lifetime")}</option><option value="month">{t("month")}</option><option value="calendar-month">{t("calendarMonth")}</option></select></label>
      <label>{t("timezone")}<input name="resetTimezone" required defaultValue={Intl.DateTimeFormat().resolvedOptions().timeZone} /></label>
      {error ? <p className="form-error">{error}</p> : null}
      <div className="form-actions"><button type="button" className="button ghost" onClick={() => setShowForm(false)}>{t("cancel")}</button><button className="button primary">{t("save")}</button></div>
    </form></Modal> : null}
  </div>;
}

