import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import type { InstanceRecord } from "@awg-control/contracts";

import { api } from "../api";
import { AsyncPanel } from "../components/AsyncPanel";
import { Modal } from "../components/Modal";
import { StatusBadge } from "../components/StatusBadge";
import { useI18n } from "../i18n";

interface ObservedPeer {
  publicKey: string;
  publicKeyFingerprint: string;
  addressCidr: string;
  name: string;
}

export default function NodesPage() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const nodes = useQuery({ queryKey: ["nodes"], queryFn: api.nodes, refetchInterval: 60_000 });
  const [showForm, setShowForm] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [instances, setInstances] = useState<Record<string, InstanceRecord[]>>({});
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [importView, setImportView] = useState<{ instance: InstanceRecord; peers: ObservedPeer[] } | null>(null);
  const [assignments, setAssignments] = useState<Record<string, string>>({});
  const users = useQuery({ queryKey: ["users", "peer-import"], queryFn: () => api.users(), enabled: Boolean(importView) });

  const create = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPending(true);
    setError("");
    const data = new FormData(event.currentTarget);
    try {
      await api.createNode({
        name: String(data.get("name")),
        host: String(data.get("host")),
        hostKeyFingerprint: String(data.get("hostKeyFingerprint")),
        transportPrivateKey: String(data.get("transportPrivateKey")),
      });
      event.currentTarget.reset();
      setShowForm(false);
      await queryClient.invalidateQueries({ queryKey: ["nodes"] });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("error"));
    } finally {
      setPending(false);
    }
  };

  const discover = async (nodeId: string) => {
    setPending(true);
    setError("");
    try {
      const result = await api.discoverNode(nodeId);
      setInstances((current) => ({ ...current, [nodeId]: result.items }));
      setSelected(nodeId);
      await queryClient.invalidateQueries({ queryKey: ["nodes"] });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("error"));
    } finally {
      setPending(false);
    }
  };

  const manage = async (instance: InstanceRecord) => {
    const updated = await api.manageInstance(instance.id);
    setInstances((current) => ({
      ...current,
      [instance.nodeId]: (current[instance.nodeId] ?? []).map((item) => item.id === updated.id ? updated : item),
    }));
  };

  const inspectPeers = async (instance: InstanceRecord) => {
    setPending(true);
    setError("");
    try {
      const result = await api.instancePeers(instance.id);
      setAssignments({});
      setImportView({ instance, peers: result.peers });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("error"));
    } finally {
      setPending(false);
    }
  };

  const importPeers = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!importView) return;
    const peers = importView.peers.map((peer) => ({
      vpnUserId: assignments[peer.publicKey] ?? "",
      name: peer.name || `${t("importedPeer")} ${peer.publicKeyFingerprint}`,
      publicKey: peer.publicKey,
      addressCidr: peer.addressCidr,
    }));
    if (peers.some((peer) => !peer.vpnUserId)) {
      setError(t("assignEveryPeer"));
      return;
    }
    setPending(true);
    setError("");
    try {
      await api.importPeers(importView.instance.id, peers);
      setImportView(null);
      await queryClient.invalidateQueries({ queryKey: ["users"] });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("error"));
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="page">
      <header className="page-header"><div><p className="eyebrow">AWG Control</p><h1>{t("nodes")}</h1></div><button className="button primary" onClick={() => setShowForm(true)}>+ {t("addNode")}</button></header>
      {error ? <div className="warning-box" role="alert">{error}</div> : null}
      <AsyncPanel pending={nodes.isPending} error={nodes.error} empty={nodes.data?.items.length === 0}>
        <div className="card-list">
          {nodes.data?.items.map((node) => (
            <article className="panel node-card" key={node.id}>
              <button className="node-heading" onClick={() => setSelected(selected === node.id ? null : node.id)} aria-expanded={selected === node.id}>
                <span className="node-icon" aria-hidden="true">⬡</span>
                <span><strong>{node.name}</strong><small>{node.host}:{node.port}</small></span>
                <StatusBadge status={node.status} />
              </button>
              <div className="node-actions"><button className="button secondary" disabled={pending} onClick={() => void discover(node.id)}>{t("discover")}</button><span className="mono fingerprint">{node.hostKeyFingerprint}</span></div>
              {selected === node.id ? (
                <div className="instance-list">
                  {(instances[node.id] ?? []).map((instance) => (
                    <div className="instance-row" key={instance.id}>
                      <div><strong>{instance.displayName}</strong><small>{instance.adapter} · {instance.protocolVersion} · {instance.interfaceName}</small></div>
                      <span className={`status ${instance.mode === "managed" ? "status-active" : "status-pending"}`}>{instance.mode === "managed" ? t("managed") : t("readOnly")}</span>
                      <div className="button-row instance-buttons">
                        <button className="button secondary" disabled={pending} onClick={() => void inspectPeers(instance)}>{t("inspectPeers")}</button>
                        {instance.mode !== "managed" && instance.capabilities.create ? <button className="button secondary" onClick={() => void manage(instance)}>{t("enableManagement")}</button> : null}
                      </div>
                    </div>
                  ))}
                  {(instances[node.id] ?? []).length === 0 ? <p className="muted">{t("empty")}</p> : null}
                </div>
              ) : null}
            </article>
          ))}
        </div>
      </AsyncPanel>
      {showForm ? (
        <Modal title={t("addNode")} onClose={() => setShowForm(false)}>
          <form onSubmit={(event) => void create(event)}>
            <label>{t("nodeName")}<input name="name" required maxLength={120} /></label>
            <label>{t("host")}<input name="host" required maxLength={253} placeholder="vpn.example.com" /></label>
            <label>{t("hostKey")}<input className="mono" name="hostKeyFingerprint" required placeholder="SHA256:…" /></label>
            <label>{t("transportKey")}<textarea className="mono key-input" name="transportPrivateKey" required autoComplete="off" /></label>
            <p className="field-help">{t("transportKeyHelp")}</p>
            {error ? <p className="form-error">{error}</p> : null}
            <div className="form-actions"><button type="button" className="button ghost" onClick={() => setShowForm(false)}>{t("cancel")}</button><button className="button primary" disabled={pending}>{t("save")}</button></div>
          </form>
        </Modal>
      ) : null}
      {importView ? (
        <Modal title={t("importObservedPeers")} onClose={() => setImportView(null)}>
          <form onSubmit={(event) => void importPeers(event)}>
            <p className="field-help">{t("importObservedHelp")}</p>
            <div className="peer-import-list">
              {importView.peers.map((peer) => (
                <label className="peer-import-row" key={peer.publicKey}>
                  <span><strong>{peer.name || t("importedPeer")}</strong><small className="mono">{peer.publicKeyFingerprint} · {peer.addressCidr}</small></span>
                  <select
                    required
                    value={assignments[peer.publicKey] ?? ""}
                    onChange={(event) => setAssignments((current) => ({ ...current, [peer.publicKey]: event.target.value }))}
                  >
                    <option value="">{t("selectUser")}</option>
                    {users.data?.items
                      .filter((user) => user.nodeId === importView.instance.nodeId)
                      .map((user) => <option key={user.id} value={user.id}>{user.displayName}</option>)}
                  </select>
                </label>
              ))}
            </div>
            {importView.peers.length === 0 ? <div className="empty-state">{t("empty")}</div> : null}
            {error ? <p className="form-error" role="alert">{error}</p> : null}
            <div className="form-actions"><button type="button" className="button ghost" onClick={() => setImportView(null)}>{t("cancel")}</button><button className="button primary" disabled={pending || importView.peers.length === 0}>{t("importObservedPeers")}</button></div>
          </form>
        </Modal>
      ) : null}
    </div>
  );
}
