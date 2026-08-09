"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  Database,
  Network,
  RefreshCw,
  Settings2,
  ShieldCheck,
  TimerReset,
} from "lucide-react";
import { api, jsonRequest } from "@/lib/client-api";
import { useAuth } from "@/shared/providers/AuthContext";
import { UsersPage } from "@/features/users/UsersPage";
import type { AppSettings } from "@/lib/types";

type SettingsTab = "general" | "security" | "users";

interface SettingsResponse {
  settings: AppSettings;
  options: {
    refreshSeconds: AppSettings["refreshSeconds"][];
    auditRetentionDays: AppSettings["auditRetentionDays"][];
  };
  environment: {
    publicUrl: string | null;
    trustedProxy: boolean;
    secureCookies: boolean;
    database: string;
    storage: string;
    clientIp: string | null;
    ipAllowlistBypass: boolean;
  };
}

const sessionOptions = [1, 4, 8, 12, 24, 72, 168];

export function SettingsPage({ initialTab }: { initialTab: SettingsTab }) {
  const router = useRouter();
  const { permissions, refresh: refreshContext } = useAuth();
  const [tab, setTab] = useState<SettingsTab>(initialTab);
  const [data, setData] = useState<SettingsResponse | null>(null);
  const [draft, setDraft] = useState<AppSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => setTab(initialTab), [initialTab]);
  useEffect(() => {
    if (!permissions.canManageUsers) {
      setLoading(false);
      return;
    }
    void (async () => {
      try {
        const result = await api<SettingsResponse>("/api/settings");
        setData(result);
        setDraft(result.settings);
      } catch (caught) {
        setError(
          caught instanceof Error ? caught.message : "Unable to load settings.",
        );
      } finally {
        setLoading(false);
      }
    })();
  }, [permissions.canManageUsers]);

  function selectTab(next: SettingsTab) {
    setTab(next);
    setMessage("");
    router.replace(`/settings?tab=${next}`, { scroll: false });
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!draft) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await api<SettingsResponse>(
        "/api/settings",
        jsonRequest("PUT", draft),
      );
      setData(result);
      setDraft(result.settings);
      await refreshContext({ silent: true });
      setMessage("Settings saved.");
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Unable to save settings.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (!permissions.canManageUsers)
    return (
      <section className="card access-denied-card">
        <ShieldCheck />
        <span className="eyebrow">Administrator access</span>
        <h1>Settings are restricted</h1>
        <p>Only administrators can change global settings and manage users.</p>
      </section>
    );

  return (
    <>
      <div className="page-heading compact-heading">
        <div>
          <span className="eyebrow">Global administration</span>
          <h1>Settings</h1>
          <p>Configure this control plane, its security defaults and access.</p>
        </div>
        <Settings2 />
      </div>
      <div className="tabs settings-tabs" aria-label="Settings sections">
        <button
          className={tab === "general" ? "active" : ""}
          onClick={() => selectTab("general")}
        >
          General
        </button>
        <button
          className={tab === "security" ? "active" : ""}
          onClick={() => selectTab("security")}
        >
          Security & data
        </button>
        <button
          className={tab === "users" ? "active" : ""}
          onClick={() => selectTab("users")}
        >
          Users & roles
        </button>
      </div>
      {error && <div className="alert error">{error}</div>}
      {message && (
        <div className="alert success">
          <Check /> {message}
        </div>
      )}
      {loading ? (
        <section className="card settings-loading">
          <span className="loading-ring" /> Loading settings
        </section>
      ) : tab === "users" ? (
        <UsersPage embedded />
      ) : !data || !draft ? null : tab === "general" ? (
        <form className="settings-layout" onSubmit={save}>
          <section className="card settings-wide-card">
            <div className="card-header">
              <div>
                <span className="eyebrow">Live information</span>
                <h2>Automatic refresh</h2>
                <p>
                  Applies to overview, networks, nodes, diagnostics and audit.
                </p>
              </div>
              <RefreshCw />
            </div>
            <div className="card-body settings-compact-control">
              <label className="field">
                <span>Refresh interval</span>
                <select
                  className="select"
                  value={draft.refreshSeconds}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      refreshSeconds: Number(
                        event.target.value,
                      ) as AppSettings["refreshSeconds"],
                    })
                  }
                >
                  {data.options.refreshSeconds.map((seconds) => (
                    <option key={seconds} value={seconds}>
                      Every {seconds} seconds
                    </option>
                  ))}
                </select>
                <small>
                  Changes take effect immediately. Refresh pauses in hidden tabs
                  and resumes when the window regains focus.
                </small>
              </label>
            </div>
          </section>
          <div className="settings-actions settings-wide-card">
            <button className="button primary" disabled={busy}>
              {busy ? "Saving…" : "Save general settings"}
            </button>
          </div>
        </form>
      ) : (
        <form className="settings-layout" onSubmit={save}>
          <section className="card">
            <div className="card-header">
              <div>
                <span className="eyebrow">Authentication</span>
                <h2>Session policy</h2>
                <p>The new lifetime applies when a user signs in again.</p>
              </div>
              <TimerReset />
            </div>
            <div className="card-body">
              <label className="field">
                <span>New session lifetime</span>
                <select
                  className="select"
                  value={draft.sessionHours}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      sessionHours: Number(event.target.value),
                    })
                  }
                >
                  {sessionOptions.map((hours) => (
                    <option key={hours} value={hours}>
                      {hours === 168
                        ? "7 days"
                        : `${hours} hour${hours === 1 ? "" : "s"}`}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </section>
          <section className="card">
            <div className="card-header">
              <div>
                <span className="eyebrow">Data lifecycle</span>
                <h2>Audit retention</h2>
                <p>
                  Older entries are removed when the next audit event is
                  written.
                </p>
              </div>
              <Database />
            </div>
            <div className="card-body">
              <label className="field">
                <span>Keep audit events</span>
                <select
                  className="select"
                  value={draft.auditRetentionDays}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      auditRetentionDays: Number(
                        event.target.value,
                      ) as AppSettings["auditRetentionDays"],
                    })
                  }
                >
                  {data.options.auditRetentionDays.map((days) => (
                    <option key={days} value={days}>
                      {days === 0 ? "Forever" : `${days} days`}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </section>
          <section className="card settings-wide-card">
            <div className="card-header">
              <div>
                <span className="eyebrow">Web interface boundary</span>
                <h2>IP access list</h2>
                <p>
                  Allow the login page, interface and APIs only from approved
                  addresses and networks.
                </p>
              </div>
              <Network />
            </div>
            <div className="card-body ip-access-settings">
              <div className="switch-field">
                <span>
                  <strong>Restrict access by source IP</strong>
                  <small>
                    Rules apply to every route except the health check used by
                    Docker and other container platforms.
                  </small>
                </span>
                <label className="switch">
                  <input
                    type="checkbox"
                    checked={draft.ipAllowlistEnabled}
                    disabled={
                      !data.environment.trustedProxy &&
                      !draft.ipAllowlistEnabled
                    }
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        ipAllowlistEnabled: event.target.checked,
                      })
                    }
                    aria-label="Restrict access by source IP"
                  />
                  <span />
                </label>
              </div>
              {!data.environment.trustedProxy && (
                <div className="ip-access-notice">
                  <strong>Trusted proxy required</strong>
                  <span>
                    Configure TRUST_PROXY=1 only when the application is
                    reachable through a reverse proxy that replaces forwarded IP
                    headers. You can prepare rules now, but activation stays
                    disabled.
                  </span>
                </div>
              )}
              {data.environment.ipAllowlistBypass && (
                <div className="ip-access-notice danger">
                  <strong>Emergency bypass is active</strong>
                  <span>
                    IP enforcement is currently disabled by
                    IP_ALLOWLIST_BYPASS=1.
                  </span>
                </div>
              )}
              <div className="ip-access-grid">
                <label className="field">
                  <span>Allowed addresses and networks</span>
                  <textarea
                    className="textarea ip-access-editor mono"
                    value={draft.ipAllowlist.join("\n")}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        ipAllowlist: event.target.value.split(/\r?\n/),
                      })
                    }
                    placeholder={
                      "203.0.113.18\n10.20.0.0/16\n2001:db8:1234::/48"
                    }
                    spellCheck={false}
                  />
                  <small>
                    One IPv4 address, IPv6 address or CIDR network per line. Up
                    to 100 entries.
                  </small>
                </label>
                <div className="ip-access-current">
                  <span className="eyebrow">Detected source address</span>
                  <strong className="mono">
                    {data.environment.clientIp || "Unavailable"}
                  </strong>
                  <p>
                    Before activation, this address must match at least one
                    rule. The server checks it again when you save.
                  </p>
                </div>
              </div>
            </div>
          </section>
          <section className="card settings-wide-card">
            <div className="card-header">
              <div>
                <span className="eyebrow">Deployment posture</span>
                <h2>Runtime security</h2>
                <p>Read-only status derived from the current environment.</p>
              </div>
              <ShieldCheck />
            </div>
            <div className="card-body settings-status-grid">
              <div>
                <small>Public URL</small>
                <strong className="mono break-word">
                  {data.environment.publicUrl || "Direct host validation"}
                </strong>
              </div>
              <div>
                <small>Secure cookies</small>
                <strong>
                  {data.environment.secureCookies
                    ? "Enabled"
                    : "Local HTTP mode"}
                </strong>
              </div>
              <div>
                <small>Trusted proxy</small>
                <strong>
                  {data.environment.trustedProxy ? "Enabled" : "Disabled"}
                </strong>
              </div>
              <div>
                <small>Persistent storage</small>
                <strong>
                  {data.environment.database} · {data.environment.storage}
                </strong>
              </div>
              <div>
                <small>IP access enforcement</small>
                <strong>
                  {data.environment.ipAllowlistBypass
                    ? "Emergency bypass"
                    : draft.ipAllowlistEnabled
                      ? "Enabled"
                      : "Disabled"}
                </strong>
              </div>
            </div>
          </section>
          <div className="settings-actions settings-wide-card">
            <button className="button primary" disabled={busy}>
              {busy ? "Saving…" : "Save security & data settings"}
            </button>
          </div>
        </form>
      )}
    </>
  );
}
