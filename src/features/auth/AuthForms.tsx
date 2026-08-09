"use client";

import { useState, type FormEvent } from "react";
import { ArrowLeft, Boxes, LockKeyhole, ShieldCheck } from "lucide-react";
import { api, ClientApiError, jsonRequest } from "@/lib/client-api";

function Brand() {
  return (
    <div className="auth-brand">
      <span className="brand-mark">
        <Boxes />
      </span>
      <span>
        <strong>ZT CONTROL PLANE</strong>
        <small>CONTROL PLANE</small>
      </span>
    </div>
  );
}

export function LoginForm() {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [mfaRequired, setMfaRequired] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setBusy(true);
    const form = new FormData(event.currentTarget);
    try {
      const result = await api<{
        landingPage?: string;
        mfaRequired: boolean;
      }>(
        "/api/auth/login",
        jsonRequest("POST", {
          email: form.get("email"),
          password: form.get("password"),
        }),
      );
      if (result.mfaRequired) {
        setMfaRequired(true);
        setBusy(false);
        return;
      }
      window.location.replace(result.landingPage || "/");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Sign in failed.");
      setBusy(false);
    }
  }
  async function submitMfa(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setBusy(true);
    const form = new FormData(event.currentTarget);
    try {
      const result = await api<{ landingPage: string }>(
        "/api/auth/login/2fa",
        jsonRequest("POST", { code: form.get("code") }),
      );
      window.location.replace(result.landingPage || "/");
    } catch (caught) {
      if (
        caught instanceof ClientApiError &&
        caught.code === "MFA_CHALLENGE_REQUIRED"
      )
        setMfaRequired(false);
      setError(
        caught instanceof Error ? caught.message : "Verification failed.",
      );
      setBusy(false);
    }
  }
  async function returnToPassword() {
    setBusy(true);
    setError("");
    try {
      await api("/api/auth/login/2fa", { method: "DELETE" });
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Unable to reset the sign-in step.",
      );
    } finally {
      setMfaRequired(false);
      setBusy(false);
    }
  }
  return (
    <section className="auth-card">
      <Brand />
      <span className="eyebrow">Secure access</span>
      <h1>
        {mfaRequired ? "Verify your" : "Sign in to your"}
        <br />
        {mfaRequired ? "identity." : "control plane."}
      </h1>
      <p>
        {mfaRequired
          ? "Enter the current code from Google Authenticator or another TOTP app. A recovery code also works."
          : "Manage local and remote ZeroTier controllers from one private control plane."}
      </p>
      {error && <div className="alert error">{error}</div>}
      {mfaRequired ? (
        <form className="auth-form" onSubmit={submitMfa}>
          <label className="field">
            <span>Authenticator or recovery code</span>
            <input
              className="input mono"
              name="code"
              autoComplete="one-time-code"
              placeholder="123456 or XXXX-XXXX-XXXX-XXXX"
              maxLength={80}
              required
              autoFocus
            />
          </label>
          <button className="button primary wide-button" disabled={busy}>
            <ShieldCheck />
            {busy ? "Verifying…" : "Verify and sign in"}
          </button>
          <button
            className="button secondary wide-button"
            type="button"
            disabled={busy}
            onClick={() => void returnToPassword()}
          >
            <ArrowLeft /> Use a different account
          </button>
        </form>
      ) : (
        <form className="auth-form" onSubmit={submit}>
          <label className="field">
            <span>Email</span>
            <input
              className="input"
              name="email"
              type="email"
              autoComplete="username"
              required
              autoFocus
            />
          </label>
          <label className="field">
            <span>Password</span>
            <input
              className="input"
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
          </label>
          <button className="button primary wide-button" disabled={busy}>
            <LockKeyhole />
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>
      )}
    </section>
  );
}

export function SetupForm() {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setBusy(true);
    const form = new FormData(event.currentTarget);
    if (form.get("password") !== form.get("confirm")) {
      setError("Passwords do not match.");
      setBusy(false);
      return;
    }
    try {
      const result = await api<{ landingPage: string }>(
        "/api/auth/setup",
        jsonRequest("POST", {
          setupToken: form.get("setupToken"),
          displayName: form.get("displayName"),
          email: form.get("email"),
          password: form.get("password"),
        }),
      );
      window.location.replace(result.landingPage || "/");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Setup failed.");
      setBusy(false);
    }
  }
  return (
    <section className="auth-card setup-card">
      <Brand />
      <span className="eyebrow">First-run setup</span>
      <h1>
        Create the first
        <br />
        administrator.
      </h1>
      <p>
        This account controls encrypted connections, users and security
        settings.
      </p>
      {error && <div className="alert error">{error}</div>}
      <form className="auth-form two-column" onSubmit={submit}>
        <label className="field full">
          <span>Setup token</span>
          <input
            className="input mono"
            name="setupToken"
            type="password"
            autoComplete="off"
            required
            autoFocus
          />
          <small>
            Set with APP_SETUP_TOKEN or shown in the log when setup is first
            opened.
          </small>
        </label>
        <label className="field">
          <span>Display name</span>
          <input
            className="input"
            name="displayName"
            autoComplete="name"
            required
          />
        </label>
        <label className="field">
          <span>Email</span>
          <input
            className="input"
            name="email"
            type="email"
            autoComplete="username"
            required
          />
        </label>
        <label className="field">
          <span>Password</span>
          <input
            className="input"
            name="password"
            type="password"
            minLength={12}
            autoComplete="new-password"
            required
          />
          <small>At least 12 characters.</small>
        </label>
        <label className="field">
          <span>Confirm password</span>
          <input
            className="input"
            name="confirm"
            type="password"
            minLength={12}
            autoComplete="new-password"
            required
          />
        </label>
        <button className="button primary wide-button full" disabled={busy}>
          {busy ? "Creating administrator…" : "Complete setup"}
        </button>
      </form>
      <div className="auth-note">
        Add a remote controller after setup. The optional embedded mode also
        registers its local controller automatically.
      </div>
    </section>
  );
}
