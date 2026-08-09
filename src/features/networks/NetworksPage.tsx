"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo, useRef, useState, type FormEvent } from "react";
import {
  ArrowRight,
  Check,
  ChevronLeft,
  ChevronRight,
  Download,
  FilterX,
  Network,
  Plus,
  RefreshCw,
  Search,
  Upload,
  X,
} from "lucide-react";
import { api, jsonRequest } from "@/lib/client-api";
import { useAuth } from "@/shared/providers/AuthContext";
import { ControllerTarget } from "@/shared/providers/ControllerContext";
import { useAutoRefresh } from "@/shared/hooks/useAutoRefresh";
import { useDialog } from "@/shared/hooks/useDialog";
import { generatedSubnet } from "@/features/networks/network-detail/model";
import type {
  AdapterCapabilities,
  ManagedNetwork,
  NetworkInventorySnapshot,
  RouterOsZeroTierInstance,
} from "@/lib/types";

interface RestoreResult {
  sourceNetworkId: string;
  restoredNetworkId: string | null;
  operation: "create" | "update";
  ok: boolean;
  error: string | null;
  members: Array<{ memberId: string; ok: boolean; error: string | null }>;
}

export function NetworksPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { activeController, controllers, permissions, settings } = useAuth();
  const [inventory, setInventory] = useState<NetworkInventorySnapshot | null>(
    null,
  );
  const [capabilities, setCapabilities] = useState<AdapterCapabilities | null>(
    null,
  );
  const [instances, setInstances] = useState<RouterOsZeroTierInstance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [open, setOpen] = useState(false);
  const [subnet, setSubnet] = useState(generatedSubnet);
  const [busy, setBusy] = useState(false);
  const [targetControllerId, setTargetControllerId] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const [restore, setRestore] = useState<{
    backup: Record<string, unknown>;
    plan: Array<{
      networkId: string;
      name: string;
      operation: string;
      members: number;
    }>;
    results?: RestoreResult[];
  } | null>(null);
  const createDialog = useDialog<HTMLFormElement>(
    open,
    () => setOpen(false),
    busy,
  );
  const restoreDialog = useDialog<HTMLElement>(
    Boolean(restore),
    () => setRestore(null),
    busy,
  );
  const controllerFilter = searchParams.get("controller") || "all";
  const query = searchParams.get("q") || "";
  const accessFilter = searchParams.get("access") || "all";
  const stateFilter = searchParams.get("state") || "all";
  const sort = searchParams.get("sort") || "name";
  const page = Math.max(1, Number(searchParams.get("page") || 1));
  const pageSize = Math.max(
    12,
    Math.min(96, Number(searchParams.get("pageSize") || 24)),
  );
  const scopeController = controllers.find(
    (controller) => controller.id === controllerFilter,
  );
  const targetController = controllers.find(
    (controller) => controller.id === targetControllerId,
  );

  function replaceFilters(changes: Record<string, string | null>) {
    const next = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(changes)) {
      if (!value || value === "all" || (key === "page" && value === "1"))
        next.delete(key);
      else next.set(key, value);
    }
    router.replace(`/networks${next.size ? `?${next}` : ""}`, {
      scroll: false,
    });
  }
  const load = useCallback(async (silent = false, signal?: AbortSignal) => {
    if (!silent) setLoading(true);
    setError("");
    try {
      const result = await api<NetworkInventorySnapshot>(
        `/api/inventory/networks${silent ? "" : "?refresh=1"}`,
        { signal },
      );
      if (signal?.aborted) return;
      setInventory(result);
    } catch (caught) {
      if (signal?.aborted) return;
      setError(
        caught instanceof Error ? caught.message : "Unable to load networks.",
      );
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);
  useAutoRefresh(
    async (signal) => {
      if (open || restore || busy) return;
      await load(true, signal);
    },
    {
      intervalMs: settings.refreshSeconds * 1000,
      refreshKey: "global-network-inventory",
    },
  );
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (inventory?.items || [])
      .filter(
        (item) =>
          controllerFilter === "all" || item.controllerId === controllerFilter,
      )
      .filter(
        (item) =>
          accessFilter === "all" ||
          (accessFilter === "private"
            ? item.network.private
            : !item.network.private),
      )
      .filter((item) => {
        if (stateFilter === "all") return true;
        if (stateFilter === "stale") return item.stale;
        if (stateFilter === "disabled")
          return !item.controllerEnabled || Boolean(item.network.disabled);
        if (stateFilter === "online")
          return (
            item.controllerOnline === true &&
            !item.stale &&
            !item.network.disabled
          );
        return item.controllerOnline === false;
      })
      .filter((item) => {
        if (!needle) return true;
        const routes =
          item.network.routes?.map((route) => route.target).join(" ") || "";
        const dns = Array.isArray(item.network.dns)
          ? ""
          : `${item.network.dns?.domain || ""} ${item.network.dns?.servers?.join(" ") || ""}`;
        return `${item.network.name} ${item.network.id} ${item.network.description || ""} ${item.network.instance || ""} ${item.controllerName} ${routes} ${dns}`
          .toLowerCase()
          .includes(needle);
      })
      .sort((left, right) => {
        if (sort === "controller")
          return (
            left.controllerName.localeCompare(right.controllerName) ||
            left.network.name.localeCompare(right.network.name)
          );
        if (sort === "members")
          return (
            Number(right.network.memberCount || 0) -
            Number(left.network.memberCount || 0)
          );
        if (sort === "updated")
          return (
            Number(right.lastSyncedAt || 0) - Number(left.lastSyncedAt || 0)
          );
        return left.network.name.localeCompare(right.network.name);
      });
  }, [
    accessFilter,
    controllerFilter,
    inventory?.items,
    query,
    sort,
    stateFilter,
  ]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const visible = filtered.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize,
  );
  const filtersActive =
    controllerFilter !== "all" ||
    Boolean(query) ||
    accessFilter !== "all" ||
    stateFilter !== "all" ||
    sort !== "name";

  async function prepareTarget(controllerId: string) {
    setTargetControllerId(controllerId);
    const controller = controllers.find((item) => item.id === controllerId);
    setCapabilities(controller?.capabilities || null);
    setInstances([]);
    if (controller?.type !== "mikrotik") return;
    try {
      const result = await api<{
        instances: RouterOsZeroTierInstance[];
      }>(`/api/controllers/${controller.id}/networks`);
      setInstances(result.instances || []);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Unable to load RouterOS instances.",
      );
    }
  }

  async function openCreate() {
    const preferred =
      scopeController?.enabled && scopeController.capabilities.networkCrud
        ? scopeController
        : activeController?.enabled && activeController.capabilities.networkCrud
          ? activeController
          : controllers.find(
              (controller) =>
                controller.enabled && controller.capabilities.networkCrud,
            );
    if (!preferred) {
      setError("No enabled controller supports network creation.");
      return;
    }
    setSubnet(generatedSubnet());
    await prepareTarget(preferred.id);
    setOpen(true);
  }
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!targetController) return;
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const body = {
      name: form.get("name"),
      instance: form.get("instance") || undefined,
      comment:
        targetController.type === "mikrotik"
          ? form.get("routerosComment")
          : undefined,
      disabled:
        targetController.type === "mikrotik"
          ? form.get("enabled") !== "on"
          : undefined,
      description: form.get("description"),
      private: form.get("private") === "on",
      enableBroadcast: true,
      mtu: 2800,
      multicastLimit: 32,
      routes: [{ target: String(form.get("route")), via: null }],
      ipAssignmentPools: [
        {
          ipRangeStart: String(form.get("start")),
          ipRangeEnd: String(form.get("end")),
        },
      ],
      v4AssignMode: { zt: true },
      v6AssignMode: {
        rfc4193: form.get("rfc4193") === "on",
        "6plane": form.get("6plane") === "on",
      },
      dns: [],
      rules: [{ type: "ACTION_ACCEPT" }],
      capabilities: [],
      tags: [],
    };
    try {
      const result = await api<{ network: ManagedNetwork }>(
        `/api/controllers/${targetController.id}/networks`,
        jsonRequest("POST", body),
      );
      setOpen(false);
      router.push(`/networks/${targetController.id}/${result.network.id}`);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Unable to create network.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function selectBackup(file: File) {
    if (!scopeController) return;
    setError("");
    try {
      const backup = JSON.parse(await file.text()) as Record<string, unknown>;
      const preview = await api<{
        plan: Array<{
          networkId: string;
          name: string;
          operation: string;
          members: number;
        }>;
      }>(
        "/api/backup/restore",
        jsonRequest("POST", {
          controllerId: scopeController.id,
          backup,
          dryRun: true,
        }),
      );
      setRestore({ backup, plan: preview.plan });
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Invalid backup file.",
      );
    }
  }
  async function restoreBackup() {
    if (!scopeController || !restore) return;
    setBusy(true);
    try {
      const result = await api<{
        results: RestoreResult[];
        summary: {
          total: number;
          succeeded: number;
          failed: number;
          partial: boolean;
        };
      }>(
        "/api/backup/restore",
        jsonRequest("POST", {
          controllerId: scopeController.id,
          backup: restore.backup,
        }),
      );
      await load(false);
      if (result.summary.partial) {
        setRestore((current) =>
          current ? { ...current, results: result.results } : current,
        );
        setMessage(
          `Restore completed partially: ${result.summary.succeeded} succeeded and ${result.summary.failed} failed. The failed resources are listed in the dialog and can be retried safely.`,
        );
      } else {
        setRestore(null);
        setMessage(
          `Backup restored successfully: ${result.summary.succeeded} network(s). Existing controller objects were not deleted.`,
        );
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Restore failed.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">Cross-controller inventory</span>
          <h1>Networks</h1>
          <p>
            Find and operate every managed network without losing its controller
            context.
          </p>
        </div>
        <div className="page-actions">
          {permissions.canExportBackup && scopeController && (
            <a
              className="button"
              href={`/api/backup?controllerId=${scopeController.id}`}
            >
              <Download /> Export
            </a>
          )}
          {permissions.canRestore && scopeController && (
            <>
              <input
                ref={fileRef}
                hidden
                type="file"
                accept="application/json,.json"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void selectBackup(file);
                  event.currentTarget.value = "";
                }}
              />
              <button
                className="button"
                onClick={() => fileRef.current?.click()}
              >
                <Upload /> Restore
              </button>
            </>
          )}
          {permissions.canWriteNetworks && (
            <button
              className="button primary"
              onClick={() => void openCreate()}
            >
              <Plus /> Create network
            </button>
          )}
        </div>
      </div>
      {error && <div className="alert error">{error}</div>}
      {message && (
        <div className="alert success">
          <Check />
          {message}
        </div>
      )}
      <section className="card inventory-filter-card">
        <div className="card-header">
          <div>
            <span className="eyebrow">Fleet scope</span>
            <h2>
              {(inventory?.items.length || 0).toLocaleString()} network
              {inventory?.items.length === 1 ? "" : "s"}
            </h2>
            <p>
              {inventory?.controllers.length || 0} registered controllers ·
              provider data remains the source of truth
            </p>
          </div>
          {filtersActive && (
            <button
              className="button small"
              onClick={() => router.replace("/networks", { scroll: false })}
            >
              <FilterX /> Clear filters
            </button>
          )}
        </div>
        <div className="card-body inventory-filters">
          <label className="field inventory-search">
            <span>Search</span>
            <div className="input-with-icon">
              <Search />
              <input
                className="input"
                placeholder="Name, Network ID, controller, CIDR, DNS…"
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
          <label className="field">
            <span>Access</span>
            <select
              className="select"
              value={accessFilter}
              onChange={(event) =>
                replaceFilters({ access: event.target.value, page: "1" })
              }
            >
              <option value="all">All access modes</option>
              <option value="private">Private</option>
              <option value="public">Public</option>
            </select>
          </label>
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
              <option value="disabled">Disabled</option>
            </select>
          </label>
          <label className="field">
            <span>Sort</span>
            <select
              className="select"
              value={sort}
              onChange={(event) =>
                replaceFilters({ sort: event.target.value, page: "1" })
              }
            >
              <option value="name">Network name</option>
              <option value="controller">Controller</option>
              <option value="members">Member count</option>
              <option value="updated">Recently synchronized</option>
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
                  {controller.stale ? "Showing cached data" : controller.error}
                </span>
              </div>
            ))}
        </section>
      )}

      <section className="card inventory-results-card">
        <div className="card-header">
          <div>
            <span className="eyebrow">Network index</span>
            <h2>{filtered.length.toLocaleString()} matching networks</h2>
            <p>
              Every row carries its controller scope; opening it switches to the
              exact network context.
            </p>
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
              <table className="table inventory-table">
                <thead>
                  <tr>
                    <th>Network</th>
                    <th>Controller</th>
                    <th>Access</th>
                    <th>Members</th>
                    <th>Routes</th>
                    <th>State</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((item) => (
                    <tr key={`${item.controllerId}:${item.network.id}`}>
                      <td>
                        <strong>{item.network.name}</strong>
                        <code>{item.network.id}</code>
                        {item.network.instance && (
                          <small className="table-secondary">
                            Instance · {item.network.instance}
                          </small>
                        )}
                      </td>
                      <td>
                        <span
                          className={`provider-badge ${item.controllerType}`}
                        >
                          {item.controllerName}
                        </span>
                        <small className="table-secondary">
                          {item.controllerType.replaceAll("_", " ")}
                        </small>
                      </td>
                      <td>{item.network.private ? "Private" : "Public"}</td>
                      <td>
                        {Number(item.network.memberCount || 0).toLocaleString()}
                      </td>
                      <td>{item.network.routes?.length || 0}</td>
                      <td>
                        <span
                          className={`status-pill ${item.stale ? "neutral" : !item.controllerEnabled || item.network.disabled ? "disabled" : item.controllerOnline === false ? "offline" : ""}`}
                        >
                          {item.stale
                            ? "Cached"
                            : !item.controllerEnabled || item.network.disabled
                              ? "Disabled"
                              : item.controllerOnline === false
                                ? "Offline"
                                : "Available"}
                        </span>
                      </td>
                      <td>
                        <Link
                          className="button small"
                          href={`/networks/${encodeURIComponent(item.controllerId)}/${encodeURIComponent(item.network.id)}`}
                        >
                          Open <ArrowRight />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty-state">
              <span className="empty-icon">
                <Network />
              </span>
              <h2>
                {inventory?.items.length
                  ? "No matching networks"
                  : "No networks discovered"}
              </h2>
              <p>
                {inventory?.items.length
                  ? "Adjust or clear the inventory filters."
                  : "Connect a controller or create the first private network."}
              </p>
              {permissions.canWriteNetworks && !inventory?.items.length && (
                <button
                  className="button primary"
                  onClick={() => void openCreate()}
                >
                  <Plus /> Create first network
                </button>
              )}
            </div>
          )}
        </div>
        {!loading && filtered.length > 0 && (
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
                <option value="24">24</option>
                <option value="48">48</option>
                <option value="96">96</option>
              </select>
            </label>
            <span>
              {(currentPage - 1) * pageSize + 1}–
              {Math.min(currentPage * pageSize, filtered.length)} of{" "}
              {filtered.length}
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
      {open && (
        <div
          className="modal-backdrop"
          onMouseDown={() => !busy && setOpen(false)}
        >
          <form
            ref={createDialog}
            className="modal wide"
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-network-title"
            tabIndex={-1}
            onSubmit={create}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="modal-header">
              <div>
                <span className="eyebrow">New controller network</span>
                <h2 id="create-network-title">Create network</h2>
                <p>
                  A safe private IPv4 /24 is prepared and remains fully
                  editable.
                </p>
                <ControllerTarget controller={targetController} />
              </div>
              <button
                type="button"
                className="icon-button"
                onClick={() => setOpen(false)}
                aria-label="Close create network dialog"
              >
                <X />
              </button>
            </div>
            <div className="modal-body form-grid">
              <label className="field full">
                <span>Controller</span>
                <select
                  className="select"
                  value={targetControllerId}
                  onChange={(event) => void prepareTarget(event.target.value)}
                  required
                >
                  {controllers
                    .filter(
                      (controller) =>
                        controller.enabled &&
                        controller.capabilities.networkCrud,
                    )
                    .map((controller) => (
                      <option key={controller.id} value={controller.id}>
                        {controller.name} ·{" "}
                        {controller.type.replaceAll("_", " ")}
                      </option>
                    ))}
                </select>
                <small>
                  The new network is created directly on this provider.
                </small>
              </label>
              <label className="field full">
                <span>Network name</span>
                <input
                  className="input"
                  name="name"
                  required
                  autoFocus
                  maxLength={128}
                />
              </label>
              {targetController?.type === "mikrotik" && (
                <>
                  <label className="field full">
                    <span>ZeroTier instance</span>
                    <select
                      key={targetController.id}
                      className="select"
                      name="instance"
                      defaultValue={
                        instances.find(
                          (instance) => !instance.disabled && instance.online,
                        )?.name ||
                        instances.find((instance) => !instance.disabled)
                          ?.name ||
                        ""
                      }
                      required
                    >
                      {instances.map((instance) => (
                        <option
                          disabled={instance.disabled}
                          key={instance.id}
                          value={instance.name}
                        >
                          {instance.name} · {instance.state}
                        </option>
                      ))}
                    </select>
                    <small>
                      The network controller and generated Network ID belong to
                      this RouterOS ZeroTier instance.
                    </small>
                  </label>
                  <label className="field full">
                    <span>RouterOS comment</span>
                    <input
                      className="input"
                      name="routerosComment"
                      maxLength={512}
                    />
                  </label>
                  <div className="switch-field full">
                    <div>
                      <strong>Enabled</strong>
                      <small>
                        Enable the controller network after creation.
                      </small>
                    </div>
                    <label className="switch">
                      <input type="checkbox" name="enabled" defaultChecked />
                      <span />
                    </label>
                  </div>
                </>
              )}
              <label className="field full">
                <span>
                  {targetController?.type === "mikrotik"
                    ? "Control plane notes"
                    : "Description"}
                </span>
                <textarea
                  className="textarea compact"
                  name="description"
                  maxLength={4000}
                />
              </label>
              <div className="field full subsection-heading">
                <div>
                  <span className="eyebrow">IPv4 assignment</span>
                  <strong>Managed subnet and pool</strong>
                </div>
                <button
                  type="button"
                  className="button small"
                  onClick={() => setSubnet(generatedSubnet())}
                >
                  <RefreshCw /> Generate another
                </button>
              </div>
              <label className="field full">
                <span>Managed route</span>
                <input
                  className="input mono"
                  name="route"
                  value={subnet.route}
                  onChange={(event) =>
                    setSubnet({ ...subnet, route: event.target.value })
                  }
                  required
                />
              </label>
              <label className="field">
                <span>Pool start</span>
                <input
                  className="input mono"
                  name="start"
                  value={subnet.start}
                  onChange={(event) =>
                    setSubnet({ ...subnet, start: event.target.value })
                  }
                  required
                />
              </label>
              <label className="field">
                <span>Pool end</span>
                <input
                  className="input mono"
                  name="end"
                  value={subnet.end}
                  onChange={(event) =>
                    setSubnet({ ...subnet, end: event.target.value })
                  }
                  required
                />
              </label>
              <div className="field full switch-stack">
                <div className="switch-field">
                  <div>
                    <strong>Private network</strong>
                    <small>New members must be explicitly authorized.</small>
                  </div>
                  <label className="switch">
                    <input type="checkbox" name="private" defaultChecked />
                    <span />
                  </label>
                </div>
                {capabilities?.ipv6Assignment && (
                  <>
                    <div className="switch-field">
                      <div>
                        <strong>RFC4193 IPv6</strong>
                        <small>Assign a stable unique-local /128.</small>
                      </div>
                      <label className="switch">
                        <input type="checkbox" name="rfc4193" />
                        <span />
                      </label>
                    </div>
                    <div className="switch-field">
                      <div>
                        <strong>6PLANE IPv6</strong>
                        <small>
                          Assign a routed /80 derived from node identity.
                        </small>
                      </div>
                      <label className="switch">
                        <input type="checkbox" name="6plane" />
                        <span />
                      </label>
                    </div>
                  </>
                )}
              </div>
            </div>
            <div className="modal-footer">
              <button
                type="button"
                className="button"
                onClick={() => setOpen(false)}
              >
                Cancel
              </button>
              <button
                className="button primary"
                disabled={busy || !targetController}
              >
                {busy ? "Creating…" : "Create network"}
              </button>
            </div>
          </form>
        </div>
      )}
      {restore && (
        <div
          className="modal-backdrop"
          onMouseDown={() => !busy && setRestore(null)}
        >
          <section
            ref={restoreDialog}
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="restore-backup-title"
            tabIndex={-1}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="modal-header">
              <div>
                <span className="eyebrow">Non-destructive restore</span>
                <h2 id="restore-backup-title">Restore backup</h2>
                <p>
                  Existing IDs are updated; absent networks are created. Nothing
                  is removed.
                </p>
                <ControllerTarget controller={scopeController} />
              </div>
              <button
                className="icon-button"
                onClick={() => setRestore(null)}
                aria-label="Close restore backup dialog"
              >
                <X />
              </button>
            </div>
            <div className="modal-body">
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Network</th>
                      <th>ID</th>
                      <th>Operation</th>
                      <th>Members</th>
                    </tr>
                  </thead>
                  <tbody>
                    {restore.plan.map((item) => (
                      <tr key={item.networkId}>
                        <td>{item.name}</td>
                        <td className="mono">{item.networkId}</td>
                        <td>{item.operation}</td>
                        <td>{item.members}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {restore.results?.some((item) => !item.ok) && (
                <div className="restore-report" role="status">
                  <h3>Resources requiring attention</h3>
                  <p>
                    Successful objects are already saved. Retry is safe and
                    resumes through the stored source-to-target mapping.
                  </p>
                  <div className="restore-failures">
                    {restore.results
                      .filter((item) => !item.ok)
                      .map((item) => (
                        <article key={item.sourceNetworkId}>
                          <strong className="mono">
                            {item.sourceNetworkId}
                          </strong>
                          <span>{item.error || "Network restore failed."}</span>
                          {item.members
                            .filter((member) => !member.ok)
                            .map((member) => (
                              <small key={member.memberId}>
                                Member {member.memberId}: {member.error}
                              </small>
                            ))}
                        </article>
                      ))}
                  </div>
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button className="button" onClick={() => setRestore(null)}>
                Cancel
              </button>
              <button
                className="button primary"
                disabled={busy}
                onClick={() => void restoreBackup()}
              >
                {busy
                  ? "Restoring…"
                  : restore.results
                    ? "Retry restore"
                    : "Restore backup"}
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
