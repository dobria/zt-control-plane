"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  FilterX,
  ScrollText,
} from "lucide-react";
import { api } from "@/lib/client-api";
import { useAutoRefresh } from "@/shared/hooks/useAutoRefresh";
import { useAuth } from "@/shared/providers/AuthContext";
import type { AuditEntry } from "@/lib/types";

interface FilterOption {
  id: string;
  label: string;
}

interface AuditResponse {
  entries: AuditEntry[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
  options: {
    actions: string[];
    users: FilterOption[];
    controllers: FilterOption[];
    nodes: FilterOption[];
  };
}

const emptyResponse: AuditResponse = {
  entries: [],
  pagination: { page: 1, pageSize: 25, total: 0, totalPages: 1 },
  options: { actions: [], users: [], controllers: [], nodes: [] },
};

const filterNames = [
  "search",
  "result",
  "action",
  "actor",
  "controller",
  "node",
  "from",
  "to",
] as const;

function dateValue(timestamp: string | null) {
  if (!timestamp) return "";
  const date = new Date(Number(timestamp));
  if (Number.isNaN(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dateTimestamp(value: string, endOfDay = false) {
  if (!value) return "";
  const suffix = endOfDay ? "T23:59:59.999" : "T00:00:00.000";
  return String(new Date(`${value}${suffix}`).getTime());
}

export function AuditPage() {
  const { settings, permissions } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const requestKey = searchParams.toString();
  const [data, setData] = useState<AuditResponse>(emptyResponse);
  const [draft, setDraft] = useState({
    search: "",
    result: "",
    action: "",
    actor: "",
    controller: "",
    node: "",
    from: "",
    to: "",
  });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const loadedRef = useRef(false);

  const replaceParams = useCallback(
    (params: URLSearchParams) => {
      const query = params.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, {
        scroll: false,
      });
    },
    [pathname, router],
  );

  useEffect(() => {
    setDraft({
      search: searchParams.get("search") || "",
      result: searchParams.get("result") || "",
      action: searchParams.get("action") || "",
      actor: searchParams.get("actor") || "",
      controller: searchParams.get("controller") || "",
      node: searchParams.get("node") || "",
      from: dateValue(searchParams.get("from")),
      to: dateValue(searchParams.get("to")),
    });
    loadedRef.current = false;
    setLoading(true);
  }, [requestKey, searchParams]);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!loadedRef.current) setLoading(true);
      try {
        const result = await api<AuditResponse>(
          `/api/audit${requestKey ? `?${requestKey}` : ""}`,
          { signal },
        );
        if (signal?.aborted) return;
        setData(result);
        setError("");
        loadedRef.current = true;
      } catch (caught) {
        if (signal?.aborted) return;
        setError(
          caught instanceof Error
            ? caught.message
            : "Unable to load audit log.",
        );
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [requestKey],
  );

  useAutoRefresh(load, {
    intervalMs: settings.refreshSeconds * 1000,
    refreshKey: requestKey,
  });

  const filtersActive = filterNames.some((name) =>
    Boolean(searchParams.get(name)),
  );
  const exportUrl = useMemo(() => {
    const params = new URLSearchParams(requestKey);
    params.delete("page");
    params.delete("pageSize");
    const query = params.toString();
    return `/api/audit/export${query ? `?${query}` : ""}`;
  }, [requestKey]);

  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const from = dateTimestamp(draft.from);
    const to = dateTimestamp(draft.to, true);
    if (from && to && Number(from) > Number(to)) {
      setError("Start date must be before end date.");
      return;
    }
    const params = new URLSearchParams(requestKey);
    for (const name of filterNames) params.delete(name);
    for (const name of [
      "search",
      "result",
      "action",
      "actor",
      "controller",
      "node",
    ] as const) {
      const value = draft[name].trim();
      if (value) params.set(name, value);
    }
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    params.delete("page");
    setError("");
    replaceParams(params);
  }

  function resetFilters() {
    const params = new URLSearchParams(requestKey);
    for (const name of filterNames) params.delete(name);
    params.delete("page");
    setError("");
    replaceParams(params);
  }

  function setPage(page: number) {
    const params = new URLSearchParams(requestKey);
    if (page <= 1) params.delete("page");
    else params.set("page", String(page));
    replaceParams(params);
  }

  function setPageSize(pageSize: string) {
    const params = new URLSearchParams(requestKey);
    if (pageSize === "25") params.delete("pageSize");
    else params.set("pageSize", pageSize);
    params.delete("page");
    replaceParams(params);
  }

  const { entries, pagination, options } = data;
  const firstEntry = pagination.total
    ? (pagination.page - 1) * pagination.pageSize + 1
    : 0;
  const lastEntry = Math.min(
    pagination.page * pagination.pageSize,
    pagination.total,
  );

  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">Immutable operations history</span>
          <h1>Audit log</h1>
          <p>
            Controller, member, authentication and configuration operations
            recorded in SQLite.
          </p>
        </div>
        <div className="page-actions">
          {permissions.canExportAudit && (
            <a className="button" href={exportUrl}>
              <Download /> Export CSV
            </a>
          )}
        </div>
      </div>
      {error && <div className="alert error">{error}</div>}

      <section className="card audit-filter-card">
        <div className="card-header">
          <div>
            <span className="eyebrow">Filters</span>
            <h2>Find activity</h2>
          </div>
          {filtersActive && (
            <button className="button secondary" onClick={resetFilters}>
              <FilterX /> Clear filters
            </button>
          )}
        </div>
        <form className="card-body audit-filter-grid" onSubmit={applyFilters}>
          <label className="field audit-filter-search">
            <span>Search</span>
            <input
              className="input"
              placeholder="Action, target, user, endpoint or detail…"
              value={draft.search}
              onChange={(event) =>
                setDraft({ ...draft, search: event.target.value })
              }
            />
          </label>
          <label className="field">
            <span>Result</span>
            <select
              className="select"
              value={draft.result}
              onChange={(event) =>
                setDraft({ ...draft, result: event.target.value })
              }
            >
              <option value="">All results</option>
              <option value="success">Successful</option>
              <option value="failure">Failed</option>
            </select>
          </label>
          <label className="field">
            <span>Action</span>
            <select
              className="select"
              value={draft.action}
              onChange={(event) =>
                setDraft({ ...draft, action: event.target.value })
              }
            >
              <option value="">All actions</option>
              {draft.action && !options.actions.includes(draft.action) && (
                <option value={draft.action}>{draft.action}</option>
              )}
              {options.actions.map((action) => (
                <option value={action} key={action}>
                  {action}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>User</span>
            <select
              className="select"
              value={draft.actor}
              onChange={(event) =>
                setDraft({ ...draft, actor: event.target.value })
              }
            >
              <option value="">All users</option>
              <option value="system">System / removed user</option>
              {options.users.map((option) => (
                <option value={option.id} key={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Controller</span>
            <select
              className="select"
              value={draft.controller}
              onChange={(event) =>
                setDraft({ ...draft, controller: event.target.value })
              }
            >
              <option value="">All controllers</option>
              <option value="none">No controller context</option>
              {options.controllers.map((option) => (
                <option value={option.id} key={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Managed node</span>
            <select
              className="select"
              value={draft.node}
              onChange={(event) =>
                setDraft({ ...draft, node: event.target.value })
              }
            >
              <option value="">All managed nodes</option>
              <option value="none">No managed node context</option>
              {options.nodes.map((option) => (
                <option value={option.id} key={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>From</span>
            <input
              className="input"
              type="date"
              value={draft.from}
              onChange={(event) =>
                setDraft({ ...draft, from: event.target.value })
              }
            />
          </label>
          <label className="field">
            <span>To</span>
            <input
              className="input"
              type="date"
              value={draft.to}
              onChange={(event) =>
                setDraft({ ...draft, to: event.target.value })
              }
            />
          </label>
          <div className="audit-filter-actions">
            <button className="button primary">Apply filters</button>
          </div>
        </form>
      </section>

      <section className="card">
        <div className="card-header audit-results-header">
          <div>
            <span className="eyebrow">Activity</span>
            <h2>{pagination.total.toLocaleString()} events</h2>
          </div>
          <span className="audit-range">
            {pagination.total
              ? `${firstEntry.toLocaleString()}–${lastEntry.toLocaleString()} shown`
              : "No results"}
          </span>
        </div>
        {loading ? (
          <div className="card-body">
            <div className="skeleton tall" />
          </div>
        ) : entries.length ? (
          <>
            <div className="table-wrap">
              <table className="table audit-table">
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Action</th>
                    <th>Target</th>
                    <th>Context</th>
                    <th>User</th>
                    <th>Result</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry) => (
                    <tr key={entry.id}>
                      <td className="nowrap">
                        {new Date(entry.timestamp).toLocaleString()}
                      </td>
                      <td>
                        <strong>{entry.action}</strong>
                        <br />
                        <code>{entry.method}</code>
                      </td>
                      <td>
                        <span className="mono audit-target">
                          {entry.target}
                        </span>
                        {entry.detail && (
                          <small className="audit-detail">{entry.detail}</small>
                        )}
                      </td>
                      <td>
                        <span>{entry.controllerName || "No controller"}</span>
                        {entry.nodeName && (
                          <small className="audit-detail">
                            {entry.nodeName}
                          </small>
                        )}
                      </td>
                      <td>{entry.userEmail || "System"}</td>
                      <td>
                        <span
                          className={`status-pill ${entry.ok ? "" : "offline"}`}
                        >
                          {entry.ok
                            ? `${entry.status} OK`
                            : `${entry.status} Failed`}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="audit-pagination">
              <label className="audit-page-size">
                <span>Rows per page</span>
                <select
                  className="select"
                  value={pagination.pageSize}
                  onChange={(event) => setPageSize(event.target.value)}
                >
                  <option value="25">25</option>
                  <option value="50">50</option>
                  <option value="100">100</option>
                </select>
              </label>
              <span>
                Page {pagination.page.toLocaleString()} of{" "}
                {pagination.totalPages.toLocaleString()}
              </span>
              <div className="actions">
                <button
                  className="icon-button"
                  aria-label="Previous audit page"
                  disabled={pagination.page <= 1}
                  onClick={() => setPage(pagination.page - 1)}
                >
                  <ChevronLeft />
                </button>
                <button
                  className="icon-button"
                  aria-label="Next audit page"
                  disabled={pagination.page >= pagination.totalPages}
                  onClick={() => setPage(pagination.page + 1)}
                >
                  <ChevronRight />
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="empty-state">
            <span className="empty-icon">
              <ScrollText />
            </span>
            <h2>No matching events</h2>
            {filtersActive && (
              <button className="button secondary" onClick={resetFilters}>
                Clear filters
              </button>
            )}
          </div>
        )}
      </section>
    </>
  );
}
