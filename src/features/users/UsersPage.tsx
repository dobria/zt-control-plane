"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Check, Edit3, Plus, Trash2, Users, X } from "lucide-react";
import { api, jsonRequest } from "@/lib/client-api";
import { useAuth } from "@/shared/providers/AuthContext";
import { useDialog } from "@/shared/hooks/useDialog";
import type { AppRole, PublicUser } from "@/lib/types";

interface FormState {
  id: string;
  displayName: string;
  email: string;
  password: string;
  role: AppRole;
  disabled: boolean;
}
const empty: FormState = {
  id: "",
  displayName: "",
  email: "",
  password: "",
  role: "viewer",
  disabled: false,
};
const roleHelp: Record<AppRole, string> = {
  admin:
    "Full control of connections, users, networks, devices, backups and audit.",
  operator:
    "Can operate networks and client nodes and perform backup workflows.",
  auditor: "Read-only controller access with audit and backup export.",
  viewer: "Read-only controller, network, client and diagnostics access.",
};

export function UsersPage({ embedded = false }: { embedded?: boolean }) {
  const { user: current } = useAuth();
  const [users, setUsers] = useState<PublicUser[]>([]);
  const [form, setForm] = useState<FormState>(empty);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const userDialog = useDialog<HTMLFormElement>(
    open,
    () => setOpen(false),
    busy,
  );
  async function load() {
    try {
      setUsers((await api<{ users: PublicUser[] }>("/api/users")).users);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Unable to load users.",
      );
    }
  }
  useEffect(() => {
    void load();
  }, []);
  function edit(user?: PublicUser) {
    setForm(
      user
        ? {
            id: user.id,
            displayName: user.displayName,
            email: user.email,
            password: "",
            role: user.role,
            disabled: user.disabled,
          }
        : empty,
    );
    setOpen(true);
    setError("");
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (form.id) {
        await api<{ ok: boolean; sessionsRevoked: number }>(
          `/api/users/${form.id}`,
          jsonRequest("PUT", form),
        );
        if (form.id === current?.id && form.password) {
          window.location.replace("/login");
          return;
        }
      } else await api("/api/users", jsonRequest("POST", form));
      setOpen(false);
      await load();
      setMessage(form.id ? "User updated." : "User created.");
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Unable to save user.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function remove(user: PublicUser) {
    if (!confirm(`Delete ${user.email}? Active sessions will end immediately.`))
      return;
    try {
      await api(`/api/users/${user.id}`, { method: "DELETE" });
      await load();
      setMessage("User deleted.");
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Unable to delete user.",
      );
    }
  }
  async function resetMfa(user: PublicUser) {
    if (
      !confirm(
        `Reset two-factor authentication for ${user.email}? Their active sessions and recovery codes will be revoked.`,
      )
    )
      return;
    setBusy(true);
    setError("");
    try {
      await api(`/api/users/${user.id}/mfa`, { method: "DELETE" });
      await load();
      setOpen(false);
      setMessage("Two-factor authentication reset.");
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Unable to reset two-factor authentication.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      {embedded ? (
        <div className="settings-section-heading">
          <div>
            <span className="eyebrow">Local access control</span>
            <h2>Users & roles</h2>
            <p>Manage accounts and assign the minimum required access.</p>
          </div>
          <button className="button primary" onClick={() => edit()}>
            <Plus /> Add user
          </button>
        </div>
      ) : (
        <div className="page-heading">
          <div>
            <span className="eyebrow">Local access control</span>
            <h1>Users & roles</h1>
            <p>
              Authentication and authorization are enforced server-side for
              every protected operation.
            </p>
          </div>
          <button className="button primary" onClick={() => edit()}>
            <Plus /> Add user
          </button>
        </div>
      )}
      {error && <div className="alert error">{error}</div>}
      {message && (
        <div className="alert success">
          <Check />
          {message}
        </div>
      )}
      <div className="role-grid">
        {(Object.keys(roleHelp) as AppRole[]).map((role) => (
          <article className="role-card" key={role}>
            <span className="eyebrow">Role</span>
            <h2>{role}</h2>
            <p>{roleHelp[role]}</p>
          </article>
        ))}
      </div>
      <section className="card">
        <div className="card-header">
          <div>
            <span className="eyebrow">Accounts</span>
            <h2>
              {users.length} configured user{users.length === 1 ? "" : "s"}
            </h2>
          </div>
          <Users />
        </div>
        {users.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>User</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>2FA</th>
                  <th>Last sign in</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.id}>
                    <td>
                      <strong>
                        {user.displayName}
                        {user.id === current?.id ? " · you" : ""}
                      </strong>
                      <br />
                      <span className="muted">{user.email}</span>
                    </td>
                    <td className="capitalize">{user.role}</td>
                    <td>
                      <span
                        className={`status-pill ${user.disabled ? "offline" : ""}`}
                      >
                        {user.disabled ? "Disabled" : "Enabled"}
                      </span>
                    </td>
                    <td>
                      <span
                        className={`status-pill ${user.mfaEnabled ? "online" : ""}`}
                      >
                        {user.mfaEnabled ? "Enabled" : "Not enabled"}
                      </span>
                    </td>
                    <td>
                      {user.lastLoginAt
                        ? new Date(user.lastLoginAt).toLocaleString()
                        : "Never"}
                    </td>
                    <td>
                      <div className="actions">
                        <button
                          className="button small"
                          onClick={() => edit(user)}
                        >
                          <Edit3 /> Edit
                        </button>
                        {user.id !== current?.id && (
                          <button
                            className="icon-button danger-icon"
                            onClick={() => void remove(user)}
                            aria-label={`Delete ${user.displayName}`}
                          >
                            <Trash2 />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-state">
            <Users />
            <h2>No users</h2>
          </div>
        )}
      </section>
      {open && (
        <div
          className="modal-backdrop"
          onMouseDown={() => !busy && setOpen(false)}
        >
          <form
            ref={userDialog}
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="user-dialog-title"
            tabIndex={-1}
            onSubmit={save}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="modal-header">
              <div>
                <span className="eyebrow">Account management</span>
                <h2 id="user-dialog-title">
                  {form.id ? "Edit user" : "Add user"}
                </h2>
                <p>
                  Assign the smallest role that matches this person&apos;s work.
                </p>
              </div>
              <button
                type="button"
                className="icon-button"
                onClick={() => setOpen(false)}
                aria-label="Close user dialog"
              >
                <X />
              </button>
            </div>
            <div className="modal-body form-grid">
              <label className="field">
                <span>Display name</span>
                <input
                  className="input"
                  value={form.displayName}
                  onChange={(event) =>
                    setForm({ ...form, displayName: event.target.value })
                  }
                  required
                  autoFocus
                />
              </label>
              <label className="field">
                <span>Email</span>
                <input
                  className="input"
                  type="email"
                  value={form.email}
                  onChange={(event) =>
                    setForm({ ...form, email: event.target.value })
                  }
                  required
                />
              </label>
              <label className="field">
                <span>Role</span>
                <select
                  className="select"
                  value={form.role}
                  onChange={(event) =>
                    setForm({ ...form, role: event.target.value as AppRole })
                  }
                >
                  <option value="admin">Administrator</option>
                  <option value="operator">Operator</option>
                  <option value="auditor">Auditor</option>
                  <option value="viewer">Viewer</option>
                </select>
                <small>{roleHelp[form.role]}</small>
              </label>
              <label className="field">
                <span>Password {form.id && "(optional)"}</span>
                <input
                  className="input"
                  type="password"
                  minLength={12}
                  value={form.password}
                  onChange={(event) =>
                    setForm({ ...form, password: event.target.value })
                  }
                  required={!form.id}
                  autoComplete="new-password"
                />
                <small>
                  {form.id
                    ? "Leave blank to retain the current password."
                    : "At least 12 characters."}
                </small>
              </label>
              <div className="field full">
                <div className="switch-field">
                  <div>
                    <strong>Disable account</strong>
                    <small>Immediately blocks new and existing sessions.</small>
                  </div>
                  <label className="switch">
                    <input
                      type="checkbox"
                      checked={form.disabled}
                      disabled={form.id === current?.id}
                      onChange={(event) =>
                        setForm({ ...form, disabled: event.target.checked })
                      }
                    />
                    <span />
                  </label>
                </div>
              </div>
              {form.id !== current?.id &&
                users.find((user) => user.id === form.id)?.mfaEnabled && (
                  <div className="field full mfa-admin-reset">
                    <div>
                      <strong>Two-factor recovery</strong>
                      <small>
                        Use only when the user has lost both their authenticator
                        and recovery codes.
                      </small>
                    </div>
                    <button
                      className="button danger"
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        const target = users.find(
                          (user) => user.id === form.id,
                        );
                        if (target) void resetMfa(target);
                      }}
                    >
                      Reset 2FA
                    </button>
                  </div>
                )}
            </div>
            <div className="modal-footer">
              <button
                type="button"
                className="button"
                onClick={() => setOpen(false)}
              >
                Cancel
              </button>
              <button className="button primary" disabled={busy}>
                {busy ? "Saving…" : "Save user"}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
