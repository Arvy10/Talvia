import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";
import type { ConnectionStatus } from "../state/types";

type WithClassName = { className?: string };

function joinClassNames(...classNames: Array<string | undefined>) {
  return classNames.filter(Boolean).join(" ");
}

export function GlassCard({ className, children, ...props }: HTMLAttributes<HTMLElement> & WithClassName) {
  return <section className={joinClassNames("glass-card", className)} {...props}>{children}</section>;
}

export function PageHeader({
  className,
  eyebrow,
  title,
  description,
  actions,
}: WithClassName & {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return <header className={joinClassNames("page-header", className)}>
    <div>
      {eyebrow ? <p className="page-header__eyebrow">{eyebrow}</p> : null}
      <h1>{title}</h1>
      {description ? <p className="page-header__description">{description}</p> : null}
    </div>
    {actions ? <div className="page-header__actions">{actions}</div> : null}
  </header>;
}

const statusLabels: Record<ConnectionStatus, string> = {
  disconnected: "Non connecté",
  connecting: "Connexion…",
  syncing: "Synchronisation…",
  connected: "Connecté",
  error: "Erreur",
};

export function StatusBadge({ status, className }: WithClassName & { status: ConnectionStatus }) {
  return <span className={joinClassNames("status-badge", `status-badge--${status}`, className)}>{statusLabels[status]}</span>;
}

export function EmptyState({
  className,
  icon,
  title,
  description,
  action,
}: WithClassName & {
  icon?: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return <section className={joinClassNames("empty-state", className)}>
    {icon ? <div className="empty-state__icon" aria-hidden="true">{icon}</div> : null}
    <h2>{title}</h2>
    <p>{description}</p>
    {action ? <div className="empty-state__action">{action}</div> : null}
  </section>;
}

export function IconButton({ className, label, type = "button", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
}) {
  return <button aria-label={label} className={joinClassNames("icon-button", className)} type={type} {...props} />;
}
