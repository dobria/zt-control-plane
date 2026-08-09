"use client";

import { useEffect, useState, type FormEvent } from "react";
import {
  Check,
  Copy,
  KeyRound,
  RotateCw,
  ShieldCheck,
  ShieldOff,
} from "lucide-react";
import { api, jsonRequest } from "@/lib/client-api";

interface MfaStatus {
  enabled: boolean;
  recoveryCodesRemaining: number;
}

interface Enrollment {
  secret: string;
  expiresAt: number;
  qrCodeDataUrl: string;
}

type Stage = "overview" | "enroll" | "regenerate" | "disable" | "codes";

export function MfaProfileCard() {
  const [status, setStatus] = useState<MfaStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [stage, setStage] = useState<Stage>("overview");
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [reauthenticate, setReauthenticate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    void (async () => {
      try {
        setStatus(await api<MfaStatus>("/api/profile/mfa"));
      } catch (caught) {
        setError(
          caught instanceof Error
            ? caught.message
            : "Unable to load two-factor settings.",
        );
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function beginEnrollment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      const result = await api<Enrollment>(
        "/api/profile/mfa/setup",
        jsonRequest("POST", { password: form.get("password") }),
      );
      setEnrollment(result);
      setStage("enroll");
      setMessage("");
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Unable to start setup.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function confirmEnrollment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      const result = await api<{
        recoveryCodes: string[];
        reauthenticate: boolean;
      }>(
        "/api/profile/mfa/confirm",
        jsonRequest("POST", { code: form.get("code") }),
      );
      setStatus({ enabled: true, recoveryCodesRemaining: 10 });
      setRecoveryCodes(result.recoveryCodes);
      setReauthenticate(result.reauthenticate);
      setStage("codes");
      setEnrollment(null);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Unable to verify the authenticator code.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function regenerate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      const result = await api<{ recoveryCodes: string[] }>(
        "/api/profile/mfa/recovery",
        jsonRequest("POST", {
          password: form.get("password"),
          code: form.get("code"),
        }),
      );
      setStatus({ enabled: true, recoveryCodesRemaining: 10 });
      setRecoveryCodes(result.recoveryCodes);
      setReauthenticate(false);
      setStage("codes");
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Unable to generate recovery codes.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function disable(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      await api(
        "/api/profile/mfa",
        jsonRequest("DELETE", {
          password: form.get("password"),
          code: form.get("code"),
        }),
      );
      window.location.replace("/login");
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Unable to disable two-factor authentication.",
      );
      setBusy(false);
    }
  }

  async function copyRecoveryCodes() {
    try {
      await navigator.clipboard.writeText(recoveryCodes.join("\n"));
      setMessage("Recovery codes copied.");
    } catch {
      setError("Copy failed. Select and save the codes manually.");
    }
  }

  function resetStage() {
    setStage("overview");
    setEnrollment(null);
    setRecoveryCodes([]);
    setError("");
    setMessage("");
  }

  return (
    <section className="card profile-mfa-card">
      <div className="card-header">
        <div>
          <span className="eyebrow">Account protection</span>
          <h2>Two-factor authentication</h2>
          <p>Use Google Authenticator or any standard TOTP application.</p>
        </div>
        <ShieldCheck />
      </div>
      <div className="card-body section-stack">
        {error && <div className="alert error">{error}</div>}
        {message && (
          <div className="alert success">
            <Check /> {message}
          </div>
        )}
        {loading ? (
          <div className="mfa-status-loading">
            <span className="loading-ring" /> Loading two-factor status
          </div>
        ) : !status ? (
          <p className="muted">Two-factor status is temporarily unavailable.</p>
        ) : stage === "codes" ? (
          <div className="mfa-codes-panel">
            <div>
              <span className="status-pill online">Save these now</span>
              <h3>Recovery codes</h3>
              <p>
                Each code works once. Store them outside this control plane;
                they will not be displayed again.
              </p>
            </div>
            <div className="mfa-recovery-grid" aria-label="Recovery codes">
              {recoveryCodes.map((code) => (
                <code key={code}>{code}</code>
              ))}
            </div>
            <div className="actions">
              <button
                className="button secondary"
                type="button"
                onClick={() => void copyRecoveryCodes()}
              >
                <Copy /> Copy codes
              </button>
              {reauthenticate ? (
                <button
                  className="button primary"
                  type="button"
                  onClick={() => window.location.replace("/login")}
                >
                  Continue to sign in
                </button>
              ) : (
                <button
                  className="button primary"
                  type="button"
                  onClick={resetStage}
                >
                  I saved the codes
                </button>
              )}
            </div>
          </div>
        ) : stage === "enroll" && enrollment ? (
          <div className="mfa-enrollment">
            <div className="mfa-qr-panel">
              {/* The QR code is already a local data URL and needs no server-side optimization. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={enrollment.qrCodeDataUrl}
                alt="TOTP enrollment QR code"
                width={256}
                height={256}
              />
              <div>
                <span className="eyebrow">Step 1</span>
                <h3>Scan the QR code</h3>
                <p>
                  Open Google Authenticator, choose <strong>Add a code</strong>,
                  then scan this image.
                </p>
                <span className="field-label">Manual setup key</span>
                <code className="mfa-secret">
                  {enrollment.secret.match(/.{1,4}/g)?.join(" ")}
                </code>
                <small>
                  Setup expires at{" "}
                  {new Date(enrollment.expiresAt).toLocaleTimeString()}.
                </small>
              </div>
            </div>
            <form className="mfa-inline-form" onSubmit={confirmEnrollment}>
              <label className="field">
                <span>Step 2 · Enter the current 6-digit code</span>
                <input
                  className="input mono"
                  name="code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9 ]{6,8}"
                  maxLength={8}
                  required
                  autoFocus
                />
              </label>
              <div className="actions">
                <button className="button primary" disabled={busy}>
                  <ShieldCheck /> {busy ? "Verifying…" : "Enable 2FA"}
                </button>
                <button
                  className="button secondary"
                  type="button"
                  disabled={busy}
                  onClick={resetStage}
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        ) : stage === "regenerate" ? (
          <form className="mfa-action-form" onSubmit={regenerate}>
            <div>
              <h3>Replace recovery codes</h3>
              <p>All existing unused codes will stop working immediately.</p>
            </div>
            <label className="field">
              <span>Current password</span>
              <input
                className="input"
                name="password"
                type="password"
                autoComplete="current-password"
                required
              />
            </label>
            <label className="field">
              <span>Authenticator or recovery code</span>
              <input
                className="input mono"
                name="code"
                autoComplete="one-time-code"
                required
              />
            </label>
            <div className="actions">
              <button className="button primary" disabled={busy}>
                <RotateCw /> {busy ? "Generating…" : "Generate new codes"}
              </button>
              <button
                className="button secondary"
                type="button"
                disabled={busy}
                onClick={resetStage}
              >
                Cancel
              </button>
            </div>
          </form>
        ) : stage === "disable" ? (
          <form className="mfa-action-form" onSubmit={disable}>
            <div>
              <h3>Disable two-factor authentication</h3>
              <p>This signs your account out on every device.</p>
            </div>
            <label className="field">
              <span>Current password</span>
              <input
                className="input"
                name="password"
                type="password"
                autoComplete="current-password"
                required
              />
            </label>
            <label className="field">
              <span>Authenticator or recovery code</span>
              <input
                className="input mono"
                name="code"
                autoComplete="one-time-code"
                required
              />
            </label>
            <div className="actions">
              <button className="button danger" disabled={busy}>
                <ShieldOff /> {busy ? "Disabling…" : "Disable 2FA"}
              </button>
              <button
                className="button secondary"
                type="button"
                disabled={busy}
                onClick={resetStage}
              >
                Cancel
              </button>
            </div>
          </form>
        ) : status?.enabled ? (
          <div className="mfa-overview">
            <div>
              <span className="status-pill online">Protected</span>
              <h3>Authenticator verification is enabled</h3>
              <p>
                {status.recoveryCodesRemaining} unused recovery code
                {status.recoveryCodesRemaining === 1 ? "" : "s"} remaining.
              </p>
            </div>
            <div className="actions">
              <button
                className="button secondary"
                type="button"
                onClick={() => setStage("regenerate")}
              >
                <RotateCw /> New recovery codes
              </button>
              <button
                className="button danger"
                type="button"
                onClick={() => setStage("disable")}
              >
                <ShieldOff /> Disable
              </button>
            </div>
          </div>
        ) : (
          <form className="mfa-overview" onSubmit={beginEnrollment}>
            <div>
              <span className="status-pill">Not enabled</span>
              <h3>Add a second sign-in step</h3>
              <p>
                Your password is required before the private setup key is
                created.
              </p>
            </div>
            <label className="field mfa-password-field">
              <span>Current password</span>
              <input
                className="input"
                name="password"
                type="password"
                autoComplete="current-password"
                required
              />
            </label>
            <button className="button primary" disabled={busy}>
              <KeyRound /> {busy ? "Preparing…" : "Set up authenticator"}
            </button>
          </form>
        )}
      </div>
    </section>
  );
}
