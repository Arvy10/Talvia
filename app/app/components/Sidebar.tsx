import Link from "next/link";

import { productNavigation } from "./navigation";

type SidebarProps = {
  pathname: string;
  drawer?: boolean;
  onNavigate?: () => void;
};

function isActive(pathname: string, href: string) {
  return href === "/app" ? pathname === href : pathname.startsWith(href);
}

export function Sidebar({ pathname, drawer = false, onNavigate }: SidebarProps) {
  return <aside className={drawer ? "app-sidebar app-sidebar--drawer" : "app-sidebar"}>
    <Link aria-label="Accueil Talvia" className="app-brand" href="/app" onClick={onNavigate}>
      <span aria-hidden="true" className="app-brand__mark"><i /><i /><i /><i /></span>
      <span>talvia</span>
    </Link>
    <nav aria-label="Navigation de l’application" className="app-navigation">
      {productNavigation.map((item, index) => {
        const Icon = item.icon;
        const utilityItem = index === 5;
        return <div className={utilityItem ? "app-navigation__utility" : undefined} key={item.href}>
          {utilityItem ? <span aria-hidden="true" className="app-navigation__divider" /> : null}
          <Link aria-current={isActive(pathname, item.href) ? "page" : undefined} className={isActive(pathname, item.href) ? "app-navigation__link is-active" : "app-navigation__link"} href={item.href} onClick={onNavigate} title={item.label}>
            <Icon aria-hidden="true" />
            <span>{item.label}</span>
          </Link>
        </div>;
      })}
    </nav>
    <footer className="app-sidebar__footer">
      <span aria-hidden="true">TS</span>
      <div><strong>Sandbox Talvia</strong><small>Mode démonstration</small></div>
    </footer>
  </aside>;
}
