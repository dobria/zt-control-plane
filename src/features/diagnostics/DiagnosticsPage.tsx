"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  ArrowRight,
  Cpu,
  Database,
  Network,
  Server,
  ShieldCheck,
  Wifi,
} from "lucide-react";
import { api } from "@/lib/client-api";
import { useAuth } from "@/shared/providers/AuthContext";
import { ControllerContext } from "@/shared/providers/ControllerContext";
import { useAutoRefresh } from "@/shared/hooks/useAutoRefresh";
import type { PublicController, PublicManagedNode } from "@/lib/types";

type JsonRecord = Record<string, unknown>;
type DiagnosticsResponse = {
  controller?: PublicController;
  node?: PublicManagedNode;
  diagnostics: JsonRecord;
};
type NodeDiagnosticsState = {
  diagnostics: JsonRecord | null;
  error: string | null;
  shared: boolean;
};

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function records(value: unknown): JsonRecord[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is JsonRecord =>
          Boolean(item) && typeof item === "object" && !Array.isArray(item),
      )
    : [];
}

function first(item: JsonRecord, ...keys: string[]) {
  for (const key of keys) {
    if (item[key] !== undefined && item[key] !== null && item[key] !== "")
      return item[key];
  }
  return undefined;
}

function display(value: unknown) {
  if (value === undefined || value === null || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) return value.map(String).join(", ") || "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function dateTime(value: unknown) {
  if (!value) return "—";
  const date = new Date(typeof value === "number" ? value : String(value));
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}

function relativeTime(value: unknown) {
  if (typeof value !== "number" || value <= 0) return "Never";
  const elapsed = Math.max(0, Date.now() - value);
  if (elapsed < 1_000) return "Just now";
  if (elapsed < 60_000) return `${Math.floor(elapsed / 1_000)}s ago`;
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)}m ago`;
  return dateTime(value);
}

function DetailGrid({
  items,
}: {
  items: Array<{ label: string; value: unknown; mono?: boolean }>;
}) {
  return (
    <dl className="diagnostic-details">
      {items.map((item) => (
        <div key={item.label}>
          <dt>{item.label}</dt>
          <dd className={item.mono ? "mono" : ""}>{display(item.value)}</dd>
        </div>
      ))}
    </dl>
  );
}

function ValueChips({ values }: { values: unknown[] }) {
  return values.length ? (
    <div className="value-chips">
      {values.map((value, index) => (
        <span className="value-chip mono" key={`${String(value)}-${index}`}>
          {display(value)}
        </span>
      ))}
    </div>
  ) : (
    <span className="muted-value">None reported</span>
  );
}

function ProviderTable({
  rows,
  columns,
  empty,
}: {
  rows: JsonRecord[];
  columns: Array<{ label: string; keys: string[]; mono?: boolean }>;
  empty: string;
}) {
  if (!rows.length) return <div className="empty-inline">{empty}</div>;
  return (
    <div className="table-wrap">
      <table className="table diagnostic-table">
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.label}>{column.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={String(first(row, ".id", "id", "address") || index)}>
              {columns.map((column) => (
                <td className={column.mono ? "mono" : ""} key={column.label}>
                  {display(first(row, ...column.keys))}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function normalizedEndpoint(value: string) {
  return value.replace(/\/+$/, "").toLowerCase();
}

function ManagedNodeHealth({
  controllerId,
  nodes,
  controllerDiagnostics,
  nodeDiagnostics,
}: {
  controllerId: string;
  nodes: PublicManagedNode[];
  controllerDiagnostics: JsonRecord;
  nodeDiagnostics: Record<string, NodeDiagnosticsState>;
}) {
  if (!nodes.length) return null;
  return (
    <section className="card diagnostic-node-section">
      <div className="card-header">
        <div>
          <span className="eyebrow">Client-side services</span>
          <h2>Managed node health</h2>
          <p>Nodes associated with the selected controller</p>
        </div>
        <Link
          className="button small"
          href={`/controllers/${controllerId}/nodes`}
        >
          Open node management <ArrowRight />
        </Link>
      </div>
      <div className="diagnostic-node-grid">
        {nodes.map((node) => {
          const result = nodeDiagnostics[node.id];
          const diagnostics = result?.shared
            ? controllerDiagnostics
            : result?.diagnostics || {};
          const status = record(diagnostics.status);
          const peers = records(diagnostics.peers);
          const networks = records(
            diagnostics.clientNetworks || diagnostics.interfaces,
          );
          const waiting = !result && node.enabled;
          const online =
            node.enabled &&
            !result?.error &&
            (status.online !== false || node.lastOnline !== false);
          const statusLabel = !node.enabled
            ? "Disabled"
            : waiting
              ? "Checking"
              : online
                ? "Online"
                : "Offline";
          const statusClass =
            !node.enabled || waiting ? "neutral" : online ? "" : "offline";
          return (
            <article className="diagnostic-node-card" key={node.id}>
              <div className="diagnostic-node-head">
                <span className={`diagnostic-node-icon ${node.type}`}>
                  <Cpu />
                </span>
                <span>
                  <strong>{node.name}</strong>
                  <small>
                    {result?.shared
                      ? "Shared controller endpoint"
                      : "Independent managed endpoint"}
                  </small>
                </span>
                <span className={`status-pill ${statusClass}`}>
                  {statusLabel}
                </span>
              </div>
              <dl className="diagnostic-node-metrics">
                <div>
                  <dt>Node ID</dt>
                  <dd className="mono">
                    {display(first(status, "address") || node.lastAddress)}
                  </dd>
                </div>
                <div>
                  <dt>Peers</dt>
                  <dd>{peers.length}</dd>
                </div>
                <div>
                  <dt>Joined networks</dt>
                  <dd>{networks.length}</dd>
                </div>
              </dl>
              {result?.error && (
                <div className="inline-error">{result.error}</div>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}

export function DiagnosticsPage() {
  const { activeController, nodes, settings: appSettings } = useAuth();
  const [data, setData] = useState<DiagnosticsResponse | null>(null);
  const [nodeDiagnostics, setNodeDiagnostics] = useState<
    Record<string, NodeDiagnosticsState>
  >({});
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const loadedRef = useRef(false);
  useEffect(() => {
    setData(null);
    setNodeDiagnostics({});
    loadedRef.current = false;
  }, [activeController?.id]);
  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!activeController) return;
      if (!loadedRef.current) setLoading(true);
      try {
        const controllerNodes = nodes.filter(
          (node) => node.controllerId === activeController.id,
        );
        const distinctNodes = controllerNodes.filter(
          (node) =>
            node.enabled &&
            normalizedEndpoint(node.baseUrl) !==
              normalizedEndpoint(activeController.baseUrl),
        );
        const results = await Promise.allSettled([
          api<DiagnosticsResponse>(
            `/api/controllers/${activeController.id}/diagnostics`,
            { signal },
          ),
          ...distinctNodes.map((node) =>
            api<DiagnosticsResponse>(`/api/nodes/${node.id}/diagnostics`, {
              signal,
            }),
          ),
        ]);
        if (signal?.aborted) return;
        const controllerResult = results[0];
        if (controllerResult.status === "rejected")
          throw controllerResult.reason;
        setData(controllerResult.value);
        const nextNodeDiagnostics: Record<string, NodeDiagnosticsState> = {};
        controllerNodes.forEach((node) => {
          const shared =
            normalizedEndpoint(node.baseUrl) ===
            normalizedEndpoint(activeController.baseUrl);
          if (shared)
            nextNodeDiagnostics[node.id] = {
              diagnostics: null,
              error: null,
              shared: true,
            };
        });
        distinctNodes.forEach((node, index) => {
          const result = results[index + 1];
          nextNodeDiagnostics[node.id] =
            result.status === "fulfilled"
              ? {
                  diagnostics: result.value.diagnostics,
                  error: null,
                  shared: false,
                }
              : {
                  diagnostics: null,
                  error:
                    result.reason instanceof Error
                      ? result.reason.message
                      : "Node diagnostics failed.",
                  shared: false,
                };
        });
        setNodeDiagnostics(nextNodeDiagnostics);
        setError("");
        loadedRef.current = true;
      } catch (caught) {
        if (signal?.aborted) return;
        setError(
          caught instanceof Error ? caught.message : "Diagnostics failed.",
        );
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [activeController, nodes],
  );
  useAutoRefresh(load, {
    intervalMs: appSettings.refreshSeconds * 1000,
    refreshKey: activeController?.id,
  });

  const diagnostics = data?.diagnostics || {};
  const status = record(diagnostics.status);
  const config = record(status.config);
  const settings = record(config.settings);
  const controllerStatus = record(diagnostics.controller);
  const peers = records(diagnostics.peers);
  const clientNetworks = records(
    diagnostics.clientNetworks || diagnostics.interfaces,
  );
  const instances = records(diagnostics.instances);
  const controllerNetworks = records(diagnostics.controllers);
  const members = records(diagnostics.members);
  const endpoint = data?.controller;
  const isMikroTik = endpoint?.type === "mikrotik";
  const isCentral =
    endpoint?.type === "central_v1" || endpoint?.type === "central_v2";
  const isOnline = status.online !== false && endpoint?.lastOnline !== false;
  const databaseReady =
    isMikroTik || isCentral ? true : controllerStatus.databaseReady === true;
  const controllerNodes = nodes.filter(
    (node) => node.controllerId === activeController?.id,
  );

  return (
    <div className="diagnostics-shell">
      <ControllerContext controller={activeController} section="Diagnostics" />
      <div className="page-heading">
        <div>
          <span className="eyebrow">Controller diagnostics</span>
          <h1>Diagnostics</h1>
          <p>
            Live service, network and connectivity health for{" "}
            {activeController?.name || "the selected controller"}.
          </p>
        </div>
      </div>
      {error && <div className="alert error">{error}</div>}
      {loading ? (
        <div className="metrics-grid">
          <div className="skeleton" />
          <div className="skeleton" />
          <div className="skeleton" />
          <div className="skeleton" />
        </div>
      ) : (
        data && (
          <div className="section-stack diagnostics-page">
            <div className="metrics-grid">
              <article className="metric-card">
                <span className="metric-icon sunset">
                  <Activity />
                </span>
                <span className="eyebrow">Controller service</span>
                <strong>{isOnline ? "Online" : "Offline"}</strong>
                <small>{endpoint?.name}</small>
              </article>
              <article className="metric-card">
                <span className="metric-icon dusk">
                  <Wifi />
                </span>
                <span className="eyebrow">Peers</span>
                <strong>{peers.length}</strong>
                <small>Known physical connections</small>
              </article>
              <article className="metric-card">
                <span className="metric-icon breeze">
                  <Network />
                </span>
                <span className="eyebrow">Client networks</span>
                <strong>{clientNetworks.length}</strong>
                <small>Joined interfaces</small>
              </article>
              <article className="metric-card">
                <span className="metric-icon twilight">
                  <Database />
                </span>
                <span className="eyebrow">Controller database</span>
                <strong>{databaseReady ? "Ready" : "Unavailable"}</strong>
                <small>
                  {isMikroTik
                    ? "Managed by RouterOS"
                    : isCentral
                      ? "Hosted by ZeroTier Central"
                      : "Embedded FileDB"}
                </small>
              </article>
            </div>

            <ManagedNodeHealth
              controllerId={activeController?.id || ""}
              nodes={controllerNodes}
              controllerDiagnostics={diagnostics}
              nodeDiagnostics={nodeDiagnostics}
            />

            <div className="grid two">
              <section className="card">
                <div className="card-header">
                  <div>
                    <span className="eyebrow">Node service</span>
                    <h2>Identity & runtime</h2>
                  </div>
                  <Server />
                </div>
                <div className="card-body">
                  <DetailGrid
                    items={[
                      {
                        label: "Node ID",
                        value:
                          first(status, "address") || endpoint?.lastAddress,
                        mono: true,
                      },
                      {
                        label: "Version",
                        value:
                          first(status, "version") || endpoint?.lastVersion,
                      },
                      { label: "Platform", value: status.platform },
                      {
                        label: "TCP fallback active",
                        value: status.tcpFallbackActive,
                      },
                      {
                        label: "Primary UDP port",
                        value: settings.primaryPort,
                      },
                      {
                        label: "Port mapping",
                        value: settings.portMappingEnabled,
                      },
                      {
                        label: "Planet world ID",
                        value: status.planetWorldId,
                      },
                      {
                        label: "Planet updated",
                        value: dateTime(status.planetWorldTimestamp),
                      },
                    ]}
                  />
                  {!isMikroTik && !isCentral && (
                    <div className="diagnostic-subsection">
                      <span className="eyebrow">Listening endpoints</span>
                      <ValueChips
                        values={
                          Array.isArray(settings.listeningOn)
                            ? settings.listeningOn
                            : []
                        }
                      />
                    </div>
                  )}
                </div>
              </section>

              <section className="card">
                <div className="card-header">
                  <div>
                    <span className="eyebrow">Management endpoint</span>
                    <h2>Controller connection</h2>
                  </div>
                  <ShieldCheck />
                </div>
                <div className="card-body">
                  <DetailGrid
                    items={[
                      { label: "Name", value: endpoint?.name },
                      { label: "Provider", value: endpoint?.type },
                      { label: "Base URL", value: endpoint?.baseUrl },
                      { label: "Enabled", value: endpoint?.enabled },
                      {
                        label: "TLS verification",
                        value: endpoint?.tlsVerify,
                      },
                      {
                        label: "Controller API",
                        value: isMikroTik
                          ? "RouterOS REST"
                          : controllerStatus.apiVersion,
                      },
                      {
                        label: "Database ready",
                        value: databaseReady,
                      },
                      {
                        label: "Last registry check",
                        value: dateTime(endpoint?.lastCheckedAt),
                      },
                    ]}
                  />
                  <div className="diagnostic-subsection">
                    <span className="eyebrow">Available operations</span>
                    <ValueChips
                      values={Object.entries(endpoint?.capabilities || {})
                        .filter(([, available]) => available)
                        .map(([name]) => name)}
                    />
                  </div>
                </div>
              </section>
            </div>

            {!isMikroTik && !isCentral && (
              <>
                <section className="card">
                  <div className="card-header">
                    <div>
                      <span className="eyebrow">Physical topology</span>
                      <h2>Peer connections</h2>
                      <p>
                        Direct and relayed paths currently known to the node
                      </p>
                    </div>
                  </div>
                  {peers.length ? (
                    <div className="table-wrap">
                      <table className="table diagnostic-table">
                        <thead>
                          <tr>
                            <th>Peer</th>
                            <th>Role</th>
                            <th>Version</th>
                            <th>Latency</th>
                            <th>Connection</th>
                            <th>Active endpoint</th>
                            <th>Last receive</th>
                          </tr>
                        </thead>
                        <tbody>
                          {peers.map((peer) => {
                            const paths = records(peer.paths);
                            const activePath =
                              paths.find((path) => path.active) || paths[0];
                            return (
                              <tr key={String(peer.address)}>
                                <td className="mono">
                                  {display(peer.address)}
                                </td>
                                <td>{display(peer.role)}</td>
                                <td>{display(peer.version)}</td>
                                <td>
                                  {typeof peer.latency === "number" &&
                                  peer.latency >= 0
                                    ? `${peer.latency} ms`
                                    : "—"}
                                </td>
                                <td>
                                  <span
                                    className={`status-pill ${activePath ? "" : "neutral"}`}
                                  >
                                    {activePath ? "Direct" : "Relayed"}
                                  </span>
                                </td>
                                <td className="mono">
                                  {display(activePath?.address)}
                                </td>
                                <td>{relativeTime(activePath?.lastReceive)}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="empty-inline">No peers reported.</div>
                  )}
                </section>

                <section className="card">
                  <div className="card-header">
                    <div>
                      <span className="eyebrow">Client mode</span>
                      <h2>Joined network interfaces</h2>
                    </div>
                  </div>
                  <ProviderTable
                    rows={clientNetworks}
                    empty="This node has not joined any networks."
                    columns={[
                      { label: "Network", keys: ["name", "id"] },
                      { label: "Network ID", keys: ["id", "nwid"], mono: true },
                      { label: "Status", keys: ["status"] },
                      { label: "Type", keys: ["type"] },
                      {
                        label: "Interface",
                        keys: ["portDeviceName", "name"],
                        mono: true,
                      },
                      {
                        label: "Addresses",
                        keys: ["assignedAddresses"],
                        mono: true,
                      },
                    ]}
                  />
                </section>
              </>
            )}

            {isMikroTik && (
              <>
                <section className="card">
                  <div className="card-header">
                    <div>
                      <span className="eyebrow">RouterOS node</span>
                      <h2>ZeroTier instances</h2>
                    </div>
                  </div>
                  <ProviderTable
                    rows={instances}
                    empty="No ZeroTier instances reported by RouterOS."
                    columns={[
                      { label: "Name", keys: ["name"] },
                      {
                        label: "Node ID",
                        keys: ["identity.address", "identity-address"],
                        mono: true,
                      },
                      { label: "Port", keys: ["port"] },
                      {
                        label: "Interfaces",
                        keys: ["interfaces", "interface"],
                      },
                      { label: "State", keys: ["state"] },
                      { label: "Disabled", keys: ["disabled"] },
                    ]}
                  />
                </section>
                <section className="card">
                  <div className="card-header">
                    <div>
                      <span className="eyebrow">RouterOS interfaces</span>
                      <h2>Client networks</h2>
                    </div>
                  </div>
                  <ProviderTable
                    rows={clientNetworks}
                    empty="No RouterOS ZeroTier interfaces configured."
                    columns={[
                      { label: "Name", keys: ["name"] },
                      { label: "Instance", keys: ["instance"] },
                      { label: "Network ID", keys: ["network"], mono: true },
                      { label: "Status", keys: ["status", "running"] },
                      { label: "VRF", keys: ["vrf"] },
                      {
                        label: "MTU",
                        keys: ["actual-mtu", "mtu"],
                      },
                      { label: "ARP timeout", keys: ["arp-timeout"] },
                      { label: "MAC", keys: ["mac-address"], mono: true },
                      { label: "Managed routes", keys: ["allow-managed"] },
                    ]}
                  />
                </section>
                <div className="grid two">
                  <section className="card">
                    <div className="card-header">
                      <div>
                        <span className="eyebrow">Hosted networks</span>
                        <h2>RouterOS controllers</h2>
                      </div>
                    </div>
                    <ProviderTable
                      rows={controllerNetworks}
                      empty="No controller networks hosted on this router."
                      columns={[
                        { label: "Name", keys: ["name"] },
                        {
                          label: "Network ID",
                          keys: ["network", "nwid"],
                          mono: true,
                        },
                        { label: "Instance", keys: ["instance"] },
                        { label: "Private", keys: ["private"] },
                      ]}
                    />
                  </section>
                  <section className="card">
                    <div className="card-header">
                      <div>
                        <span className="eyebrow">Controller members</span>
                        <h2>Known devices</h2>
                      </div>
                    </div>
                    <ProviderTable
                      rows={members}
                      empty="No RouterOS controller members reported."
                      columns={[
                        {
                          label: "Node ID",
                          keys: ["zt-address", "address"],
                          mono: true,
                        },
                        { label: "Network", keys: ["network"] },
                        { label: "Authorized", keys: ["authorized"] },
                        { label: "Last seen", keys: ["last-seen"] },
                      ]}
                    />
                  </section>
                </div>
                <section className="card">
                  <div className="card-header">
                    <div>
                      <span className="eyebrow">Physical topology</span>
                      <h2>RouterOS ZeroTier peers</h2>
                    </div>
                  </div>
                  <ProviderTable
                    rows={peers}
                    empty="No RouterOS ZeroTier peers reported."
                    columns={[
                      { label: "Instance", keys: ["instance"] },
                      {
                        label: "ZeroTier address",
                        keys: ["zt-address", "address"],
                        mono: true,
                      },
                      { label: "Role", keys: ["role"] },
                      { label: "Latency", keys: ["latency"] },
                      { label: "Path", keys: ["path"], mono: true },
                    ]}
                  />
                </section>
              </>
            )}

            <details className="advanced-disclosure diagnostics-raw">
              <summary>Raw provider response</summary>
              <div className="grid two raw-response-grid">
                <div>
                  <span className="eyebrow">Diagnostics payload</span>
                  <pre className="diagnostics-json">
                    {JSON.stringify(diagnostics, null, 2)}
                  </pre>
                </div>
                <div>
                  <span className="eyebrow">Controller registry record</span>
                  <pre className="diagnostics-json">
                    {JSON.stringify(endpoint, null, 2)}
                  </pre>
                </div>
              </div>
            </details>
          </div>
        )
      )}
    </div>
  );
}
