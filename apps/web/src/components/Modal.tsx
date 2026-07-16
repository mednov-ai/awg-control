import { useEffect, type PropsWithChildren } from "react";

import { useI18n } from "../i18n";

export function Modal({ title, onClose, children, locked = false }: PropsWithChildren<{ title: string; onClose: () => void; locked?: boolean }>) {
  const { t } = useI18n();
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !locked) onClose();
    };
    document.addEventListener("keydown", listener);
    return () => document.removeEventListener("keydown", listener);
  }, [locked, onClose]);

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={locked ? undefined : onClose}>
      <section className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-header"><h2 id="modal-title">{title}</h2>{locked ? null : <button className="icon-button" aria-label={t("close")} onClick={onClose}>×</button>}</div>
        {children}
      </section>
    </div>
  );
}
