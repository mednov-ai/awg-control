import { useEffect, useState, type FormEvent } from "react";

import { api } from "../api";
import { useI18n } from "../i18n";

export default function SettingsPage() {
  const { t, language, setLanguage } = useI18n();
  const [enrollment, setEnrollment] = useState<{ secret: string; uri: string } | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!enrollment) {
      setQr(null);
      return;
    }
    let cancelled = false;
    void import("qrcode").then(async ({ default: QRCode }) => {
      const image = await QRCode.toDataURL(enrollment.uri, { width: 240, margin: 2 });
      if (!cancelled) setQr(image);
    });
    return () => { cancelled = true; setQr(null); };
  }, [enrollment]);

  const enroll = async () => {
    setError("");
    try { setEnrollment(await api.enrollTotp()); } catch (caught) { setError(caught instanceof Error ? caught.message : t("error")); }
  };

  const confirm = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const token = String(new FormData(event.currentTarget).get("token"));
    try {
      const result = await api.confirmTotp(token);
      setEnrollment(null);
      setRecoveryCodes(result.recoveryCodes);
    } catch (caught) { setError(caught instanceof Error ? caught.message : t("error")); }
  };

  return <div className="page">
    <header className="page-header"><div><p className="eyebrow">AWG Control</p><h1>{t("settings")}</h1></div></header>
    <div className="settings-grid">
      <section className="panel settings-card"><h2>{t("language")}</h2><div className="segmented"><button className={language === "ru" ? "active" : ""} onClick={() => setLanguage("ru")}>Русский</button><button className={language === "en" ? "active" : ""} onClick={() => setLanguage("en")}>English</button></div></section>
      <section className="panel settings-card"><h2>{t("totp")}</h2>
        {!enrollment && !recoveryCodes ? <button className="button primary" onClick={() => void enroll()}>{t("totpEnable")}</button> : null}
        {enrollment ? <div className="totp-enrollment">{qr ? <img src={qr} alt={t("totpSecret")} /> : null}<label>{t("totpSecret")}<code>{enrollment.secret}</code></label><form onSubmit={(event) => void confirm(event)}><label>{t("oneTimeCode")}<input name="token" inputMode="numeric" autoComplete="one-time-code" required /></label><button className="button primary">{t("confirm")}</button></form></div> : null}
        {recoveryCodes ? <div className="warning-box"><strong>{t("recoveryCodes")}</strong><p>{t("recoveryWarning")}</p><div className="recovery-grid">{recoveryCodes.map((code) => <code key={code}>{code}</code>)}</div><button className="button danger" onClick={() => setRecoveryCodes(null)}>{t("close")}</button></div> : null}
        {error ? <p className="form-error">{error}</p> : null}
      </section>
    </div>
  </div>;
}

