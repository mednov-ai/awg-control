import { useEffect, useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";

import { api } from "../api";
import { useI18n } from "../i18n";

export default function SettingsPage() {
  const { t, language, setLanguage } = useI18n();
  const [enrollment, setEnrollment] = useState<{ secret: string; uri: string } | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [error, setError] = useState("");
  const sessions = useQuery({ queryKey: ["admin-sessions"], queryFn: api.sessions });

  const revoke = async (id: string) => {
    if (!window.confirm(t("revokeSessionConfirm"))) return;
    try { await api.revokeSession(id); await sessions.refetch(); } catch (caught) { setError(caught instanceof Error ? caught.message : t("error")); }
  };

  const revokeOthers = async () => {
    if (!window.confirm(t("revokeOthersConfirm"))) return;
    try { await api.revokeOtherSessions(); await sessions.refetch(); } catch (caught) { setError(caught instanceof Error ? caught.message : t("error")); }
  };

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
      <section className="panel settings-card session-settings"><div className="session-title"><div><h2>{t("activeSessions")}</h2><p className="muted">{t("activeSessionsHelp")}</p></div><button className="button danger" disabled={!sessions.data?.items.some((item) => !item.current)} onClick={() => void revokeOthers()}>{t("revokeOthers")}</button></div>
        {sessions.isLoading ? <p>{t("loading")}</p> : sessions.isError ? <p className="form-error" role="alert">{t("sessionsLoadError")}</p> : null}
        <div className="session-list">{sessions.data?.items.map((session) => <article className="session-row" key={session.id}>
          <div><strong>{session.deviceLabel ?? t("unknownDevice")}</strong>{session.current ? <span className="status status-active">{t("currentSession")}</span> : null}<small>{session.kind === "remembered" ? t("rememberedSession") : t("shortSession")} · {session.remoteAddress ?? t("unknownAddress")}</small><small>{t("lastActive")}: {new Date(session.lastSeenAt).toLocaleString(language)} · {t("expiresAt")}: {new Date(session.expiresAt).toLocaleString(language)}</small>{session.idleExpiresAt ? <small>{t("idleExpiresAt")}: {new Date(session.idleExpiresAt).toLocaleString(language)}</small> : null}</div>
          <button className="button danger" aria-label={`${t("revokeSession")}: ${session.deviceLabel ?? t("unknownDevice")}`} onClick={() => void revoke(session.id)}>{t("revokeSession")}</button>
        </article>)}</div>
      </section>
    </div>
  </div>;
}
