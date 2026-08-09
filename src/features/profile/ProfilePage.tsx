"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Check, KeyRound, MonitorCog, UserRound } from "lucide-react";
import { api, jsonRequest } from "@/lib/client-api";
import { useAuth } from "@/shared/providers/AuthContext";
import { MfaProfileCard } from "@/features/auth/MfaProfileCard";
import type { PublicUser } from "@/lib/types";

interface ProfileForm {
  displayName: string;
  email: string;
  landingPage: PublicUser["landingPage"];
  reducedMotion: boolean;
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}

export function ProfilePage() {
  const { user, refresh } = useAuth();
  const [form, setForm] = useState<ProfileForm | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!user) return;
    setForm({
      displayName: user.displayName,
      email: user.email,
      landingPage: user.landingPage,
      reducedMotion: user.reducedMotion,
      currentPassword: "",
      newPassword: "",
      confirmPassword: "",
    });
  }, [user]);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!form) return;
    if (form.newPassword !== form.confirmPassword) {
      setError("New passwords do not match.");
      return;
    }
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await api<{
        user: PublicUser;
        reauthenticate: boolean;
      }>(
        "/api/profile",
        jsonRequest("PUT", {
          displayName: form.displayName,
          email: form.email,
          landingPage: form.landingPage,
          reducedMotion: form.reducedMotion,
          currentPassword: form.currentPassword,
          newPassword: form.newPassword,
        }),
      );
      if (result.reauthenticate) {
        window.location.replace("/login");
        return;
      }
      await refresh({ silent: true });
      setForm({
        displayName: result.user.displayName,
        email: result.user.email,
        landingPage: result.user.landingPage,
        reducedMotion: result.user.reducedMotion,
        currentPassword: "",
        newPassword: "",
        confirmPassword: "",
      });
      setMessage("Profile saved.");
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Unable to save profile.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (!user || !form) return null;

  return (
    <>
      <div className="page-heading compact-heading">
        <div>
          <span className="eyebrow">Personal account</span>
          <h1>Your profile</h1>
          <p>
            Manage your identity, sign-in credentials and interface preferences.
          </p>
        </div>
        <UserRound />
      </div>
      {error && <div className="alert error">{error}</div>}
      {message && (
        <div className="alert success">
          <Check /> {message}
        </div>
      )}
      <section className="profile-summary card">
        <div className="profile-avatar">
          {user.displayName.slice(0, 1).toUpperCase()}
        </div>
        <div>
          <span className="eyebrow">Signed-in account</span>
          <h2>{user.displayName}</h2>
          <p>{user.email}</p>
        </div>
        <dl className="profile-meta">
          <div>
            <dt>Role</dt>
            <dd className="capitalize">{user.role}</dd>
          </div>
          <div>
            <dt>Last sign in</dt>
            <dd>
              {user.lastLoginAt
                ? new Date(user.lastLoginAt).toLocaleString()
                : "Current session"}
            </dd>
          </div>
          <div>
            <dt>User ID</dt>
            <dd className="mono">{user.id}</dd>
          </div>
        </dl>
      </section>
      <MfaProfileCard />
      <form className="profile-grid" onSubmit={save}>
        <section className="card">
          <div className="card-header">
            <div>
              <span className="eyebrow">Account details</span>
              <h2>Identity</h2>
              <p>Your role can only be changed by an administrator.</p>
            </div>
            <UserRound />
          </div>
          <div className="card-body form-grid">
            <label className="field">
              <span>Display name</span>
              <input
                className="input"
                value={form.displayName}
                onChange={(event) =>
                  setForm({ ...form, displayName: event.target.value })
                }
                required
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
              <small>Changing your email requires the current password.</small>
            </label>
          </div>
        </section>
        <section className="card">
          <div className="card-header">
            <div>
              <span className="eyebrow">Interface defaults</span>
              <h2>Experience</h2>
              <p>These preferences apply only to your account.</p>
            </div>
            <MonitorCog />
          </div>
          <div className="card-body section-stack">
            <label className="field">
              <span>Page after sign in</span>
              <select
                className="select"
                value={form.landingPage}
                onChange={(event) =>
                  setForm({
                    ...form,
                    landingPage: event.target
                      .value as PublicUser["landingPage"],
                  })
                }
              >
                <option value="/">Overview</option>
                <option value="/controllers">Controllers</option>
                <option value="/nodes">Nodes</option>
                <option value="/networks">Networks</option>
                <option value="/diagnostics">Diagnostics</option>
              </select>
            </label>
            <div className="switch-field">
              <div>
                <strong>Reduce motion</strong>
                <small>Minimize decorative animation and transitions.</small>
              </div>
              <label className="switch">
                <input
                  type="checkbox"
                  checked={form.reducedMotion}
                  onChange={(event) =>
                    setForm({ ...form, reducedMotion: event.target.checked })
                  }
                />
                <span />
              </label>
            </div>
          </div>
        </section>
        <section className="card profile-wide-card">
          <div className="card-header">
            <div>
              <span className="eyebrow">Authentication</span>
              <h2>Change password</h2>
              <p>Changing it signs your account out on every device.</p>
            </div>
            <KeyRound />
          </div>
          <div className="card-body form-grid profile-password-grid">
            <label className="field">
              <span>Current password</span>
              <input
                className="input"
                type="password"
                autoComplete="current-password"
                value={form.currentPassword}
                required={
                  Boolean(form.newPassword) || form.email !== user.email
                }
                onChange={(event) =>
                  setForm({ ...form, currentPassword: event.target.value })
                }
              />
            </label>
            <label className="field">
              <span>New password</span>
              <input
                className="input"
                type="password"
                minLength={12}
                autoComplete="new-password"
                value={form.newPassword}
                onChange={(event) =>
                  setForm({ ...form, newPassword: event.target.value })
                }
              />
              <small>Leave blank to retain the current password.</small>
            </label>
            <label className="field">
              <span>Confirm new password</span>
              <input
                className="input"
                type="password"
                minLength={12}
                autoComplete="new-password"
                value={form.confirmPassword}
                required={Boolean(form.newPassword)}
                onChange={(event) =>
                  setForm({ ...form, confirmPassword: event.target.value })
                }
              />
            </label>
          </div>
        </section>
        <div className="settings-actions profile-wide-card">
          <button className="button primary" disabled={busy}>
            {busy ? "Saving…" : "Save profile"}
          </button>
        </div>
      </form>
    </>
  );
}
