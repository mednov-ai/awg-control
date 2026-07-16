import { useDeferredValue, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";

import { api } from "../api";
import { AsyncPanel } from "../components/AsyncPanel";
import { Modal } from "../components/Modal";
import { useI18n } from "../i18n";

export default function UsersPage() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const users = useQuery({ queryKey: ["users", deferredSearch], queryFn: () => api.users(deferredSearch) });
  const nodes = useQuery({ queryKey: ["nodes"], queryFn: api.nodes });
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState("");

  const create = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    try {
      const notes = String(data.get("notes"));
      await api.createUser({
        nodeId: String(data.get("nodeId")),
        displayName: String(data.get("displayName")),
        ...(notes ? { notes } : {}),
      });
      setShowForm(false);
      await queryClient.invalidateQueries({ queryKey: ["users"] });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("error"));
    }
  };

  return (
    <div className="page">
      <header className="page-header"><div><p className="eyebrow">AWG Control</p><h1>{t("users")}</h1></div><button className="button primary" onClick={() => setShowForm(true)}>+ {t("addUser")}</button></header>
      <label className="search-box"><span aria-hidden="true">⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t("searchUsers")} aria-label={t("searchUsers")} /></label>
      <AsyncPanel pending={users.isPending} error={users.error} empty={users.data?.items.length === 0}>
        <div className="panel table-wrap">
          <table><thead><tr><th>{t("displayName")}</th><th>{t("node")}</th><th>{t("status")}</th></tr></thead>
            <tbody>{users.data?.items.map((user) => <tr key={user.id}><td><Link className="user-link" to={`/users/${user.id}`}><span className="avatar small">{user.displayName.slice(0, 1).toUpperCase()}</span>{user.displayName}</Link></td><td className="mono subtle">{user.nodeId.slice(0, 8)}</td><td><span className={`status status-${user.status === "active" ? "active" : user.status === "suspended" ? "suspended" : "pending"}`}>{user.status === "active" ? t("active") : user.status === "suspended" ? t("suspended") : t("archived")}</span></td></tr>)}</tbody>
          </table>
        </div>
      </AsyncPanel>
      {showForm ? <Modal title={t("addUser")} onClose={() => setShowForm(false)}><form onSubmit={(event) => void create(event)}>
        <label>{t("displayName")}<input name="displayName" required maxLength={120} /></label>
        <label>{t("node")}<select name="nodeId" required>{nodes.data?.items.map((node) => <option key={node.id} value={node.id}>{node.name}</option>)}</select></label>
        <label>{t("notes")}<textarea name="notes" maxLength={4000} /></label>
        {error ? <p className="form-error">{error}</p> : null}
        <div className="form-actions"><button type="button" className="button ghost" onClick={() => setShowForm(false)}>{t("cancel")}</button><button className="button primary">{t("save")}</button></div>
      </form></Modal> : null}
    </div>
  );
}
