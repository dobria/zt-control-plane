"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import {
  Check,
  Cloud,
  Cpu,
  Edit3,
  FolderTree,
  Network,
  Plus,
  RefreshCw,
  Router,
  ServerCog,
  Trash2,
  X,
} from "lucide-react";
import { api, jsonRequest } from "@/lib/client-api";
import { useAuth } from "@/shared/providers/AuthContext";
import { useDialog } from "@/shared/hooks/useDialog";
import { NetworkGroupsDialog } from "@/features/controllers/NetworkGroupsDialog";
import type { ControllerType, PublicController } from "@/lib/types";

interface FormState {
  id: string;
  type: Exclude<ControllerType, "embedded">;
  name: string;
  baseUrl: string;
  apiToken: string;
  username: string;
  password: string;
  organizationId: string;
  networkGroupId: string;
  enabled: boolean;
  tlsVerify: boolean;
}
const empty: FormState = {
  id: "",
  type: "zerotier",
  name: "",
  baseUrl: "http://",
  apiToken: "",
  username: "",
  password: "",
  organizationId: "",
  networkGroupId: "",
  enabled: true,
  tlsVerify: true,
};

export function ControllersPage() {
  const router = useRouter();
  const auth = useAuth();
  const [controllers, setControllers] = useState<PublicController[]>(
    auth.controllers,
  );
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(empty);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [groupController, setGroupController] =
    useState<PublicController | null>(null);
  const controllerDialog = useDialog<HTMLFormElement>(
    open,
    () => setOpen(false),
    Boolean(busy),
  );
  useEffect(() => {
    if (
      !auth.permissions.canManageControllers ||
      new URLSearchParams(window.location.search).get("add") !== "true"
    )
      return;
    setForm(empty);
    setOpen(true);
    window.history.replaceState({}, "", "/controllers");
  }, [auth.permissions.canManageControllers]);
  async function load() {
    try {
      const result = await api<{ controllers: PublicController[] }>(
        "/api/controllers",
      );
      setControllers(result.controllers);
      await auth.refresh();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Unable to load controllers.",
      );
    }
  }
  function edit(controller?: PublicController) {
    if (!controller) setForm(empty);
    else
      setForm({
        id: controller.id,
        type: controller.type as Exclude<ControllerType, "embedded">,
        name: controller.name,
        baseUrl: controller.baseUrl,
        apiToken: "",
        username: "",
        password: "",
        organizationId: String(controller.configuration.organizationId || ""),
        networkGroupId: String(controller.configuration.networkGroupId || ""),
        enabled: controller.enabled,
        tlsVerify: controller.tlsVerify,
      });
    setOpen(true);
    setError("");
    setMessage("");
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy("save");
    setError("");
    try {
      const body = { ...form };
      const result = form.id
        ? await api<{ warning?: string }>(
            `/api/controllers/${form.id}`,
            jsonRequest("PUT", body),
          )
        : await api<{ warning?: string }>(
            "/api/controllers",
            jsonRequest("POST", body),
          );
      setOpen(false);
      await load();
      setMessage(
        result.warning ||
          (form.id
            ? "Controller connection updated."
            : "Controller connection added."),
      );
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Unable to save controller.",
      );
    } finally {
      setBusy("");
    }
  }
  async function test(controller: PublicController) {
    setBusy(controller.id);
    setError("");
    try {
      await api(`/api/controllers/${controller.id}/test`, { method: "POST" });
      await load();
      setMessage(`${controller.name} is reachable.`);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Connection test failed.",
      );
      await load();
    } finally {
      setBusy("");
    }
  }
  async function activate(controller: PublicController) {
    setBusy(controller.id);
    setError("");
    try {
      await auth.activateController(controller.id);
      setMessage(`${controller.name} is now active.`);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Unable to activate controller.",
      );
    } finally {
      setBusy("");
    }
  }
  async function openNetworks(controller: PublicController) {
    setBusy(controller.id);
    setError("");
    try {
      if (auth.activeController?.id !== controller.id)
        await auth.activateController(controller.id);
      router.push(`/networks?controller=${encodeURIComponent(controller.id)}`);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Unable to open networks.",
      );
    } finally {
      setBusy("");
    }
  }
  async function openNodeManagement(controller: PublicController) {
    setBusy(controller.id);
    setError("");
    try {
      if (auth.activeController?.id !== controller.id)
        await auth.activateController(controller.id);
      router.push(`/controllers/${controller.id}/nodes`);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Unable to open node management.",
      );
    } finally {
      setBusy("");
    }
  }
  async function remove(controller: PublicController) {
    if (
      !confirm(
        `Remove the connection to “${controller.name}”? The remote controller itself will not be modified.`,
      )
    )
      return;
    setBusy(controller.id);
    try {
      await api(`/api/controllers/${controller.id}`, { method: "DELETE" });
      await load();
      setMessage("Controller connection removed.");
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Unable to remove controller.",
      );
    } finally {
      setBusy("");
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">Connection registry</span>
          <h1>Controllers</h1>
          <p>
            Manage self-hosted ZeroTier, RouterOS, New Central and Legacy
            Central connections from one registry.
          </p>
        </div>
        {auth.permissions.canManageControllers && (
          <button className="button primary" onClick={() => edit()}>
            <Plus /> Add controller
          </button>
        )}
      </div>
      {error && <div className="alert error">{error}</div>}
      {message && (
        <div className="alert success">
          <Check />
          {message}
        </div>
      )}
      <div className="controller-grid">
        {controllers.map((controller) => (
          <article
            id={`controller-${controller.id}`}
            className={`controller-card ${controller.type} ${auth.activeController?.id === controller.id ? "active" : ""}`}
            key={controller.id}
          >
            <div
              role="button"
              className="controller-card-main"
              tabIndex={
                !controller.enabled ||
                auth.activeController?.id === controller.id ||
                busy === controller.id
                  ? -1
                  : 0
              }
              aria-disabled={
                !controller.enabled ||
                auth.activeController?.id === controller.id ||
                busy === controller.id
              }
              aria-pressed={auth.activeController?.id === controller.id}
              aria-label={
                auth.activeController?.id === controller.id
                  ? `${controller.name} is the active controller`
                  : `Make ${controller.name} the active controller`
              }
              onClick={() => {
                if (
                  !controller.enabled ||
                  auth.activeController?.id === controller.id ||
                  busy === controller.id
                )
                  return;
                void activate(controller);
              }}
              onKeyDown={(event) => {
                if (event.key !== "Enter" && event.key !== " ") return;
                if (
                  !controller.enabled ||
                  auth.activeController?.id === controller.id ||
                  busy === controller.id
                )
                  return;
                event.preventDefault();
                void activate(controller);
              }}
            >
              <div className="controller-card-top">
                <span className={`controller-type ${controller.type}`}>
                  {controller.type === "central_v1" ||
                  controller.type === "central_v2" ? (
                    <Cloud />
                  ) : controller.type === "mikrotik" ? (
                    <Router />
                  ) : controller.embedded ? (
                    <Cpu />
                  ) : (
                    <ServerCog />
                  )}
                </span>
                <div className="controller-statuses">
                  <span
                    className={`status-pill ${!controller.enabled || controller.lastOnline === false ? "offline" : controller.lastOnline === null ? "neutral" : ""}`}
                  >
                    {!controller.enabled
                      ? "Disabled"
                      : controller.lastOnline === false
                        ? "Offline"
                        : controller.lastOnline === null
                          ? "Not tested"
                          : "Online"}
                  </span>
                  {auth.activeController?.id === controller.id && (
                    <span className="active-label">ACTIVE</span>
                  )}
                </div>
              </div>
              <span className="eyebrow">
                {controller.embedded
                  ? "Embedded ZeroTier One"
                  : controller.type === "mikrotik"
                    ? "MikroTik RouterOS"
                    : controller.type === "central_v2"
                      ? "New ZeroTier Central"
                      : controller.type === "central_v1"
                        ? "Legacy ZeroTier Central"
                        : "Remote ZeroTier One"}
              </span>
              <h2>{controller.name}</h2>
              <code className="controller-url">{controller.baseUrl}</code>
              <dl className="detail-list compact-list">
                <div>
                  <dt>
                    {controller.type.startsWith("central_")
                      ? "Scope ID"
                      : "Node ID"}
                  </dt>
                  <dd className="mono">{controller.lastAddress || "—"}</dd>
                </div>
                <div>
                  <dt>Version</dt>
                  <dd>{controller.lastVersion || "—"}</dd>
                </div>
                <div>
                  <dt>Last check</dt>
                  <dd>
                    {controller.lastCheckedAt
                      ? new Date(controller.lastCheckedAt).toLocaleString()
                      : "Never"}
                  </dd>
                </div>
              </dl>
              {controller.lastError && (
                <div className="inline-error">{controller.lastError}</div>
              )}
            </div>
            <div className="controller-actions">
              <button
                className="button small"
                disabled={!controller.enabled || busy === controller.id}
                onClick={() => void openNetworks(controller)}
              >
                <Network /> Networks
              </button>
              {!controller.type.startsWith("central_") && (
                <button
                  className={`button small ${!controller.enabled ? "disabled" : ""}`}
                  disabled={!controller.enabled || busy === controller.id}
                  onClick={() => void openNodeManagement(controller)}
                >
                  <Cpu /> Node
                </button>
              )}
              {auth.permissions.canManageControllers && (
                <>
                  <button
                    className="button small"
                    disabled={busy === controller.id}
                    onClick={() => void test(controller)}
                  >
                    <RefreshCw /> Test
                  </button>
                  {!controller.embedded && (
                    <button
                      className="icon-button"
                      onClick={() => edit(controller)}
                      aria-label={`Edit ${controller.name}`}
                    >
                      <Edit3 />
                    </button>
                  )}
                  {!controller.embedded && (
                    <button
                      className="icon-button danger-icon"
                      disabled={busy === controller.id}
                      onClick={() => void remove(controller)}
                      aria-label={`Remove ${controller.name}`}
                    >
                      <Trash2 />
                    </button>
                  )}
                </>
              )}
              {controller.type === "central_v2" && (
                <button
                  className="button small"
                  onClick={() => setGroupController(controller)}
                >
                  <FolderTree /> Groups
                </button>
              )}
            </div>
            {controller.type.startsWith("central_") && (
              <p className="controller-capability-note">
                Client devices are managed as members inside each network.
              </p>
            )}
          </article>
        ))}
      </div>
      {open && (
        <div
          className="modal-backdrop"
          onMouseDown={() => !busy && setOpen(false)}
        >
          <form
            ref={controllerDialog}
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="controller-dialog-title"
            tabIndex={-1}
            onSubmit={save}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="modal-header">
              <div>
                <span className="eyebrow">Controller registry</span>
                <h2 id="controller-dialog-title">
                  {form.id ? "Edit connection" : "Add controller"}
                </h2>
                <p>
                  Credentials are encrypted before they are stored in SQLite.
                </p>
              </div>
              <button
                type="button"
                className="icon-button"
                onClick={() => setOpen(false)}
                aria-label="Close controller dialog"
              >
                <X />
              </button>
            </div>
            <div className="modal-body form-grid">
              {!form.id && (
                <label className="field full">
                  <span>Controller type</span>
                  <select
                    className="select"
                    value={form.type}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        type: event.target.value as Exclude<
                          ControllerType,
                          "embedded"
                        >,
                        baseUrl:
                          event.target.value === "central_v2"
                            ? "https://central.zerotier.com"
                            : event.target.value === "central_v1"
                              ? "https://api.zerotier.com/api/v1"
                              : event.target.value === "mikrotik"
                                ? "https://"
                                : "http://",
                      })
                    }
                  >
                    <option value="zerotier">Remote ZeroTier One</option>
                    <option value="mikrotik">MikroTik RouterOS</option>
                    <option value="central_v2">New ZeroTier Central</option>
                    <option value="central_v1">Legacy ZeroTier Central</option>
                  </select>
                </label>
              )}
              <label className="field full">
                <span>Display name</span>
                <input
                  className="input"
                  value={form.name}
                  onChange={(event) =>
                    setForm({ ...form, name: event.target.value })
                  }
                  required
                  autoFocus
                />
              </label>
              <label className="field full">
                <span>
                  {form.type === "mikrotik"
                    ? "RouterOS URL"
                    : form.type.startsWith("central_")
                      ? "ZeroTier Central API URL"
                      : "ZeroTier Service API URL"}
                </span>
                <input
                  className="input mono"
                  type="url"
                  value={form.baseUrl}
                  onChange={(event) =>
                    setForm({ ...form, baseUrl: event.target.value })
                  }
                  placeholder={
                    form.type === "mikrotik"
                      ? "https://10.147.20.10"
                      : form.type.startsWith("central_")
                        ? undefined
                        : "http://10.147.20.5:9993"
                  }
                  required
                />
                <small>
                  {form.type === "mikrotik"
                    ? "Use a hostname or IP address, for example https://10.147.20.10. /rest is added automatically."
                    : form.type === "central_v2"
                      ? "Default: https://central.zerotier.com"
                      : form.type === "central_v1"
                        ? "Default: https://api.zerotier.com/api/v1"
                        : "Use a hostname or IP address, for example http://10.147.20.5:9993."}
                </small>
              </label>
              {form.type === "central_v2" && (
                <>
                  <label className="field">
                    <span>Organization ID</span>
                    <input
                      className="input mono"
                      value={form.organizationId}
                      onChange={(event) =>
                        setForm({ ...form, organizationId: event.target.value })
                      }
                      required
                    />
                  </label>
                  <label className="field">
                    <span>Network Group ID</span>
                    <input
                      className="input mono"
                      value={form.networkGroupId}
                      onChange={(event) =>
                        setForm({ ...form, networkGroupId: event.target.value })
                      }
                    />
                    <small>Required when creating networks.</small>
                  </label>
                </>
              )}
              {form.type === "mikrotik" ? (
                <>
                  <label className="field">
                    <span>RouterOS username</span>
                    <input
                      className="input"
                      value={form.username}
                      onChange={(event) =>
                        setForm({ ...form, username: event.target.value })
                      }
                      required={!form.id}
                    />
                  </label>
                  <label className="field">
                    <span>Password {form.id && "(optional)"}</span>
                    <input
                      className="input"
                      type="password"
                      value={form.password}
                      onChange={(event) =>
                        setForm({ ...form, password: event.target.value })
                      }
                      required={!form.id}
                      autoComplete="new-password"
                    />
                  </label>
                </>
              ) : (
                <label className="field full">
                  <span>
                    {form.type.startsWith("central_")
                      ? "Central API token"
                      : "Local API token"}{" "}
                    {form.id && "(optional)"}
                  </span>
                  <input
                    className="input mono"
                    type="password"
                    value={form.apiToken}
                    onChange={(event) =>
                      setForm({ ...form, apiToken: event.target.value })
                    }
                    required={!form.id}
                    autoComplete="new-password"
                  />
                  <small>
                    {form.type === "central_v2"
                      ? "Use a New Central service-account token."
                      : form.type === "central_v1"
                        ? "Use a Legacy Central personal API token."
                        : "Read from the remote controller's authtoken.secret file."}
                  </small>
                </label>
              )}
              <div className="field full switch-stack">
                <div className="switch-field">
                  <div>
                    <strong>Enabled</strong>
                    <small>
                      Disabled connections remain registered but cannot be
                      selected.
                    </small>
                  </div>
                  <label className="switch">
                    <input
                      type="checkbox"
                      checked={form.enabled}
                      onChange={(event) =>
                        setForm({ ...form, enabled: event.target.checked })
                      }
                    />
                    <span />
                  </label>
                </div>
                <div className="switch-field">
                  <div>
                    <strong>Verify TLS certificate</strong>
                    <small>
                      Keep enabled outside isolated development environments.
                    </small>
                  </div>
                  <label className="switch">
                    <input
                      type="checkbox"
                      checked={form.tlsVerify}
                      onChange={(event) =>
                        setForm({ ...form, tlsVerify: event.target.checked })
                      }
                    />
                    <span />
                  </label>
                </div>
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
              <button className="button primary" disabled={Boolean(busy)}>
                {busy ? "Saving…" : "Save connection"}
              </button>
            </div>
          </form>
        </div>
      )}
      {groupController && (
        <NetworkGroupsDialog
          controller={groupController}
          onClose={() => setGroupController(null)}
          onChanged={load}
        />
      )}
    </>
  );
}
