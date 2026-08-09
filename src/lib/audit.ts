import type { SQLInputValue } from "node:sqlite";
import { db, queryAll, queryOne } from "@/lib/database";
import { errorDetail, errorStatus } from "@/lib/errors";
import type { AuditEntry } from "@/lib/types";
import { getAppSettings } from "@/lib/settings";
import { ValidationError } from "@/lib/validation";

export function writeAudit(input: {
  userId?: string | null;
  controllerId?: string | null;
  nodeId?: string | null;
  action: string;
  method: string;
  target: string;
  status: number;
  ok: boolean;
  detail?: string | null;
}) {
  const userId =
    input.userId &&
    queryOne<{ id: string }>("SELECT id FROM users WHERE id=?", input.userId)
      ? input.userId
      : null;
  const controllerId =
    input.controllerId &&
    queryOne<{ id: string }>(
      "SELECT id FROM controllers WHERE id=?",
      input.controllerId,
    )
      ? input.controllerId
      : null;
  const nodeId =
    input.nodeId &&
    queryOne<{ id: string }>(
      "SELECT id FROM managed_nodes WHERE id=?",
      input.nodeId,
    )
      ? input.nodeId
      : null;
  const database = db();
  const action = input.action.slice(0, 120);
  const method = input.method.slice(0, 16);
  const target = input.target.slice(0, 1_000);
  const detail = input.detail?.slice(0, 4_000) || null;
  database
    .prepare(
      `INSERT INTO audit_log (timestamp,user_id,controller_id,node_id,action,method,target,status,ok,detail) VALUES (?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      Date.now(),
      userId,
      controllerId,
      nodeId,
      action,
      method,
      target,
      input.status,
      input.ok ? 1 : 0,
      detail,
    );
  const retentionDays = getAppSettings().auditRetentionDays;
  if (retentionDays)
    database
      .prepare("DELETE FROM audit_log WHERE timestamp < ?")
      .run(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
}

export function writeFailureAudit(
  error: unknown,
  input: Omit<Parameters<typeof writeAudit>[0], "status" | "ok" | "detail"> & {
    detail?: string | null;
  },
) {
  writeAudit({
    ...input,
    status: errorStatus(error),
    ok: false,
    detail: input.detail ?? errorDetail(error),
  });
}

interface AuditRow {
  id: number;
  timestamp: number;
  user_id: string | null;
  user_email: string | null;
  controller_id: string | null;
  controller_name: string | null;
  node_id: string | null;
  node_name: string | null;
  action: string;
  method: string;
  target: string;
  status: number;
  ok: number;
  detail: string | null;
}

export interface AuditFilters {
  search?: string;
  result?: "success" | "failure";
  action?: string;
  actor?: string;
  controller?: string;
  node?: string;
  from?: number;
  to?: number;
}

export interface AuditFilterOptions {
  actions: string[];
  users: Array<{ id: string; label: string }>;
  controllers: Array<{ id: string; label: string }>;
  nodes: Array<{ id: string; label: string }>;
}

export interface AuditPageResult {
  entries: AuditEntry[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
  options: AuditFilterOptions;
}

const PAGE_SIZES = new Set([25, 50, 100]);
const AUDIT_SELECT = `
  SELECT a.*,u.email AS user_email,c.name AS controller_name,n.name AS node_name
  FROM audit_log a
  LEFT JOIN users u ON u.id=a.user_id
  LEFT JOIN controllers c ON c.id=a.controller_id
  LEFT JOIN managed_nodes n ON n.id=a.node_id`;

function boundedParameter(
  params: URLSearchParams,
  name: string,
  maximum: number,
) {
  const value = params.get(name)?.trim() || "";
  if (value.length > maximum)
    throw new ValidationError(`${name} filter is too long.`);
  return value || undefined;
}

function timestampParameter(params: URLSearchParams, name: string) {
  const value = params.get(name);
  if (!value) return undefined;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0)
    throw new ValidationError(`${name} date filter is invalid.`);
  return parsed;
}

export function parseAuditRequest(params: URLSearchParams) {
  const pageValue = Number(params.get("page") || 1);
  const pageSizeValue = Number(params.get("pageSize") || 25);
  if (!Number.isSafeInteger(pageValue) || pageValue < 1)
    throw new ValidationError("Audit page is invalid.");
  if (!PAGE_SIZES.has(pageSizeValue))
    throw new ValidationError("Audit page size is invalid.");
  const resultValue = params.get("result") || "";
  if (resultValue && !new Set(["success", "failure"]).has(resultValue))
    throw new ValidationError("Audit result filter is invalid.");
  const filters: AuditFilters = {
    search: boundedParameter(params, "search", 200),
    action: boundedParameter(params, "action", 120),
    actor: boundedParameter(params, "actor", 128),
    controller: boundedParameter(params, "controller", 128),
    node: boundedParameter(params, "node", 128),
    result: resultValue ? (resultValue as AuditFilters["result"]) : undefined,
    from: timestampParameter(params, "from"),
    to: timestampParameter(params, "to"),
  };
  if (filters.from !== undefined && filters.to !== undefined) {
    if (filters.from > filters.to)
      throw new ValidationError("Start date must be before end date.");
  }
  return { filters, page: pageValue, pageSize: pageSizeValue };
}

function filteredWhere(filters: AuditFilters) {
  const clauses: string[] = [];
  const values: SQLInputValue[] = [];
  if (filters.search) {
    const escaped = filters.search.replace(/[!%_]/g, "!$&");
    const value = `%${escaped}%`;
    clauses.push(`(
      a.action LIKE ? ESCAPE '!' COLLATE NOCASE OR
      a.method LIKE ? ESCAPE '!' COLLATE NOCASE OR
      a.target LIKE ? ESCAPE '!' COLLATE NOCASE OR
      COALESCE(a.detail,'') LIKE ? ESCAPE '!' COLLATE NOCASE OR
      COALESCE(u.email,'') LIKE ? ESCAPE '!' COLLATE NOCASE OR
      COALESCE(c.name,'') LIKE ? ESCAPE '!' COLLATE NOCASE OR
      COALESCE(n.name,'') LIKE ? ESCAPE '!' COLLATE NOCASE
    )`);
    values.push(value, value, value, value, value, value, value);
  }
  if (filters.result) {
    clauses.push("a.ok=?");
    values.push(filters.result === "success" ? 1 : 0);
  }
  if (filters.action) {
    clauses.push("a.action=?");
    values.push(filters.action);
  }
  if (filters.actor) {
    clauses.push(
      filters.actor === "system" ? "a.user_id IS NULL" : "a.user_id=?",
    );
    if (filters.actor !== "system") values.push(filters.actor);
  }
  if (filters.controller) {
    clauses.push(
      filters.controller === "none"
        ? "a.controller_id IS NULL"
        : "a.controller_id=?",
    );
    if (filters.controller !== "none") values.push(filters.controller);
  }
  if (filters.node) {
    clauses.push(filters.node === "none" ? "a.node_id IS NULL" : "a.node_id=?");
    if (filters.node !== "none") values.push(filters.node);
  }
  if (filters.from !== undefined) {
    clauses.push("a.timestamp>=?");
    values.push(filters.from);
  }
  if (filters.to !== undefined) {
    clauses.push("a.timestamp<=?");
    values.push(filters.to);
  }
  return {
    sql: clauses.length ? ` WHERE ${clauses.join(" AND ")}` : "",
    values,
  };
}

function auditEntry(row: AuditRow): AuditEntry {
  return {
    id: row.id,
    timestamp: row.timestamp,
    userId: row.user_id,
    userEmail: row.user_email,
    controllerId: row.controller_id,
    controllerName: row.controller_name,
    nodeId: row.node_id,
    nodeName: row.node_name,
    action: row.action,
    method: row.method,
    target: row.target,
    status: row.status,
    ok: Boolean(row.ok),
    detail: row.detail,
  };
}

function filterOptions(): AuditFilterOptions {
  return {
    actions: queryAll<{ action: string }>(
      "SELECT DISTINCT action FROM audit_log ORDER BY action COLLATE NOCASE",
    ).map((row) => row.action),
    users: queryAll<{ id: string; label: string }>(
      `SELECT DISTINCT u.id,u.email AS label FROM audit_log a
       JOIN users u ON u.id=a.user_id ORDER BY u.email COLLATE NOCASE`,
    ),
    controllers: queryAll<{ id: string; label: string }>(
      `SELECT DISTINCT c.id,c.name AS label FROM audit_log a
       JOIN controllers c ON c.id=a.controller_id ORDER BY c.name COLLATE NOCASE`,
    ),
    nodes: queryAll<{ id: string; label: string }>(
      `SELECT DISTINCT n.id,n.name AS label FROM audit_log a
       JOIN managed_nodes n ON n.id=a.node_id ORDER BY n.name COLLATE NOCASE`,
    ),
  };
}

export function listAuditPage(
  filters: AuditFilters,
  page: number,
  pageSize: number,
): AuditPageResult {
  const where = filteredWhere(filters);
  const total = Number(
    queryOne<{ count: number }>(
      `SELECT COUNT(*) AS count FROM audit_log a
       LEFT JOIN users u ON u.id=a.user_id
       LEFT JOIN controllers c ON c.id=a.controller_id
       LEFT JOIN managed_nodes n ON n.id=a.node_id${where.sql}`,
      ...where.values,
    )?.count || 0,
  );
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);
  const entries = queryAll<AuditRow>(
    `${AUDIT_SELECT}${where.sql}
     ORDER BY a.timestamp DESC,a.id DESC LIMIT ? OFFSET ?`,
    ...where.values,
    pageSize,
    (safePage - 1) * pageSize,
  ).map(auditEntry);
  return {
    entries,
    pagination: { page: safePage, pageSize, total, totalPages },
    options: filterOptions(),
  };
}

function csvCell(value: unknown) {
  let text = value === null || value === undefined ? "" : String(value);
  if (/^[\t\r\n]/.test(text) || /^\s*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export function* auditCsv(filters: AuditFilters): Generator<string> {
  yield `\uFEFF${[
    "ID",
    "Time",
    "Action",
    "Method",
    "Target",
    "Controller",
    "Managed node",
    "User",
    "HTTP status",
    "Result",
    "Detail",
  ]
    .map(csvCell)
    .join(",")}\r\n`;
  const where = filteredWhere(filters);
  const rows = db()
    .prepare(
      `${AUDIT_SELECT}${where.sql}
       ORDER BY a.timestamp DESC,a.id DESC`,
    )
    .iterate(...where.values) as Iterable<AuditRow>;
  for (const row of rows) {
    const entry = auditEntry(row);
    yield `${[
      entry.id,
      new Date(entry.timestamp).toISOString(),
      entry.action,
      entry.method,
      entry.target,
      entry.controllerName || "",
      entry.nodeName || "",
      entry.userEmail || "System",
      entry.status,
      entry.ok ? "Success" : "Failure",
      entry.detail || "",
    ]
      .map(csvCell)
      .join(",")}\r\n`;
  }
}
