import type { ReactNode } from "react";

import { useI18n } from "../i18n";

export function AsyncPanel({ pending, error, empty, children }: { pending: boolean; error: unknown; empty?: boolean; children: ReactNode }) {
  const { t } = useI18n();
  if (pending) return <div className="panel empty-state">{t("loading")}</div>;
  if (error) return <div className="panel error-panel">{error instanceof Error ? error.message : t("error")}</div>;
  if (empty) return <div className="panel empty-state">{t("empty")}</div>;
  return <>{children}</>;
}

