import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";

import type { Connection } from "@awg-control/contracts";

import { api, ApiProblem } from "../api";
import { AsyncPanel } from "../components/AsyncPanel";
import { Modal } from "../components/Modal";
import { OneTimeConfig } from "../components/OneTimeConfig";
import { StatusBadge } from "../components/StatusBadge";
import { formatBytes, maskedKey } from "../format";
import { useI18n } from "../i18n";

function ConnectionCard({ connection, onChanged }: { connection: Connection; onChanged: () => void }) {
  const { t } = useI18n();
  const traffic = useQuery({ queryKey: ["traffic", connection.id], queryFn: () => api.traffic(connection.id), refetchInterval: 60_000 });
  const action = async (value: "adopt" | "suspend" | "resume" | "revoke") => {
    if (value === "revoke" && !window.confirm(t("revokeConfirm"))) return;
    const override = value === "resume" && (connection.status === "expired" || connection.status === "quota-exceeded");
    if (override && !window.confirm(t("quotaOverrideConfirm"))) return;
    await api.connectionAction(connection.id, value, override);
    onChanged();
  };
  return (
    <article className="panel connection-card">
      <div className="connection-heading"><div><h3>{connection.name}</h3><span className="mono subtle" title={connection.publicKey}>{maskedKey(connection.publicKey)}</span></div><StatusBadge status={connection.status} /></div>
      <div className="connection-stats">
        <div><span>{t("addressCidr")}</span><strong className="mono">{connection.addressCidr}</strong></div>
        <div><span>{t("totalTraffic")}</span><strong>{formatBytes((traffic.data?.totals.rxBytes ?? connection.rxBytesTotal) + (traffic.data?.totals.txBytes ?? connection.txBytesTotal))}</strong></div>
        <div><span>{t("lastHandshake")}</span><strong>{connection.lastHandshakeAt ? new Date(connection.lastHandshakeAt).toLocaleString() : t("never")}</strong></div>
      </div>
      <div className="button-row">
        {connection.managementMode === "observed" ? <button className="button secondary" onClick={() => void action("adopt")}>{t("adopt")}</button> : null}
        {connection.managementMode === "managed" && connection.status === "active" ? <button className="button secondary" onClick={() => void action("suspend")}>{t("suspend")}</button> : null}
        {connection.managementMode === "managed" && ["suspended", "expired", "quota-exceeded"].includes(connection.status) ? <button className="button secondary" onClick={() => void action("resume")}>{t("resume")}</button> : null}
        {connection.status !== "revoked" ? <button className="button danger ghost" onClick={() => void action("revoke")}>{t("revoke")}</button> : null}
      </div>
    </article>
  );
}

export default function UserPage() {
  const { id = "" } = useParams();
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const user = useQuery({ queryKey: ["user", id], queryFn: () => api.user(id), enabled: Boolean(id) });
  const instances = useQuery({ queryKey: ["instances", user.data?.user.nodeId], queryFn: () => api.instances(user.data!.user.nodeId), enabled: Boolean(user.data?.user.nodeId) });
  const quotas = useQuery({ queryKey: ["quotas"], queryFn: api.quotas });
  const [showIssue, setShowIssue] = useState(false);
  const [issued, setIssued] = useState<{ connection: Connection; clientConfig: string } | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["user", id] });

  const issue = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPending(true);
    setError("");
    const data = new FormData(event.currentTarget);
    const expires = String(data.get("expiresAt"));
    const quota = String(data.get("quotaPolicyId"));
    try {
      const result = await api.issueConnection(id, {
        instanceId: String(data.get("instanceId")),
        name: String(data.get("name")),
        expiresAt: expires ? new Date(expires).toISOString() : null,
        quotaPolicyId: quota || null,
      });
      setShowIssue(false);
      setIssued(result);
      refresh();
    } catch (caught) {
      setError(caught instanceof ApiProblem && caught.problem.code === "ADDRESS_POOL_UNAVAILABLE"
        ? t("addressAllocationError")
        : caught instanceof Error ? caught.message : t("error"));
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="page">
      <AsyncPanel pending={user.isPending} error={user.error}>
        {user.data ? <>
          <header className="page-header"><div><Link to="/users" className="back-link">← {t("users")}</Link><h1>{user.data.user.displayName}</h1><p className="muted">{user.data.user.notes}</p></div><button className="button primary" onClick={() => setShowIssue(true)}>+ {t("issueConnection")}</button></header>
          <h2 className="section-title">{t("connections")}</h2>
          <div className="connection-grid">{user.data.connections.map((connection) => <ConnectionCard key={connection.id} connection={connection} onChanged={refresh} />)}</div>
          {user.data.connections.length === 0 ? <div className="panel empty-state">{t("empty")}</div> : null}
        </> : null}
      </AsyncPanel>
      {showIssue ? <Modal title={t("issueConnection")} onClose={() => setShowIssue(false)}><form onSubmit={(event) => void issue(event)}>
        <label>{t("deviceName")}<input name="name" required maxLength={120} /></label>
        <label>{t("instance")}<select name="instanceId" required>{instances.data?.items.filter((item) => item.mode === "managed").map((item) => <option key={item.id} value={item.id}>{item.displayName}</option>)}</select></label>
        <label>{t("expiresAt")}<input name="expiresAt" type="datetime-local" /></label>
        <label>{t("quotas")}<select name="quotaPolicyId"><option value="">—</option>{quotas.data?.items.filter((quota) => quota.nodeId === user.data?.user.nodeId).map((quota) => <option key={quota.id} value={quota.id}>{quota.name}</option>)}</select></label>
        {error ? <p className="form-error">{error}</p> : null}
        <div className="form-actions"><button type="button" className="button ghost" onClick={() => setShowIssue(false)}>{t("cancel")}</button><button className="button primary" disabled={pending}>{pending ? t("loading") : t("issue")}</button></div>
      </form></Modal> : null}
      {issued ? <OneTimeConfig value={issued} onForget={() => setIssued(null)} /> : null}
    </div>
  );
}
