"use client";

import { X } from "lucide-react";
import type { Dispatch, FormEventHandler, SetStateAction } from "react";
import { ControllerTarget } from "@/shared/providers/ControllerContext";
import { useDialog } from "@/shared/hooks/useDialog";
import {
  dateTimeInput,
  type MemberDraft,
} from "@/features/networks/network-detail/model";
import type {
  AdapterCapabilities,
  NetworkMember,
  PublicController,
} from "@/lib/types";

const switches = [
  ["authorized", "Authorized", "Grant network access."],
  ["activeBridge", "Active bridge", "Permit Ethernet bridging."],
  ["noAutoAssignIps", "Manual IPs only", "Disable automatic assignment."],
  ["ssoExempt", "SSO exempt", "Bypass network SSO requirements."],
] as const;

interface MemberDialogProps {
  open: boolean;
  busy: boolean;
  error: string;
  canWrite: boolean;
  controller: PublicController | null | undefined;
  capabilities: AdapterCapabilities | null;
  members: NetworkMember[];
  draft: MemberDraft;
  setDraft: Dispatch<SetStateAction<MemberDraft>>;
  onClose(): void;
  onSubmit: FormEventHandler<HTMLFormElement>;
}

export function MemberDialog({
  open,
  busy,
  error,
  canWrite,
  controller,
  capabilities,
  members,
  draft,
  setDraft,
  onClose,
  onSubmit,
}: MemberDialogProps) {
  const dialogRef = useDialog<HTMLFormElement>(open, onClose, busy);
  if (!open) return null;
  const exists = members.some((item) => item.id === draft.id);
  const isMikroTik = controller?.type === "mikrotik";
  const visibleSwitches = isMikroTik
    ? switches.filter(([key]) => key === "authorized" || key === "activeBridge")
    : switches;
  const update = (value: Partial<MemberDraft>) =>
    setDraft((current) => ({ ...current, ...value }));

  return (
    <div className="modal-backdrop" onMouseDown={() => !busy && onClose()}>
      <form
        ref={dialogRef}
        className="modal wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="member-dialog-title"
        tabIndex={-1}
        onSubmit={onSubmit}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-header">
          <div>
            <span className="eyebrow">Network member</span>
            <h2 id="member-dialog-title">
              {exists ? "Member details" : "Add member"}
            </h2>
            <p>
              All stable member properties exposed by this controller are
              available here.
            </p>
            <ControllerTarget controller={controller} />
          </div>
          <button
            type="button"
            className="icon-button"
            onClick={onClose}
            aria-label="Close member dialog"
          >
            <X />
          </button>
        </div>
        <div className="modal-body section-stack">
          {error && <div className="alert error">{error}</div>}
          <div className="form-grid">
            <label className="field">
              <span>Member ID</span>
              <input
                className="input mono"
                value={draft.id}
                disabled={exists || !canWrite}
                maxLength={10}
                pattern="[0-9a-fA-F]{10}"
                required
                onChange={(event) =>
                  update({ id: event.target.value.toLowerCase() })
                }
              />
            </label>
            <label className="field">
              <span>Name</span>
              <input
                className="input"
                value={draft.name}
                disabled={!canWrite || !capabilities?.memberDetails}
                onChange={(event) => update({ name: event.target.value })}
              />
            </label>
            <label className="field full">
              <span>{isMikroTik ? "Control plane notes" : "Description"}</span>
              <textarea
                className="textarea compact"
                value={draft.description}
                disabled={!canWrite}
                onChange={(event) =>
                  update({ description: event.target.value })
                }
              />
            </label>
            {isMikroTik && (
              <label className="field full">
                <span>RouterOS comment</span>
                <input
                  className="input"
                  value={String(draft.comment || "")}
                  maxLength={512}
                  disabled={!canWrite}
                  onChange={(event) => update({ comment: event.target.value })}
                />
              </label>
            )}
            <label className="field full">
              <span>
                {isMikroTik ? "Managed IP address" : "Managed IP assignments"}
              </span>
              <input
                className="input mono"
                value={
                  isMikroTik
                    ? draft.ipAssignments?.[0] || ""
                    : (draft.ipAssignments || []).join(", ")
                }
                disabled={!canWrite || !capabilities?.memberIpAssignments}
                onChange={(event) =>
                  update({
                    ipAssignments: isMikroTik
                      ? event.target.value.trim()
                        ? [event.target.value.trim()]
                        : []
                      : event.target.value
                          .split(",")
                          .map((item) => item.trim())
                          .filter(Boolean),
                  })
                }
              />
              {isMikroTik && (
                <small>RouterOS accepts one address per member record.</small>
              )}
            </label>
            {capabilities?.memberDetails && !isMikroTik && (
              <>
                <label className="field">
                  <span>Authorization expiry</span>
                  <input
                    className="input"
                    type="datetime-local"
                    value={dateTimeInput(draft.authenticationExpiryTime)}
                    disabled={!canWrite}
                    onChange={(event) =>
                      update({
                        authenticationExpiryTime: event.target.value
                          ? new Date(event.target.value).getTime()
                          : 0,
                      })
                    }
                  />
                </label>
                <label className="field">
                  <span>Remote trace target</span>
                  <input
                    className="input mono"
                    value={String(draft.remoteTraceTarget || "")}
                    maxLength={10}
                    pattern="[0-9a-fA-F]{10}"
                    placeholder="10-character node ID"
                    disabled={!canWrite}
                    onChange={(event) =>
                      update({
                        remoteTraceTarget: event.target.value.toLowerCase(),
                      })
                    }
                  />
                </label>
                <label className="field">
                  <span>Remote trace level</span>
                  <input
                    className="input"
                    type="number"
                    min={0}
                    max={3}
                    value={Number(draft.remoteTraceLevel || 0)}
                    disabled={!canWrite}
                    onChange={(event) =>
                      update({ remoteTraceLevel: Number(event.target.value) })
                    }
                  />
                </label>
              </>
            )}
          </div>
          <div className="switch-stack">
            {visibleSwitches.map(([key, label, detail]) => (
              <div className="switch-field" key={key}>
                <div>
                  <strong>{label}</strong>
                  <small>{detail}</small>
                </div>
                <label className="switch">
                  <input
                    type="checkbox"
                    checked={Boolean(draft[key])}
                    disabled={
                      !canWrite ||
                      (!capabilities?.memberDetails && key !== "authorized")
                    }
                    onChange={(event) =>
                      update({ [key]: event.target.checked })
                    }
                  />
                  <span />
                </label>
              </div>
            ))}
            {isMikroTik && (
              <div className="switch-field">
                <div>
                  <strong>Enabled</strong>
                  <small>Keep this member record enabled in RouterOS.</small>
                </div>
                <label className="switch">
                  <input
                    type="checkbox"
                    checked={!draft.disabled}
                    disabled={!canWrite}
                    onChange={(event) =>
                      update({ disabled: !event.target.checked })
                    }
                  />
                  <span />
                </label>
              </div>
            )}
          </div>
          {capabilities?.tagsAndCapabilities && (
            <details className="advanced-disclosure">
              <summary>Capabilities and tags</summary>
              <div className="form-grid">
                <label className="field">
                  <span>Capabilities JSON</span>
                  <textarea
                    className="textarea mono"
                    value={draft.capabilitiesJson}
                    disabled={!canWrite}
                    onChange={(event) =>
                      update({ capabilitiesJson: event.target.value })
                    }
                  />
                </label>
                <label className="field">
                  <span>Tags JSON</span>
                  <textarea
                    className="textarea mono"
                    value={draft.tagsJson}
                    disabled={!canWrite}
                    onChange={(event) =>
                      update({ tagsJson: event.target.value })
                    }
                  />
                </label>
              </div>
            </details>
          )}
        </div>
        <div className="modal-footer">
          <button type="button" className="button" onClick={onClose}>
            Close
          </button>
          {canWrite && (
            <button className="button primary" disabled={busy}>
              {busy ? "Saving…" : "Save member"}
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
