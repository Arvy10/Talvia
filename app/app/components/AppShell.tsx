"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { LuX } from "react-icons/lu";

import { productNavigation } from "./navigation";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import { IconButton } from "./ui";

const drawerFocusableSelector = "a[href], button:not([disabled]), [tabindex]:not([tabindex='-1'])";

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const openingTriggerRef = useRef<HTMLElement | null>(null);
  const drawerRef = useRef<HTMLDivElement>(null);
  const activeItem = productNavigation.find((item) => item.href === "/app" ? pathname === item.href : pathname.startsWith(item.href));
  const title = activeItem?.label ?? "Talvia";

  useEffect(() => {
    setSidebarCollapsed(window.localStorage.getItem("talvia:sidebar-collapsed") === "true");
  }, []);
  const toggleSidebar = () => setSidebarCollapsed((current) => { const next = !current; window.localStorage.setItem("talvia:sidebar-collapsed", String(next)); return next; });

  const openDrawer = () => {
    openingTriggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setDrawerOpen(true);
  };

  useEffect(() => {
    if (!drawerOpen) {
      return;
    }

    const drawer = drawerRef.current;
    drawer?.querySelector<HTMLElement>(drawerFocusableSelector)?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setDrawerOpen(false);
        return;
      }

      if (event.key !== "Tab" || !drawer) {
        return;
      }

      const controls = Array.from(drawer.querySelectorAll<HTMLElement>(drawerFocusableSelector));
      if (controls.length === 0) {
        return;
      }

      const first = controls[0];
      const last = controls.at(-1)!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      openingTriggerRef.current?.focus();
    };
  }, [drawerOpen]);

  return <div className={sidebarCollapsed ? "talvia-app is-sidebar-collapsed" : "talvia-app"}>
    <Sidebar collapsed={sidebarCollapsed} onToggle={toggleSidebar} pathname={pathname} />
    <div className="app-workspace">
      <Topbar onNavigationOpen={openDrawer} title={title} />
      <main className="app-main">{children}</main>
    </div>
    {drawerOpen ? <div className="app-drawer-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) {
        setDrawerOpen(false);
      }
    }}>
      <div aria-label="Navigation de l’application" aria-modal="true" className="app-drawer" ref={drawerRef} role="dialog">
        <IconButton className="app-drawer__close" label="Fermer la navigation" onClick={() => setDrawerOpen(false)}><LuX aria-hidden="true" /></IconButton>
        <Sidebar drawer onNavigate={() => setDrawerOpen(false)} onToggle={() => setDrawerOpen(false)} pathname={pathname} />
      </div>
    </div> : null}
  </div>;
}
