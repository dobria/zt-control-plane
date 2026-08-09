"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Network,
  Plus,
  Radio,
  ServerCog,
} from "lucide-react";
import { api } from "@/lib/client-api";
import { useAuth } from "@/shared/providers/AuthContext";
import { useAutoRefresh } from "@/shared/hooks/useAutoRefresh";
import {
  ControllerFleet,
  ControllerTopology,
} from "@/features/overview/OverviewVisualizations";
import type { AuditEntry, OverviewSnapshot } from "@/lib/types";

function timeLabel(timestamp: number) {
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  return `${Math.round(seconds / 60)}m ago`;
}

function actionLabel(action: string) {
  return action.replaceAll(".", " ");
}

export function Dashboard() {
  const auth = useAuth();
  const [snapshot, setSnapshot] = useState<OverviewSnapshot | null>(null);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [switching, setSwitching] = useState(false);
  const loaded = useRef(false);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!loaded.current) setLoading(true);
      try {
        const overview = await api<OverviewSnapshot>("/api/overview", {
          signal,
        });
        if (signal?.aborted) return;
        setSnapshot(overview);
        if (auth.permissions.canViewAudit) {
          try {
            const result = await api<{ entries: AuditEntry[] }>(
              "/api/audit?limit=8",
              { signal },
            );
            if (signal?.aborted) return;
            setAudit(result.entries);
          } catch {
            if (!signal?.aborted) setAudit([]);
          }
        }
        if (signal?.aborted) return;
        setError("");
        loaded.current = true;
      } catch (caught) {
        if (signal?.aborted) return;
        setError(
          caught instanceof Error
            ? caught.message
            : "Unable to load the control plane overview.",
        );
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [auth.permissions.canViewAudit],
  );

  useAutoRefresh(load, {
    intervalMs: auth.settings.refreshSeconds * 1000,
    refreshKey: auth.controllers
      .map((controller) => `${controller.id}:${controller.updatedAt}`)
      .join("|"),
  });

  useEffect(() => {
    if (!snapshot?.controllers.length) return;
    setSelectedId((current) => {
      if (snapshot.controllers.some((controller) => controller.id === current))
        return current;
      if (
        auth.activeController &&
        snapshot.controllers.some(
          (controller) => controller.id === auth.activeController?.id,
        )
      )
        return auth.activeController.id;
      return snapshot.controllers[0].id;
    });
  }, [auth.activeController, snapshot]);

  const selected = snapshot?.controllers.find(
    (controller) => controller.id === selectedId,
  );
  const issues =
    snapshot?.controllers.filter(
      (controller) => controller.enabled && controller.health !== "online",
    ) || [];
  const networks = useMemo(
    () =>
      (snapshot?.controllers || [])
        .flatMap((controller) =>
          controller.networks.map((network) => ({ controller, network })),
        )
        .sort((a, b) => b.network.memberCount - a.network.memberCount),
    [snapshot],
  );

  async function makeActive(controllerId: string) {
    setSwitching(true);
    try {
      await auth.activateController(controllerId);
      setError("");
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Unable to change the active controller.",
      );
    } finally {
      setSwitching(false);
    }
  }

  return (
    <>
      <div className="page-heading overview-heading">
        <div>
          <span className="eyebrow">Global operational view</span>
          <h1>Overview</h1>
          <p>
            Live health, networks and members across every registered
            controller.
          </p>
        </div>
        <div className="overview-heading-actions">
          {auth.permissions.canManageControllers && (
            <Link className="button primary" href="/controllers?add=true">
              <Plus /> Add controller
            </Link>
          )}
        </div>
      </div>

      {error && <div className="alert error">{error}</div>}

      <section className="metrics-grid overview-metrics">
        <article className="metric-card compact">
          <span className="metric-icon sunset">
            <ServerCog />
          </span>
          <span className="eyebrow">Controllers</span>
          <strong>{snapshot?.totals.controllers ?? "—"}</strong>
          <small>
            {snapshot
              ? `${snapshot.totals.onlineControllers} online · ${snapshot.totals.enabledControllers} enabled`
              : "Loading controller fleet"}
          </small>
        </article>
        <article className="metric-card compact">
          <span className="metric-icon dusk">
            <Network />
          </span>
          <span className="eyebrow">Networks</span>
          <strong>{snapshot?.totals.networks ?? "—"}</strong>
          <small>Across all connected controllers</small>
        </article>
        <article className="metric-card compact">
          <span className="metric-icon twilight">
            <Radio />
          </span>
          <span className="eyebrow">Members</span>
          <strong>{snapshot?.totals.members ?? "—"}</strong>
          <small>Registered network members</small>
        </article>
        <article className="metric-card compact">
          <span className="metric-icon breeze">
            {snapshot?.totals.issues ? <AlertTriangle /> : <CheckCircle2 />}
          </span>
          <span className="eyebrow">Attention</span>
          <strong>{snapshot?.totals.issues ?? "—"}</strong>
          <small>
            {snapshot?.totals.issues
              ? "Controllers need attention"
              : `${snapshot?.totals.managedNodes ?? 0} managed nodes`}
          </small>
        </article>
      </section>

      {loading && !snapshot ? (
        <div className="overview-visual-grid">
          <div className="card skeleton overview-visual-skeleton" />
          <div className="card skeleton overview-visual-skeleton" />
        </div>
      ) : (
        <div className="overview-visual-grid">
          <ControllerFleet
            controllers={snapshot?.controllers || []}
            selectedId={selectedId}
            activeId={auth.activeController?.id}
            switching={switching}
            onSelect={setSelectedId}
            onActivate={(controllerId) => void makeActive(controllerId)}
          />
          <ControllerTopology controller={selected} />
        </div>
      )}

      <div className="grid two overview-secondary-grid">
        <section className="card">
          <div className="card-header">
            <div>
              <span className="eyebrow">Health and connectivity</span>
              <h2>Needs attention</h2>
              <p>Controller problems that may affect management</p>
            </div>
            <AlertTriangle />
          </div>
          <div className="card-body quick-stack">
            {issues.length ? (
              issues.slice(0, 6).map((controller) => (
                <button
                  type="button"
                  className="quick-link attention-link"
                  key={controller.id}
                  onClick={() => setSelectedId(controller.id)}
                >
                  <span>
                    <strong>{controller.name}</strong>
                    <small>
                      {controller.error || "Connectivity is degraded"}
                    </small>
                  </span>
                  <span className={`status-pill ${controller.health}`}>
                    {controller.health}
                  </span>
                </button>
              ))
            ) : (
              <div className="healthy-empty">
                <CheckCircle2 />
                <span>
                  <strong>All enabled controllers are healthy</strong>
                  <small>No connectivity problems detected.</small>
                </span>
              </div>
            )}
          </div>
        </section>

        <section className="card">
          <div className="card-header">
            <div>
              <span className="eyebrow">
                {auth.permissions.canViewAudit
                  ? "Across the workspace"
                  : "Registered endpoints"}
              </span>
              <h2>
                {auth.permissions.canViewAudit
                  ? "Recent activity"
                  : "Controller inventory"}
              </h2>
              <p>
                {auth.permissions.canViewAudit
                  ? "Latest control-plane mutations"
                  : "Status across every controller"}
              </p>
            </div>
            <Activity />
          </div>
          <div className="card-body quick-stack">
            {auth.permissions.canViewAudit
              ? audit.slice(0, 6).map((entry) => (
                  <Link className="quick-link" href="/audit" key={entry.id}>
                    <span>
                      <strong className="capitalize">
                        {actionLabel(entry.action)}
                      </strong>
                      <small>
                        {entry.controllerName || entry.nodeName || "Workspace"}{" "}
                        · {entry.userEmail || "System"}
                      </small>
                    </span>
                    <span>
                      {timeLabel(entry.timestamp)} <ArrowRight />
                    </span>
                  </Link>
                ))
              : snapshot?.controllers.slice(0, 6).map((controller) => (
                  <button
                    type="button"
                    className="quick-link attention-link"
                    key={controller.id}
                    onClick={() => setSelectedId(controller.id)}
                  >
                    <span>
                      <strong>{controller.name}</strong>
                      <small>
                        {controller.networks.length} networks ·{" "}
                        {controller.networks.reduce(
                          (sum, network) => sum + network.memberCount,
                          0,
                        )}{" "}
                        members
                      </small>
                    </span>
                    <span className={`status-pill ${controller.health}`}>
                      {controller.health}
                    </span>
                  </button>
                ))}
            {auth.permissions.canViewAudit && !audit.length && (
              <div className="empty-inline">No recent activity.</div>
            )}
          </div>
        </section>
      </div>

      <section className="card overview-inventory">
        <div className="card-header">
          <div>
            <span className="eyebrow">Cross-controller inventory</span>
            <h2>Largest networks</h2>
            <p>Direct navigation to the busiest managed networks</p>
          </div>
        </div>
        {networks.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Network</th>
                  <th>Controller</th>
                  <th>Visibility</th>
                  <th>Routes</th>
                  <th>Members</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {networks.slice(0, 10).map(({ controller, network }) => (
                  <tr key={`${controller.id}-${network.id}`}>
                    <td>
                      <strong>{network.name}</strong>
                      <code className="table-subline">{network.id}</code>
                    </td>
                    <td>{controller.name}</td>
                    <td>{network.private ? "Private" : "Public"}</td>
                    <td>{network.routeCount}</td>
                    <td>{network.memberCount}</td>
                    <td className="table-action-cell">
                      <Link
                        className="icon-button"
                        href={`/networks/${controller.id}/${network.id}`}
                        aria-label={`Open ${network.name}`}
                      >
                        <ArrowRight />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-state compact-empty">
            <Network />
            <h2>No networks discovered</h2>
          </div>
        )}
      </section>
    </>
  );
}
