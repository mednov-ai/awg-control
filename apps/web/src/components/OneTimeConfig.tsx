import { useEffect, useState } from "react";

import type { Connection } from "@awg-control/contracts";

import { useI18n } from "../i18n";
import { Modal } from "./Modal";

export function OneTimeConfig({ value, onForget }: { value: { connection: Connection; clientConfig: string }; onForget: () => void }) {
  const { t } = useI18n();
  const [qr, setQr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void import("qrcode").then(async ({ default: QRCode }) => {
      const image = await QRCode.toDataURL(value.clientConfig, { errorCorrectionLevel: "M", margin: 2, width: 320 });
      if (!cancelled) setQr(image);
    });
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
    anchor.download = `${value.connection.name.replaceAll(/[^A-Za-z0-9._-]/g, "-")}.conf`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  return (
    <Modal title={t("issuedTitle")} onClose={() => undefined} locked>
      <div className="warning-box">{t("issuedWarning")}</div>
      <div className="issuance-layout">
        <div className="qr-box">{qr ? <img src={qr} alt={t("qrAlt")} /> : <span>{t("loading")}</span>}</div>
        <div>
          <dl className="details-list">
            <dt>{t("deviceName")}</dt><dd>{value.connection.name}</dd>
            <dt>{t("addressCidr")}</dt><dd className="mono">{value.connection.addressCidr}</dd>
          </dl>
          <button className="button primary wide" onClick={download}>{t("downloadConfig")}</button>
        </div>
      </div>
      <button className="button danger wide" onClick={onForget}>{t("closeForever")}</button>
    </Modal>
  );
}

