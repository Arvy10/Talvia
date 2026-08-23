import Link from "next/link";
import { LuChevronUp } from "react-icons/lu";

import { productNavigation } from "./navigation";

type SidebarProps = {
  pathname: string;
  drawer?: boolean;
  onNavigate?: () => void;
  collapsed?: boolean;
  onToggle?: () => void;
};

function isActive(pathname: string, href: string) {
  return href === "/app" ? pathname === href : pathname.startsWith(href);
}

export function Sidebar({ pathname, drawer = false, onNavigate, collapsed = false, onToggle }: SidebarProps) {
  const brand = <><span aria-hidden="true" className="app-brand__mark"><i /><i /><i /><i /></span><span>talvia</span></>;

  return <aside className={`${drawer ? "app-sidebar app-sidebar--drawer" : "app-sidebar"}${collapsed ? " is-collapsed" : ""}`}>
    {onToggle ? <button aria-label={collapsed ? "Agrandir la navigation" : "Réduire la navigation"} className="app-brand app-brand--toggle" onClick={onToggle} title={collapsed ? "Agrandir la navigation" : "Réduire la navigation"} type="button">{brand}</button> : <Link aria-label="Accueil Talvia" className="app-brand" href="/app" onClick={onNavigate}>{brand}</Link>}
    <nav aria-label="Navigation de l’application" className="app-navigation">
      {productNavigation.map((item, index) => {
        const Icon = item.icon;
        const showGroup = index === 0 || productNavigation[index - 1].group !== item.group;
        return <div className="app-navigation__group" key={item.href}>
          {showGroup ? <span aria-hidden="true" className="app-navigation__label">{item.group}</span> : null}
          <Link aria-current={isActive(pathname, item.href) ? "page" : undefined} className={isActive(pathname, item.href) ? "app-navigation__link is-active" : "app-navigation__link"} href={item.href} onClick={onNavigate} title={item.label}>
            <Icon aria-hidden="true" />
            <span>{item.label}</span>
          </Link>
        </div>;
      })}
    </nav>
    <footer className="app-sidebar__footer">
      <span aria-hidden="true">TS</span>
      <details className="app-user-menu">
        <summary><div><strong>Sandbox Talvia</strong><small>Mode démonstration</small></div><LuChevronUp aria-hidden="true" /></summary>
        <div className="app-user-menu__panel"><Link href="/app/profile" onClick={onNavigate}>Mon profil</Link><Link href="/app/settings" onClick={onNavigate}>Mon workspace</Link><Link href="/app/settings#subscription" onClick={onNavigate}>Abonnement</Link><Link href="/app/settings" onClick={onNavigate}>Paramètres</Link><Link className="app-user-menu__logout" href="/login" onClick={onNavigate}>Se déconnecter</Link></div>
      </details>
    </footer>
  </aside>;
}
