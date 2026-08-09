"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import {
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  Cpu,
  FilterX,
  Network,
  Search,
  ServerCog,
} from "lucide-react";
import { api } from "@/lib/client-api";
import { useAuth } from "@/shared/providers/AuthContext";
import { useAutoRefresh } from "@/shared/hooks/useAutoRefresh";
import type {
  ManagedEndpointInventoryItem,
  NodeInventoryIdentity,
  NodeInventorySnapshot,
} from "@/lib/types";

type InventoryView = "identities" | "endpoints";

function statusOf(item: NodeInventoryIdentity) {
  if (item.stale) return "stale";
  if (item.online === true) return "online";
  if (item.online === false) return "offline";
  return "unknown";
}

function endpointStatus(item: ManagedEndpointInventoryItem) {
  if (!item.enabled) return "disabled";
  if (item.stale) return "stale";
  if (item.online === true) return "online";
  if (item.online === false) return "offline";
  return "unknown";
}

export function NodesPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { controllers, settings } = useAuth();
  const [inventory, setInventory] = useState<NodeInventorySnapshot | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const view = (
    searchParams.get("view") === "endpoints" ? "endpoints" : "identities"
  ) as InventoryView;
  const query = searchParams.get("q") || "";
  const controllerFilter = searchParams.get("controller") || "all";
  const managementFilter = searchParams.get("management") || "all";
  const authorizationFilter = searchParams.get("authorization") || "all";
  const stateFilter = searchParams.get("state") || "all";
  const page = Math.max(1, Number(searchParams.get("page") || 1));
  const pageSize = Math.max(
    20,
    Math.min(100, Number(searchParams.get("pageSize") || 25)),
  );

  function replaceFilters(changes: Record<string, string | null>) {
    const next = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(changes)) {
      if (
        !value ||
        value === "all" ||
        (key === "view" && value === "identities") ||
        (key === "page" && value === "1")
      )
        next.delete(key);
      else next.set(key, value);
    }
    router.replace(`/nodes${next.size ? `?${next}` : ""}`, { scroll: false });
  }

  const load = useCallback(async (silent = false, signal?: AbortSignal) => {
    if (!silent) setLoading(true);
    setError("");
    try {
      const result = await api<NodeInventorySnapshot>(
        `/api/inventory/nodes${silent ? "" : "?refresh=1"}`,
        { signal },
      );
      if (!signal?.aborted) setInventory(result);
    } catch (caught) {
      if (!signal?.aborted)
        setError(
          caught instanceof Error ? caught.message : "Unable to load nodes.",
        );
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useAutoRefresh(async (signal) => load(true, signal), {
    intervalMs: settings.refreshSeconds * 1000,
    refreshKey: "global-node-inventory",
  });

  const identities = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (inventory?.identities || [])
      .filter((identity) => {
        if (controllerFilter === "all") return true;
        return identity.memberships.some(
          (membership) => membership.controllerId === controllerFilter,
        );
      })
      .filter((identity) => {
        if (managementFilter === "managed") return identity.managed;
        if (managementFilter === "member") return !identity.managed;
        return true;
      })
      .filter((identity) => {
        if (authorizationFilter === "authorized")
          return identity.authorizedMemberships > 0;
        if (authorizationFilter === "pending")
          return identity.pendingMemberships > 0;
        return true;
      })
      .filter(
        (identity) =>
          stateFilter === "all" || statusOf(identity) === stateFilter,
      )
      .filter((identity) => {
        if (!needle) return true;
        return `${identity.name} ${identity.address || ""} ${identity.memberships
          .map(
            (membership) =>
              `${membership.member.name} ${membership.controllerName} ${membership.networkName} ${membership.networkId}`,
          )
          .join(" ")}`
          .toLowerCase()
          .includes(needle);
      })
      .sort(
        (left, right) =>
          Number(right.pendingMemberships > 0) -
            Number(left.pendingMemberships > 0) ||
          left.name.localeCompare(right.name),
      );
  }, [
    authorizationFilter,
    controllerFilter,
    inventory?.identities,
    managementFilter,
    query,
    stateFilter,
  ]);

  const endpoints = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (inventory?.endpoints || [])
      .filter(
        (endpoint) =>
          controllerFilter === "all" ||
          endpoint.controllerId === controllerFilter,
      )
      .filter(
        (endpoint) =>
          stateFilter === "all" || endpointStatus(endpoint) === stateFilter,
      )
      .filter((endpoint) => {
        if (!needle) return true;
        return `${endpoint.name} ${endpoint.address || ""} ${endpoint.controllerName || ""} ${endpoint.type} ${endpoint.instances
          .map((instance) => `${instance.name} ${instance.address || ""}`)
          .join(" ")}`
          .toLowerCase()
          .includes(needle);
      })
      .sort((left, right) => left.name.localeCompare(right.name));
  }, [controllerFilter, inventory?.endpoints, query, stateFilter]);

  const results = view === "identities" ? identities : endpoints;
  const totalPages = Math.max(1, Math.ceil(results.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const visible = results.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize,
  );
  const filtersActive =
    Boolean(query) ||
    controllerFilter !== "all" ||
    managementFilter !== "all" ||
    authorizationFilter !== "all" ||
    stateFilter !== "all";

  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">Cross-controller inventory</span>
          <h1>Nodes</h1>
          <p>
            Search ZeroTier identities across memberships and distinguish them
            from endpoints this control plane can manage directly.
          </p>
        </div>
        <div className="segmented-control" aria-label="Node inventory view">
          <button
            className={view === "identities" ? "active" : ""}
            onClick={() => replaceFilters({ view: "identities", page: "1" })}
          >
            Network nodes
          </button>
          <button
            className={view === "endpoints" ? "active" : ""}
            onClick={() => replaceFilters({ view: "endpoints", page: "1" })}
          >
            Managed endpoints
          </button>
        </div>
      </div>
      {error && <div className="alert error">{error}</div>}

      <section className="card inventory-filter-card">
        <div className="card-header">
          <div>
            <span className="eyebrow">Fleet scope</span>
            <h2>
              {results.length.toLocaleString()}{" "}
              {view === "identities" ? "nodes" : "endpoints"}
            </h2>
            <p>
              Membership discovery is read-only here; direct actions remain in
              each controller workspace.
            </p>
          </div>
          {filtersActive && (
            <button
              className="button small"
              onClick={() =>
                router.replace(
                  view === "endpoints" ? "/nodes?view=endpoints" : "/nodes",
                  {
                    scroll: false,
                  },
                )
              }
            >
              <FilterX /> Clear filters
            </button>
          )}
        </div>
        <div className="card-body inventory-filters node-inventory-filters">
          <label className="field inventory-search">
            <span>Search</span>
            <div className="input-with-icon">
              <Search />
              <input
                className="input"
                placeholder="Name, Node ID, network, controller…"
                value={query}
                onChange={(event) =>
                  replaceFilters({ q: event.target.value || null, page: "1" })
                }
              />
            </div>
          </label>
          <label className="field">
            <span>Controller</span>
            <select
              className="select"
              value={controllerFilter}
              onChange={(event) =>
                replaceFilters({ controller: event.target.value, page: "1" })
              }
            >
              <option value="all">All controllers</option>
              {controllers.map((controller) => (
                <option key={controller.id} value={controller.id}>
                  {controller.name}
                </option>
              ))}
            </select>
          </label>
          {view === "identities" && (
            <>
              <label className="field">
                <span>Management</span>
                <select
                  className="select"
                  value={managementFilter}
                  onChange={(event) =>
                    replaceFilters({
                      management: event.target.value,
                      page: "1",
                    })
                  }
                >
                  <option value="all">All nodes</option>
                  <option value="managed">Managed directly</option>
                  <option value="member">Membership only</option>
                </select>
              </label>
              <label className="field">
                <span>Authorization</span>
                <select
                  className="select"
                  value={authorizationFilter}
                  onChange={(event) =>
                    replaceFilters({
                      authorization: event.target.value,
                      page: "1",
                    })
                  }
                >
                  <option value="all">Any authorization</option>
                  <option value="authorized">Authorized</option>
                  <option value="pending">Pending approval</option>
                </select>
              </label>
            </>
          )}
          <label className="field">
            <span>State</span>
            <select
              className="select"
              value={stateFilter}
              onChange={(event) =>
                replaceFilters({ state: event.target.value, page: "1" })
              }
            >
              <option value="all">All states</option>
              <option value="online">Online</option>
              <option value="offline">Offline</option>
              <option value="stale">Cached / stale</option>
              <option value="unknown">Unknown</option>
              {view === "endpoints" && (
                <option value="disabled">Disabled</option>
              )}
            </select>
          </label>
        </div>
      </section>

      {inventory?.controllers.some((controller) => controller.error) && (
        <section
          className="inventory-health-strip"
          aria-label="Controller synchronization state"
        >
          {inventory.controllers
            .filter((controller) => controller.error)
            .map((controller) => (
              <div
                key={controller.id}
                className={controller.stale ? "stale" : "offline"}
              >
                <strong>{controller.name}</strong>
                <span>
                  {controller.stale
                    ? "Using cached discovery"
                    : controller.error}
                </span>
              </div>
            ))}
        </section>
      )}

      <section className="card inventory-results-card">
        <div className="card-header">
          <div>
            <span className="eyebrow">
              {view === "identities" ? "Identity index" : "Endpoint index"}
            </span>
            <h2>{results.length.toLocaleString()} matching results</h2>
          </div>
        </div>
        <div className="card-body flush-card-body">
          {loading ? (
            <div className="inventory-skeletons">
              <div className="skeleton" />
              <div className="skeleton" />
              <div className="skeleton" />
            </div>
          ) : visible.length ? (
            <div className="table-wrap">
              {view === "identities" ? (
                <table className="table inventory-table node-inventory-table">
                  <thead>
                    <tr>
                      <th>Node</th>
                      <th>Management</th>
                      <th>Controllers</th>
                      <th>Networks</th>
                      <th>Authorization</th>
                      <th>State</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(visible as NodeInventoryIdentity[]).map((identity) => (
                      <tr key={identity.id}>
                        <td>
                          <strong>{identity.name}</strong>
                          <code>{identity.address || identity.id}</code>
                          {identity.memberships.length > 0 && (
                            <details className="membership-details">
                              <summary>Show memberships</summary>
                              <div>
                                {identity.memberships.map((membership) => (
                                  <Link
                                    key={`${membership.controllerId}:${membership.networkId}`}
                                    href={`/networks/${encodeURIComponent(membership.controllerId)}/${encodeURIComponent(membership.networkId)}`}
                                  >
                                    <span>{membership.networkName}</span>
                                    <small>{membership.controllerName}</small>
                                  </Link>
                                ))}
                              </div>
                            </details>
                          )}
                        </td>
                        <td>
                          <span
                            className={`status-pill ${identity.managed ? "" : "neutral"}`}
                          >
                            {identity.managed ? "Direct" : "Member only"}
                          </span>
                        </td>
                        <td>{identity.controllerCount}</td>
                        <td>{identity.networkCount}</td>
                        <td>
                          {identity.authorizedMemberships} authorized
                          {identity.pendingMemberships > 0 && (
                            <small className="table-secondary pending-text">
                              {identity.pendingMemberships} pending
                            </small>
                          )}
                        </td>
                        <td>
                          <span
                            className={`status-pill ${statusOf(identity) === "offline" ? "offline" : statusOf(identity) === "online" ? "" : "neutral"}`}
                          >
                            {statusOf(identity)}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <table className="table inventory-table">
                  <thead>
                    <tr>
                      <th>Endpoint</th>
                      <th>Controller</th>
                      <th>Type</th>
                      <th>Instances</th>
                      <th>Joined networks</th>
                      <th>State</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {(visible as ManagedEndpointInventoryItem[]).map(
                      (endpoint) => (
                        <tr key={endpoint.id}>
                          <td>
                            <strong>{endpoint.name}</strong>
                            <code>
                              {endpoint.address || "Identity unavailable"}
                            </code>
                            {endpoint.version && (
                              <small className="table-secondary">
                                ZeroTier {endpoint.version}
                              </small>
                            )}
                          </td>
                          <td>{endpoint.controllerName || "Independent"}</td>
                          <td>{endpoint.type.replaceAll("_", " ")}</td>
                          <td>
                            {endpoint.instances.length ||
                              (endpoint.type === "mikrotik" ? 0 : "—")}
                          </td>
                          <td>{endpoint.joinedNetworks.length}</td>
                          <td>
                            <span
                              className={`status-pill ${endpointStatus(endpoint) === "offline" ? "offline" : endpointStatus(endpoint) === "online" ? "" : endpointStatus(endpoint) === "disabled" ? "disabled" : "neutral"}`}
                            >
                              {endpointStatus(endpoint)}
                            </span>
                          </td>
                          <td>
                            {endpoint.controllerId ? (
                              <Link
                                className="button small"
                                href={`/controllers/${encodeURIComponent(endpoint.controllerId)}/nodes`}
                              >
                                Manage <ArrowRight />
                              </Link>
                            ) : (
                              <span className="table-secondary">
                                No controller scope
                              </span>
                            )}
                          </td>
                        </tr>
                      ),
                    )}
                  </tbody>
                </table>
              )}
            </div>
          ) : (
            <div className="empty-state">
              <span className="empty-icon">
                {view === "identities" ? <Network /> : <Cpu />}
              </span>
              <h2>
                No matching {view === "identities" ? "nodes" : "endpoints"}
              </h2>
              <p>
                Adjust the inventory filters or check controller connectivity.
              </p>
            </div>
          )}
        </div>
        {!loading && results.length > 0 && (
          <div className="inventory-pagination">
            <label>
              <span>Rows</span>
              <select
                className="select"
                value={pageSize}
                onChange={(event) =>
                  replaceFilters({ pageSize: event.target.value, page: "1" })
                }
              >
                <option value="25">25</option>
                <option value="50">50</option>
                <option value="100">100</option>
              </select>
            </label>
            <span>
              {(currentPage - 1) * pageSize + 1}–
              {Math.min(currentPage * pageSize, results.length)} of{" "}
              {results.length}
            </span>
            <div className="actions">
              <button
                className="icon-button"
                disabled={currentPage <= 1}
                onClick={() =>
                  replaceFilters({ page: String(currentPage - 1) })
                }
                aria-label="Previous page"
              >
                <ChevronLeft />
              </button>
              <span>
                Page {currentPage} of {totalPages}
              </span>
              <button
                className="icon-button"
                disabled={currentPage >= totalPages}
                onClick={() =>
                  replaceFilters({ page: String(currentPage + 1) })
                }
                aria-label="Next page"
              >
                <ChevronRight />
              </button>
            </div>
          </div>
        )}
      </section>

      <section className="inventory-guidance">
        <ServerCog />
        <div>
          <strong>Need to change a node?</strong>
          <span>
            Open its controller workspace for client settings, RouterOS
            instances, peers and moons. Membership authorization stays inside
            the corresponding network.
          </span>
        </div>
      </section>
    </>
  );
}
