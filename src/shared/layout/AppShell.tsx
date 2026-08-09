"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import {
  Activity,
  Boxes,
  CircleUserRound,
  Cpu,
  Gauge,
  LogOut,
  Menu,
  Network,
  ScrollText,
  ServerCog,
  Settings2,
  X,
} from "lucide-react";
import { api } from "@/lib/client-api";
import { AuthProvider, useAuth } from "@/shared/providers/AuthContext";

const publicPaths = new Set(["/login", "/setup"]);

function Frame({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { loading, user, permissions, settings } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  if (loading || !user)
    return (
      <div className="app-loading">
        <span className="loading-ring" />
        <span>Starting control plane</span>
      </div>
    );
  const controlNav = [
    { href: "/", label: "Overview", icon: Gauge, show: true, exact: true },
    { href: "/controllers", label: "Controllers", icon: ServerCog, show: true },
    { href: "/nodes", label: "Nodes", icon: Cpu, show: true },
    { href: "/networks", label: "Networks", icon: Network, show: true },
    { href: "/diagnostics", label: "Diagnostics", icon: Activity, show: true },
  ];
  const workspaceNav = [
    {
      href: "/settings",
      label: "Settings",
      icon: Settings2,
      show: permissions.canManageUsers,
    },
    {
      href: "/audit",
      label: "Audit",
      icon: ScrollText,
      show: permissions.canViewAudit,
    },
  ];
  function navLinks(items: typeof controlNav) {
    return items
      .filter((item) => item.show)
      .map((item) => {
        const active = item.exact
          ? pathname === item.href
          : pathname.startsWith(item.href);
        return (
          <Link
            href={item.href}
            key={item.href}
            className={active ? "active" : ""}
            onClick={() => setMenuOpen(false)}
          >
            <item.icon />
            {item.label}
          </Link>
        );
      });
  }
  async function logout() {
    await api("/api/auth/logout", { method: "POST" });
    window.location.replace("/login");
  }
  return (
    <div className="app-frame">
      <header className="top-navigation">
        <Link href="/" className="brand">
          <span className="brand-mark">
            <Boxes />
          </span>
          <span>
            <strong>ZT CONTROL PLANE</strong>
            <small title={settings.workspaceName}>
              {settings.workspaceName}
            </small>
          </span>
        </Link>
        <nav
          className={`primary-nav ${menuOpen ? "open" : ""}`}
          aria-label="Primary navigation"
        >
          <div className="mobile-nav-head">
            <span className="eyebrow">Navigation</span>
            <button
              className="icon-button"
              onClick={() => setMenuOpen(false)}
              aria-label="Close navigation"
            >
              <X />
            </button>
          </div>
          <div className="nav-group control-nav-group">
            <span className="nav-group-label">Control plane</span>
            {navLinks(controlNav)}
          </div>
          {workspaceNav.some((item) => item.show) && (
            <div className="nav-group workspace-nav-group">
              <span className="nav-group-label">Workspace</span>
              {navLinks(workspaceNav)}
            </div>
          )}
          <div className="mobile-account">
            <CircleUserRound />
            <Link href="/profile" onClick={() => setMenuOpen(false)}>
              <strong>{user.displayName}</strong>
              <small>{user.role}</small>
            </Link>
            <button
              className="icon-button"
              onClick={() => void logout()}
              aria-label="Sign out"
            >
              <LogOut />
            </button>
          </div>
        </nav>
        <div className="nav-tools">
          <div className="account-chip">
            <Link
              href="/profile"
              className={`account-avatar ${pathname.startsWith("/profile") ? "active" : ""}`}
              aria-label="Open your profile"
              title={user.displayName}
            >
              {user.displayName.slice(0, 1).toUpperCase()}
            </Link>
            <button
              className="icon-button"
              onClick={() => void logout()}
              aria-label="Sign out"
            >
              <LogOut />
            </button>
          </div>
          <button
            className="mobile-menu"
            onClick={() => setMenuOpen(true)}
            aria-label="Open navigation"
          >
            <Menu />
          </button>
        </div>
      </header>
      {menuOpen && (
        <button
          className="nav-scrim"
          aria-label="Close navigation"
          onClick={() => setMenuOpen(false)}
        />
      )}
      <main className="content">{children}</main>
    </div>
  );
}

function Boundary({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { loading, error, refresh, setupRequired, user } = useAuth();
  if (loading)
    return (
      <div className="app-loading">
        <span className="loading-ring" />
        <span>Starting control plane</span>
      </div>
    );
  if (error)
    return (
      <main className="auth-page">
        <section className="auth-card" role="alert">
          <span className="eyebrow">Connection interrupted</span>
          <h1>Control plane is temporarily unavailable</h1>
          <p>{error}</p>
          <button className="button primary" onClick={() => void refresh()}>
            Try again
          </button>
        </section>
      </main>
    );
  if (publicPaths.has(pathname))
    return <main className="auth-page">{children}</main>;
  if (setupRequired || !user)
    return (
      <div className="app-loading">
        <span className="loading-ring" />
        <span>Securing your session</span>
      </div>
    );
  return <Frame>{children}</Frame>;
}

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      <Boundary>{children}</Boundary>
    </AuthProvider>
  );
}
