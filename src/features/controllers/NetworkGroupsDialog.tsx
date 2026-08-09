"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Check, Edit3, FolderTree, Plus, Trash2, X } from "lucide-react";
import { api, jsonRequest } from "@/lib/client-api";
import { useAuth } from "@/shared/providers/AuthContext";
import { useDialog } from "@/shared/hooks/useDialog";
import type { NetworkGroup, PublicController } from "@/lib/types";

interface Draft {
  id: string;
  name: string;
  description: string;
}

const emptyDraft: Draft = { id: "", name: "", description: "" };

export function NetworkGroupsDialog({
  controller,
  onClose,
  onChanged,
}: {
  controller: PublicController;
  onClose(): void;
  onChanged(): Promise<void>;
}) {
  const auth = useAuth();
  const [groups, setGroups] = useState<NetworkGroup[]>([]);
  const [activeGroupId, setActiveGroupId] = useState(
    String(controller.configuration.networkGroupId || ""),
  );
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const dialogRef = useDialog<HTMLDivElement>(true, onClose, Boolean(busy));

  const load = useCallback(async (signal?: AbortSignal) => {
    const result = await api<{
      groups: NetworkGroup[];
      activeGroupId: string | null;
    }>(`/api/controllers/${controller.id}/network-groups`, { signal });
    if (signal?.aborted) return;
    setGroups(result.groups);
    setActiveGroupId(result.activeGroupId || "");
  }, [controller.id]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal).catch((caught) => {
      if (!controller.signal.aborted)
        setError(
          caught instanceof Error
            ? caught.message
            : "Unable to load network groups.",
        );
    });
    return () => controller.abort();
  }, [load]);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!draft) return;
    setBusy("save");
    setError("");
    try {
      const result = draft.id
        ? await api<{ group: NetworkGroup }>(
            `/api/controllers/${controller.id}/network-groups/${encodeURIComponent(draft.id)}`,
            jsonRequest("PUT", draft),
          )
        : await api<{ group: NetworkGroup }>(
            `/api/controllers/${controller.id}/network-groups`,
            jsonRequest("POST", draft),
          );
      if (!draft.id && !activeGroupId) {
        await api(
          `/api/controllers/${controller.id}/network-groups/${encodeURIComponent(result.group.id)}/activate`,
          { method: "POST" },
        );
      }
      setDraft(null);
      await load();
      await onChanged();
      setMessage(
        draft.id ? "Network group updated." : "Network group created.",
      );
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Unable to save network group.",
      );
    } finally {
      setBusy("");
    }
  }

  async function activate(group: NetworkGroup) {
    setBusy(group.id);
    setError("");
    try {
      await api(
        `/api/controllers/${controller.id}/network-groups/${encodeURIComponent(group.id)}/activate`,
        { method: "POST" },
      );
      await load();
      await onChanged();
      setMessage(`${group.name} is now used by Managed networks.`);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Unable to select network group.",
      );
    } finally {
      setBusy("");
    }
  }

  async function remove(group: NetworkGroup) {
    if (
      !confirm(
        `Delete network group “${group.name}” from New Central? This is a remote destructive operation and may also be rejected while the group contains networks.`,
      )
    )
      return;
    setBusy(group.id);
    setError("");
    try {
      await api(
        `/api/controllers/${controller.id}/network-groups/${encodeURIComponent(group.id)}`,
        { method: "DELETE" },
      );
      await load();
      await onChanged();
      setMessage("Network group deleted.");
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Unable to delete network group.",
      );
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={() => !busy && onClose()}>
      <div
        ref={dialogRef}
        className="modal wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="network-groups-dialog-title"
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-header">
          <div>
            <span className="eyebrow">New ZeroTier Central</span>
            <h2 id="network-groups-dialog-title">Network groups</h2>
            <p>
              {controller.name} · Organization{" "}
              {String(controller.configuration.organizationId)}
            </p>
          </div>
          <button
            type="button"
            className="icon-button"
            onClick={onClose}
            aria-label="Close network groups dialog"
          >
            <X />
          </button>
        </div>
        <div className="modal-body">
          {error && <div className="alert error">{error}</div>}
          {message && (
            <div className="alert success">
              <Check /> {message}
            </div>
          )}
          <div className="section-heading compact-heading">
            <div>
              <span className="eyebrow">Organization scope</span>
              <h3>Available groups</h3>
            </div>
            {auth.permissions.canManageControllers && !draft && (
              <button
                type="button"
                className="button small primary"
                onClick={() => setDraft(emptyDraft)}
              >
                <Plus /> Add group
              </button>
            )}
          </div>
          <div className="network-group-list">
            {groups.length === 0 ? (
              <div className="empty-state compact-empty">
                <FolderTree />
                <strong>No network groups found</strong>
                <p>Create one here or check the service account permissions.</p>
              </div>
            ) : (
              groups.map((group) => (
                <article
                  className={`network-group-row ${activeGroupId === group.id ? "active" : ""}`}
                  key={group.id}
                >
                  <div className="network-group-icon">
                    <FolderTree />
                  </div>
                  <div className="network-group-copy">
                    <div className="network-group-title">
                      <strong>{group.name}</strong>
                      {activeGroupId === group.id && (
                        <span className="active-label">USED FOR NETWORKS</span>
                      )}
                    </div>
                    <p>{group.description || "No description"}</p>
                    <code>{group.id}</code>
                  </div>
                  <div className="network-group-actions">
                    {auth.permissions.canManageControllers && (
                      <button
                        type="button"
                        className="button small primary"
                        disabled={
                          activeGroupId === group.id || busy === group.id
                        }
                        onClick={() => void activate(group)}
                      >
                        {activeGroupId === group.id ? "Selected" : "Use group"}
                      </button>
                    )}
                    {auth.permissions.canManageControllers && (
                      <>
                        <button
                          type="button"
                          className="icon-button"
                          onClick={() =>
                            setDraft({
                              id: group.id,
                              name: group.name,
                              description: group.description,
                            })
                          }
                          aria-label={`Edit ${group.name}`}
                        >
                          <Edit3 />
                        </button>
                        <button
                          type="button"
                          className="icon-button danger-icon"
                          disabled={busy === group.id}
                          onClick={() => void remove(group)}
                          aria-label={`Delete ${group.name}`}
                        >
                          <Trash2 />
                        </button>
                      </>
                    )}
                  </div>
                </article>
              ))
            )}
          </div>
          {draft && (
            <form className="network-group-form" onSubmit={save}>
              <div className="section-heading compact-heading">
                <div>
                  <span className="eyebrow">Group details</span>
                  <h3>
                    {draft.id ? "Edit network group" : "Create network group"}
                  </h3>
                </div>
              </div>
              <div className="form-grid">
                <label className="field full">
                  <span>Name</span>
                  <input
                    className="input"
                    value={draft.name}
                    onChange={(event) =>
                      setDraft({ ...draft, name: event.target.value })
                    }
                    required
                    autoFocus
                  />
                </label>
                <label className="field full">
                  <span>Description</span>
                  <textarea
                    className="textarea"
                    value={draft.description}
                    onChange={(event) =>
                      setDraft({ ...draft, description: event.target.value })
                    }
                  />
                </label>
              </div>
              <div className="inline-actions end-actions">
                <button
                  type="button"
                  className="button"
                  onClick={() => setDraft(null)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="button primary"
                  disabled={busy === "save"}
                >
                  {busy === "save" ? "Saving…" : "Save group"}
                </button>
              </div>
            </form>
          )}
        </div>
        <div className="modal-footer">
          <button type="button" className="button" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
