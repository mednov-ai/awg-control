import { useEffect, useMemo, useState } from "react";

import type { Connection, ConnectionIssuance, InstanceRecord } from "@awg-control/contracts";

import { createAmneziaVpnKey } from "../amneziaVpnKey";
import { useI18n } from "../i18n";
import { withRelayEndpoint } from "../relayConfig";
import { Modal } from "./Modal";

function ConfigVariant({ clientConfig, connection, instance, relay = false }: {
  clientConfig: string; connection: Connection; instance: InstanceRecord | undefined; relay?: boolean;
}) {
  const value = useMemo(() => ({ clientConfig, connection }), [clientConfig, connection]);
  const { t } = useI18n();
  const [qr, setQr] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const connectionKey = useMemo(() => {
    if (!instance) return null;
    try {
      return createAmneziaVpnKey(value.clientConfig, value.connection, instance);
    } catch {
      return null;
    }
  }, [instance, value]);

  useEffect(() => {
    let cancelled = false;
    void import("qrcode").then(async ({ default: QRCode }) => {
      const image = await QRCode.toDataURL(value.clientConfig, { errorCorrectionLevel: "M", margin: 2, width: 320 });
      if (!cancelled) setQr(image);
    }).catch(() => { if (!cancelled) setQr(null); });
    return () => {
      cancelled = true;
      setQr(null);
    };
  }, [value.clientConfig]);

  const download = () => {
    const blob = new Blob([value.clientConfig], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${value.connection.name.replaceAll(/[^A-Za-z0-9._-]/g, "-")}${relay ? "-relay" : ""}.conf`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  const copyConnectionKey = async () => {
    if (!connectionKey) return;
    try {
      await navigator.clipboard.writeText(connectionKey);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  };

  return (
    <section aria-label={relay ? t("viaRelay") : t("directConnection")}>
      <div className="issuance-layout">
        <div className="qr-box">{qr ? <img src={qr} alt={relay ? t("relayQrAlt") : t("qrAlt")} /> : <span>{t("loading")}</span>}</div>
        <div>
          <dl className="details-list">
            {instance ? <><dt>{t("instance")}</dt><dd>{instance.displayName} (AWG {instance.protocolVersion})</dd></> : null}
            <dt>{t("connectionEndpoint")}</dt><dd className="mono">{clientConfig.match(/^\s*Endpoint\s*=\s*([^#;\r\n]+)/m)?.[1]?.trim() ?? "—"}</dd>
            <dt>{t("deviceName")}</dt><dd>{value.connection.name}</dd>
            <dt>{t("addressCidr")}</dt><dd className="mono">{value.connection.addressCidr}</dd>
          </dl>
          <button className="button primary wide" onClick={download}>{t("downloadConfig")}</button>
        </div>
      </div>
      {connectionKey ? <section className="connection-key-block">
        <label>{t("connectionKeyLabel")}
          <input className="mono" readOnly value={connectionKey} onFocus={(event) => event.currentTarget.select()} />
        </label>
        <p className="muted">{t("connectionKeyHelp")}</p>
        <button className="button secondary wide" onClick={() => void copyConnectionKey()}>
          {copyState === "copied" ? t("copied") : t("copyConnectionKey")}
        </button>
        {copyState === "failed" ? <p className="form-error">{t("copyFailed")}</p> : null}
      </section> : null}
    </section>
  );
}

export function OneTimeConfig({ value, instance, onForget }: {
  value: ConnectionIssuance; instance: InstanceRecord | undefined; onForget: () => void;
}) {
  const { t } = useI18n();
  const relayConfig = useMemo(() => {
    if (!value.relayEndpoint || instance?.protocolVersion !== "3.1") return null;
    try { return withRelayEndpoint(value.clientConfig, value.relayEndpoint); } catch { return null; }
  }, [value.clientConfig, value.relayEndpoint, instance?.protocolVersion]);
  return <Modal title={t("issuedTitle")} onClose={() => undefined} locked>
    <div className="warning-box">{t("issuedWarning")}</div>
    {relayConfig ? <><p className="muted">{t("relayDeviceGuidance")}</p><h3>{t("directConnection")}</h3></> : null}
    <ConfigVariant clientConfig={value.clientConfig} connection={value.connection} instance={instance} />
    {relayConfig ? <section className="relay-variant">
      <h3>{t("viaRelay")}</h3>
      <p className="mono">{value.relayEndpoint!.host}:{value.relayEndpoint!.port}</p>
      <ConfigVariant clientConfig={relayConfig} connection={value.connection} instance={instance} relay />
    </section> : value.relayEndpoint ? <p role="alert" className="form-error">{t("relayConfigUnavailable")}</p> : null}
    <button className="button danger wide" onClick={onForget}>{t("closeForever")}</button>
  </Modal>;
}
