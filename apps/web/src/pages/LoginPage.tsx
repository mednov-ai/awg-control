import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "../api";
import { useI18n } from "../i18n";

export function LoginPage() {
  const { t, language, setLanguage } = useI18n();
  const queryClient = useQueryClient();
  const bootstrap = useQuery({ queryKey: ["bootstrap"], queryFn: api.bootstrap, retry: false });
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [totp, setTotp] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setPending(true);
    setError("");
    try {
      const session = await api.login(username, password, totp || undefined);
      queryClient.setQueryData(["session"], session);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("loginError"));
    } finally {
      setPassword("");
      setPending(false);
    }
  };

  return (
    <main className="login-page">
      <section className="login-card">
        <div className="brand login-brand"><div className="brand-mark" aria-hidden="true">A</div><div><strong>AWG Control</strong><span>{t("productTagline")}</span></div></div>
        {bootstrap.data?.required ? <div className="warning-box">{t("bootstrapRequired")}</div> : null}
        <form onSubmit={(event) => void submit(event)}>
          <label>{t("username")}<input autoComplete="username" required value={username} onChange={(event) => setUsername(event.target.value)} /></label>
          <label>{t("password")}<input type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} /></label>
          <label>{t("oneTimeCode")}<input inputMode="numeric" autoComplete="one-time-code" value={totp} onChange={(event) => setTotp(event.target.value)} /></label>
          {error ? <p className="form-error" role="alert">{error}</p> : null}
          <button className="button primary wide" disabled={pending || Boolean(bootstrap.data?.required)}>{pending ? t("loading") : t("signIn")}</button>
        </form>
        <div className="language-row">
          <button className={language === "ru" ? "active" : ""} onClick={() => setLanguage("ru")}>Русский</button>
          <button className={language === "en" ? "active" : ""} onClick={() => setLanguage("en")}>English</button>
        </div>
      </section>
    </main>
  );
}

