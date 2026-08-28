import { lazy, Suspense } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Navigate, NavLink, Route, Routes } from "react-router-dom";

import { api, ApiProblem } from "../api";
import { useI18n } from "../i18n";
import { LoginPage } from "../pages/LoginPage";

const DashboardPage = lazy(() => import("../pages/DashboardPage"));
const NodesPage = lazy(() => import("../pages/NodesPage"));
const UsersPage = lazy(() => import("../pages/UsersPage"));
const UserPage = lazy(() => import("../pages/UserPage"));
const QuotasPage = lazy(() => import("../pages/QuotasPage"));
const AuditPage = lazy(() => import("../pages/AuditPage"));
const SettingsPage = lazy(() => import("../pages/SettingsPage"));

const navItems = [
  ["/", "dashboard", "◫"],
  ["/nodes", "nodes", "⬡"],
  ["/users", "users", "◎"],
  ["/quotas", "quotas", "◒"],
  ["/audit", "audit", "≋"],
  ["/settings", "settings", "⚙"],
] as const;

export function App() {
  const { t, language, setLanguage } = useI18n();
  const queryClient = useQueryClient();
  const session = useQuery({ queryKey: ["session"], queryFn: api.me, retry: false });

  if (session.isPending) return <div className="center-state">{t("loading")}</div>;
  if (session.isError && session.error instanceof ApiProblem && session.error.problem.status === 401) {
    return <LoginPage />;
  }
  if (session.isError) {
    return (
      <div className="center-state error-panel">
        <p>{session.error instanceof Error ? session.error.message : t("error")}</p>
        <button onClick={() => void session.refetch()}>{t("retry")}</button>
      </div>
    );
  }

  const signOut = async () => {
    await api.logout();
    queryClient.clear();
    window.location.assign("/");
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">A</div>
          <div><strong>AWG Control</strong><span>{t("productTagline")}</span></div>
        </div>
        <nav aria-label={t("settings")}>
          {navItems.map(([href, label, icon]) => (
            <NavLink key={href} to={href} end={href === "/"} className={({ isActive }) => isActive ? "active" : undefined}>
              <span aria-hidden="true">{icon}</span>{t(label)}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-footer">
          <label className="language-control">
            <span>{t("language")}</span>
            <select value={language} onChange={(event) => setLanguage(event.target.value as "ru" | "en")}>
              <option value="ru">Русский</option>
              <option value="en">English</option>
            </select>
          </label>
          <div className="admin-line"><span className="avatar">{session.data.admin.username.slice(0, 1).toUpperCase()}</span>{session.data.admin.username}</div>
          <button className="button ghost wide" onClick={() => void signOut()}>{t("signOut")}</button>
        </div>
      </aside>
      <main className="main-content">
        <Suspense fallback={<div className="center-state">{t("loading")}</div>}>
          <Routes>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/nodes" element={<NodesPage />} />
            <Route path="/users" element={<UsersPage />} />
            <Route path="/users/:id" element={<UserPage />} />
            <Route path="/quotas" element={<QuotasPage />} />
            <Route path="/audit" element={<AuditPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </main>
    </div>
  );
}

