import { useRef, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  InstanceRecord,
  RelayAction,
  RelayServer,
} from "@awg-control/contracts";
import { api } from "../api";
import { useI18n } from "../i18n";
import { AsyncPanel } from "../components/AsyncPanel";
import { Modal } from "../components/Modal";

interface Choice {
  instance: InstanceRecord;
  nodeName: string;
}
function RelayCard({
  relay,
  choices,
  onChanged,
}: {
  relay: RelayServer;
  choices: Choice[];
  onChanged: () => Promise<unknown>;
}) {
  const { t } = useI18n();
  const client = useQueryClient();
  const detail = useQuery({
    queryKey: ["relay", relay.id],
    queryFn: () => api.relay(relay.id),
    refetchInterval: 30_000,
  });
  const [pending, setPending] = useState(false),
    [error, setError] = useState("");
  const current = detail.data?.relay ?? relay;
  const blocked =
    detail.data?.operations.some(
      (o) => o.status === "pending" || o.status === "uncertain",
    ) ?? false;
  const refresh = async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: ["relay", relay.id] }),
      onChanged(),
    ]);
  };
  const execute = async (work: () => Promise<unknown>) => {
    setPending(true);
    setError("");
    try {
      await work();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("error"));
    } finally {
      await refresh();
      setPending(false);
    }
  };
  const action = (
    action: Exclude<RelayAction, "status">,
    extra: Record<string, unknown> = {},
  ) => {
    if (action !== "install" && !window.confirm(t("relayChangeConfirm")))
      return;
    void execute(() =>
      api.relayAction(
        relay.id,
        action,
        { expectedFingerprint: current.sourceFingerprint, ...extra },
        crypto.randomUUID(),
      ),
    );
  };
  const apply = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const port = String(data.get("listenPort"));
    action("apply", {
      instanceId: String(data.get("instanceId")),
      ...(port ? { listenPort: Number(port) } : {}),
    });
  };
  const statusLabels = {
    pending: "relayPending",
    ready: "relayReady",
    offline: "relayOffline",
    uninstalled: "relayUninstalled",
  } as const;
  const operationLabels = {
    pending: "relayOperationPending",
    succeeded: "relayOperationSucceeded",
    failed: "relayOperationFailed",
    uncertain: "relayOperationUncertain",
  } as const;
  return (
    <article className="panel relay-card">
      <h2>{current.name}</h2>
      <p className="mono">{current.publicIpv4}</p>
      <p>{t(statusLabels[current.status])}</p>
      {detail.error ? (
        <p role="alert" className="form-error">
          {detail.error.message}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="form-error">
          {error}
        </p>
      ) : null}
      <p className="muted">{t("relayOperationalHelp")}</p>
      <button
        className="button secondary"
        disabled={pending}
        onClick={() => void execute(() => api.checkRelay(relay.id))}
      >
        {t("relayCheck")}
      </button>
      <div className="form-actions">
        <button
          className="button primary"
          disabled={pending || blocked || !current.sourceFingerprint}
          onClick={() => action("install")}
        >
          {t("relayInstall")}
        </button>
        <button
          className="button secondary"
          disabled={
            pending ||
            blocked ||
            !current.sourceFingerprint ||
            current.status === "uninstalled"
          }
          onClick={() => action("update")}
        >
          {t("relayUpdate")}
        </button>
        <button
          className="button danger"
          disabled={pending || blocked || !current.sourceFingerprint}
          onClick={() => action("uninstall")}
        >
          {t("relayUninstall")}
        </button>
        <button
          className="button danger"
          disabled={pending || blocked || current.status !== "uninstalled"}
          onClick={() => {
            if (window.confirm(t("relayChangeConfirm")))
              void execute(() =>
                api.deleteRelay(relay.id, crypto.randomUUID()),
              );
          }}
        >
          {t("relayDelete")}
        </button>
      </div>
      {blocked ? <p className="warning-box">{t("relayPendingHelp")}</p> : null}
      {detail.data?.routes.map((route) => (
        <div key={route.id} className="relay-route">
          <p>
            {choices.find((c) => c.instance.id === route.instanceId)?.instance
              .displayName ?? route.instanceId}
          </p>
          <p className="mono">
            {current.publicIpv4}:{route.listenPort} → {route.upstreamIpv4}:
            {route.upstreamPort}
          </p>
          <button
            className="button secondary"
            disabled={pending || blocked || !route.enabled}
            onClick={() => action("disable", { routeId: route.id })}
          >
            {t("relayDisable")}
          </button>{" "}
          <button
            className="button danger"
            disabled={pending || blocked}
            onClick={() => action("remove", { routeId: route.id })}
          >
            {t("relayRemove")}
          </button>
        </div>
      ))}
      <form onSubmit={apply}>
        <label>
          {t("instance")}
          <select name="instanceId" required disabled={pending || blocked}>
            <option value="">—</option>
            {choices.map((c) => (
              <option key={c.instance.id} value={c.instance.id}>
                {c.nodeName} / {c.instance.displayName} (AWG 3.1)
              </option>
            ))}
          </select>
        </label>
        <label>
          {t("relayListenPort")}
          <input
            name="listenPort"
            type="number"
            min={1024}
            max={65535}
            disabled={pending || blocked}
          />
        </label>
        <p className="muted">{t("relayRouteHelp")}</p>
        <button
          className="button primary"
          disabled={pending || blocked || current.status !== "ready"}
        >
          {t("relayApply")}
        </button>
      </form>
      {detail.data?.operations.map((operation) => (
        <div key={operation.id} className="relay-operation">
          <span className="mono">{operation.operationId}</span> —{" "}
          {t(operationLabels[operation.status])}
          {operation.errorCode ? (
            <span className="mono"> ({operation.errorCode})</span>
          ) : null}
          {operation.status === "pending" ||
          operation.status === "uncertain" ? (
            <button
              className="button secondary"
              disabled={pending}
              onClick={() =>
                void execute(() =>
                  api.reconcileRelay(relay.id, operation.operationId),
                )
              }
            >
              {t("relayReconcile")}
            </button>
          ) : null}
        </div>
      ))}
    </article>
  );
}
export default function RelaysPage() {
  const { t } = useI18n();
  const client = useQueryClient();
  const relays = useQuery({
    queryKey: ["relays"],
    queryFn: api.relays,
    refetchInterval: 30_000,
  });
  const choices = useQuery({
    queryKey: ["relay-instance-choices"],
    queryFn: async () => {
      const nodes = await api.nodes();
      return (
        await Promise.all(
          nodes.items.map(async (node) => {
            const instances = await api.instances(node.id);
            return instances.items
              .filter(
                (i) =>
                  i.protocolVersion === "3.1" &&
                  i.mode === "managed" &&
                  i.capabilities.create,
              )
              .map((instance) => ({ instance, nodeName: node.name }));
          }),
        )
      ).flat();
    },
  });
  const [showForm, setShowForm] = useState(false),
    [pending, setPending] = useState(false),
    [error, setError] = useState("");
  const registrationId = useRef<string | null>(null);
  const refresh = () => client.invalidateQueries({ queryKey: ["relays"] });
  const register = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setPending(true);
    setError("");
    registrationId.current ??= crypto.randomUUID();
    try {
      await api.registerRelay(
        {
          name: String(data.get("nodeName")),
          host: String(data.get("host")),
          publicIpv4: String(data.get("publicIpv4")),
          port: Number(data.get("port")),
          hostKeyFingerprint: String(data.get("hostKey")),
          transportPrivateKey: String(data.get("transportKey")),
        },
        registrationId.current,
      );
      form.reset();
      registrationId.current = null;
      setShowForm(false);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("error"));
    } finally {
      setPending(false);
    }
  };
  return (
    <div className="page">
      <header className="page-header">
        <h1>{t("relays")}</h1>
        <button className="button primary" onClick={() => setShowForm(true)}>
          + {t("addRelay")}
        </button>
      </header>
      {choices.error ? (
        <p role="alert" className="form-error">
          {choices.error.message}
        </p>
      ) : null}
      <AsyncPanel
        pending={relays.isPending}
        error={relays.error}
        empty={relays.data?.items.length === 0}
      >
        <div className="card-list">
          {relays.data?.items.map((relay) => (
            <RelayCard
              key={relay.id}
              relay={relay}
              choices={choices.data ?? []}
              onChanged={refresh}
            />
          ))}
        </div>
      </AsyncPanel>
      {showForm ? (
        <Modal
          title={t("addRelay")}
          onClose={() => {
            if (!pending) {
              setShowForm(false);
              registrationId.current = null;
            }
          }}
        >
          <form
            onSubmit={(event) => void register(event)}
            onChange={() => {
              registrationId.current = null;
            }}
          >
            <p className="muted">{t("relayBootstrapHelp")}</p>
            <label>
              {t("nodeName")}
              <input name="name" required maxLength={120} disabled={pending} />
            </label>
            <label>
              {t("relaySshHost")}
              <input name="host" required disabled={pending} />
            </label>
            <label>
              {t("relayPublicIpv4")}
              <input name="publicIpv4" required disabled={pending} />
            </label>
            <label>
              {t("relaySshPort")}
              <input
                name="port"
                type="number"
                defaultValue={22}
                min={1}
                max={65535}
                required
                disabled={pending}
              />
            </label>
            <label>
              {t("hostKey")}
              <input
                name="hostKeyFingerprint"
                required
                autoComplete="off"
                disabled={pending}
              />
            </label>
            <label>
              {t("transportKey")}
              <textarea
                name="transportPrivateKey"
                required
                autoComplete="off"
                spellCheck={false}
                disabled={pending}
              />
            </label>
            {error ? (
              <p role="alert" className="form-error">
                {error}
              </p>
            ) : null}
            <button className="button primary" disabled={pending}>
              {pending ? t("loading") : t("addRelay")}
            </button>
          </form>
        </Modal>
      ) : null}
    </div>
  );
}
