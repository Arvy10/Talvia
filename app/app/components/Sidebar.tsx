import Link from "next/link";
import { LuChevronLeft, LuChevronRight, LuChevronUp } from "react-icons/lu";

import { productNavigation } from "./navigation";

type SidebarProps = {
  pathname: string;
  drawer?: boolean;
  onNavigate?: () => void;
  collapsed?: boolean;
  onCollapse?: () => void;
};

function isActive(pathname: string, href: string) {
  return href === "/app" ? pathname === href : pathname.startsWith(href);
}

export function Sidebar({ pathname, drawer = false, onNavigate, collapsed = false, onCollapse }: SidebarProps) {
  return <aside className={`${drawer ? "app-sidebar app-sidebar--drawer" : "app-sidebar"}${collapsed ? " is-collapsed" : ""}`}>
    <Link aria-label="Accueil Talvia" className="app-brand" href="/app" onClick={onNavigate}>
      <span aria-hidden="true" className="app-brand__mark"><i /><i /><i /><i /></span>
      <span>talvia</span>
    </Link>
    <nav aria-label="Navigation de l’application" className="app-navigation">
      {productNavigation.map((item, index) => {
        const Icon = item.icon;
        const utilityItem = item.href === "/app/connections";
        return <div className={utilityItem ? "app-navigation__utility" : undefined} key={item.href}>
          {utilityItem ? <span aria-hidden="true" className="app-navigation__divider" /> : null}
          <Link aria-current={isActive(pathname, item.href) ? "page" : undefined} className={isActive(pathname, item.href) ? "app-navigation__link is-active" : "app-navigation__link"} href={item.href} onClick={onNavigate} title={item.label}>
            <Icon aria-hidden="true" />
            <span>{item.label}</span>
          </Link>
        </div>;
      })}
    </nav>
    {!drawer ? <button aria-label={collapsed ? "Agrandir la sidebar" : "Réduire la sidebar"} className="sidebar-collapse-button" onClick={onCollapse} title={collapsed ? "Agrandir" : "Réduire"} type="button">{collapsed ? <LuChevronRight /> : <><LuChevronLeft /><span>Réduire</span></>}</button> : null}
    <footer className="app-sidebar__footer">
      <span aria-hidden="true">TS</span>
      <details className="app-user-menu">
        <summary><div><strong>Sandbox Talvia</strong><small>Mode démonstration</small></div><LuChevronUp aria-hidden="true" /></summary>
        <div className="app-user-menu__panel"><Link href="/app/profile" onClick={onNavigate}>Mon profil</Link><Link href="/app/settings" onClick={onNavigate}>Mon workspace</Link><Link href="/app/settings#subscription" onClick={onNavigate}>Abonnement</Link><Link href="/app/settings" onClick={onNavigate}>Paramètres</Link><Link className="app-user-menu__logout" href="/login" onClick={onNavigate}>Se déconnecter</Link></div>
      </details>
    </footer>
  </aside>;
}
