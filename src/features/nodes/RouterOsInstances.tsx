"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Check, Cpu, Plus, Settings2, Trash2, X } from "lucide-react";
import { api, jsonRequest } from "@/lib/client-api";
import { useDialog } from "@/shared/hooks/useDialog";
import type { RouterOsZeroTierInstance } from "@/lib/types";

interface Props {
  nodeId: string;
  instances: RouterOsZeroTierInstance[];
  hostInterfaces: string[];
  selectedName: string;
  canManage: boolean;
  editRequest?: number;
  onSelect(name: string): void;
  onReload(): Promise<void>;
  onMessage(message: string): void;
  onError(message: string): void;
}

interface FormState {
  id: string;
  name: string;
  comment: string;
  port: number;
  interfaces: string;
  routeDistance: number;
  enabled: boolean;
}

const emptyForm: FormState = {
  id: "",
  name: "",
  comment: "",
  port: 9993,
  interfaces: "all",
  routeDistance: 1,
  enabled: true,
};

function formFor(instance?: RouterOsZeroTierInstance): FormState {
  if (!instance) return emptyForm;
  return {
    id: instance.id,
    name: instance.name,
    comment: instance.comment,
    port: instance.port || 9993,
    interfaces: instance.interfaces.join(", ") || "all",
    routeDistance: instance.routeDistance || 1,
    enabled: !instance.disabled,
  };
}

function interfaceNames(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function RouterOsInstances({
  nodeId,
  instances,
  hostInterfaces,
  selectedName,
  canManage,
  editRequest = 0,
  onSelect,
  onReload,
  onMessage,
  onError,
}: Props) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [busy, setBusy] = useState(false);
  const handledEditRequest = useRef(0);
  const dialog = useDialog<HTMLFormElement>(open, () => setOpen(false), busy);
  const editingInstance = instances.find((instance) => instance.id === form.id);
  const selectedInterfaces = interfaceNames(form.interfaces);
  const usesAllInterfaces = selectedInterfaces.includes("all");
  const availableInterfaces = [
    ...new Set([
      ...hostInterfaces,
      ...selectedInterfaces.filter((name) => name !== "all"),
    ]),
  ].sort((left, right) =>
    left.localeCompare(right, undefined, { numeric: true }),
  );

  function setAllInterfaces(enabled: boolean) {
    setForm({
      ...form,
      interfaces: enabled ? "all" : availableInterfaces[0] || "",
    });
  }

  function toggleInterface(name: string, enabled: boolean) {
    const next = new Set(selectedInterfaces.filter((item) => item !== "all"));
    if (enabled) next.add(name);
    else next.delete(name);
    setForm({ ...form, interfaces: [...next].join(", ") });
  }

  function edit(instance?: RouterOsZeroTierInstance) {
    setForm(formFor(instance));
    setOpen(true);
    onError("");
  }

  useEffect(() => {
    if (!editRequest || handledEditRequest.current === editRequest) return;
    const selected = instances.find(
      (instance) => instance.name === selectedName,
    );
    if (!selected) return;
    handledEditRequest.current = editRequest;
    setForm(formFor(selected));
    setOpen(true);
    onError("");
  }, [editRequest, instances, onError, selectedName]);

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    onError("");
    try {
      const payload = {
        name: form.name,
        comment: form.comment,
        port: Number(form.port),
        interfaces: form.interfaces
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean),
        routeDistance: Number(form.routeDistance),
        enabled: form.enabled,
      };
      if (form.id) {
        await api(
          `/api/nodes/${nodeId}/instances/${encodeURIComponent(form.id)}`,
          jsonRequest("PUT", payload),
        );
      } else {
        await api(
          `/api/nodes/${nodeId}/instances`,
          jsonRequest("POST", payload),
        );
      }
      onSelect(form.name);
      setOpen(false);
      await onReload();
      onMessage(
        form.id
          ? "ZeroTier instance configuration saved."
          : "ZeroTier instance created.",
      );
    } catch (caught) {
      onError(
        caught instanceof Error
          ? caught.message
          : "Unable to save the ZeroTier instance.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function remove(instance: RouterOsZeroTierInstance) {
    if (
      !confirm(
        `Remove RouterOS ZeroTier instance ${instance.name}? RouterOS may reject this while networks or interfaces still depend on it.`,
      )
    )
      return;
    setBusy(true);
    onError("");
    try {
      await api(
        `/api/nodes/${nodeId}/instances/${encodeURIComponent(instance.id)}`,
        { method: "DELETE" },
      );
      await onReload();
      onMessage(`ZeroTier instance ${instance.name} removed.`);
    } catch (caught) {
      onError(
        caught instanceof Error
          ? caught.message
          : "Unable to remove the ZeroTier instance.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <section className="card routeros-instances-card">
        <div className="card-header">
          <div>
            <span className="eyebrow">RouterOS host</span>
            <h2>ZeroTier instances</h2>
            <p>
              Each instance is an independent ZeroTier node with its own
              identity, controller networks, client interfaces and peers.
            </p>
          </div>
          {canManage && (
            <button className="button primary" onClick={() => edit()}>
              <Plus /> Add instance
            </button>
          )}
        </div>
        {instances.length ? (
          <div className="routeros-instance-grid">
            {instances.map((instance) => {
              const selected = instance.name === selectedName;
              return (
                <article
                  className={`routeros-instance-card${selected ? " selected" : ""}`}
                  key={instance.id}
                >
                  <button
                    className="routeros-instance-main"
                    onClick={() => onSelect(instance.name)}
                    aria-pressed={selected}
                  >
                    <span className="routeros-instance-icon">
                      <Cpu />
                    </span>
                    <span className="routeros-instance-copy">
                      <span className="routeros-instance-heading">
                        <strong>{instance.name}</strong>
                        <span
                          className={`status-pill ${instance.disabled ? "disabled" : instance.online ? "" : "neutral"}`}
                        >
                          {instance.disabled
                            ? "Disabled"
                            : instance.state || "Unknown"}
                        </span>
                      </span>
                      <code>{instance.address || "Identity pending"}</code>
                      <small>
                        UDP {instance.port || "—"} · interfaces{" "}
                        {instance.interfaces.join(", ") || "—"} · route distance{" "}
                        {instance.routeDistance || "—"}
                      </small>
                      {instance.moons.length > 0 && (
                        <small>
                          {instance.moons.length} custom moon
                          {instance.moons.length === 1 ? "" : "s"}
                        </small>
                      )}
                      {instance.comment && <small>{instance.comment}</small>}
                    </span>
                    {selected && (
                      <span className="routeros-instance-selected">
                        <Check /> Selected
                      </span>
                    )}
                  </button>
                  {canManage && (
                    <div className="routeros-instance-actions">
                      <button
                        className="button small"
                        onClick={() => edit(instance)}
                      >
                        <Settings2 /> Edit
                      </button>
                      <button
                        className="button small danger"
                        disabled={busy}
                        onClick={() => void remove(instance)}
                      >
                        <Trash2 /> Remove
                      </button>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        ) : (
          <div className="empty-state compact-empty">
            <span className="empty-icon">
              <Cpu />
            </span>
            <h2>No ZeroTier instances</h2>
            <p>
              Create an instance before adding controller or client networks.
            </p>
          </div>
        )}
      </section>

      {open && (
        <div
          className="modal-backdrop"
          onMouseDown={() => !busy && setOpen(false)}
        >
          <form
            ref={dialog}
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="routeros-instance-dialog-title"
            tabIndex={-1}
            onSubmit={save}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="modal-header">
              <div>
                <span className="eyebrow">RouterOS ZeroTier</span>
                <h2 id="routeros-instance-dialog-title">
                  {form.id ? "Edit instance" : "Add instance"}
                </h2>
                <p>
                  RouterOS retains the private identity. Only safe public
                  identity and runtime details are shown here.
                </p>
              </div>
              <button
                type="button"
                className="icon-button"
                onClick={() => setOpen(false)}
                aria-label="Close instance dialog"
              >
                <X />
              </button>
            </div>
            <div className="modal-body form-grid">
              <label className="field">
                <span>Name</span>
                <input
                  className="input"
                  value={form.name}
                  maxLength={64}
                  required
                  autoFocus
                  onChange={(event) =>
                    setForm({ ...form, name: event.target.value })
                  }
                />
              </label>
              <label className="field">
                <span>UDP port</span>
                <input
                  className="input"
                  type="number"
                  min={1}
                  max={65535}
                  value={form.port}
                  required
                  onChange={(event) =>
                    setForm({ ...form, port: Number(event.target.value) })
                  }
                />
              </label>
              <label className="field">
                <span>Route distance</span>
                <input
                  className="input"
                  type="number"
                  min={1}
                  max={255}
                  value={form.routeDistance}
                  required
                  onChange={(event) =>
                    setForm({
                      ...form,
                      routeDistance: Number(event.target.value),
                    })
                  }
                />
              </label>
              <label className="field full">
                <span>Comment</span>
                <input
                  className="input"
                  value={form.comment}
                  maxLength={512}
                  onChange={(event) =>
                    setForm({ ...form, comment: event.target.value })
                  }
                />
              </label>
              <div className="switch-field full">
                <div>
                  <strong>Enabled</strong>
                  <small>Run this ZeroTier instance on the router.</small>
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
              <div className="routeros-interface-picker full">
                <div className="routeros-interface-picker-header">
                  <div>
                    <strong>RouterOS interfaces</strong>
                    <small>
                      Interfaces on which this instance can discover ZeroTier
                      peers.
                    </small>
                  </div>
                  <label className="routeros-interface-all">
                    <input
                      type="checkbox"
                      checked={usesAllInterfaces}
                      onChange={(event) =>
                        setAllInterfaces(event.target.checked)
                      }
                    />
                    <span>All interfaces</span>
                  </label>
                </div>
                {!usesAllInterfaces && availableInterfaces.length > 0 && (
                  <div className="routeros-interface-options">
                    {availableInterfaces.map((name) => (
                      <label className="routeros-interface-option" key={name}>
                        <input
                          type="checkbox"
                          checked={selectedInterfaces.includes(name)}
                          onChange={(event) =>
                            toggleInterface(name, event.target.checked)
                          }
                        />
                        <span>{name}</span>
                      </label>
                    ))}
                  </div>
                )}
                {!usesAllInterfaces && availableInterfaces.length === 0 && (
                  <label className="field routeros-interface-fallback">
                    <span>Interface names</span>
                    <input
                      className="input"
                      value={form.interfaces}
                      placeholder="bridge, ether1"
                      required
                      onChange={(event) =>
                        setForm({ ...form, interfaces: event.target.value })
                      }
                    />
                    <small>
                      Interface discovery is unavailable. Enter a
                      comma-separated list.
                    </small>
                  </label>
                )}
                {!usesAllInterfaces &&
                  availableInterfaces.length > 0 &&
                  selectedInterfaces.length === 0 && (
                    <small className="field-error">
                      Select at least one interface.
                    </small>
                  )}
              </div>
              {editingInstance && (
                <div className="routeros-runtime full">
                  <div className="routeros-runtime-heading">
                    <div>
                      <strong>Runtime identity</strong>
                      <small>Read-only values reported by RouterOS.</small>
                    </div>
                    <span
                      className={`status-pill ${editingInstance.disabled ? "disabled" : editingInstance.online ? "" : "neutral"}`}
                    >
                      {editingInstance.disabled
                        ? "Disabled"
                        : editingInstance.state || "Unknown"}
                    </span>
                  </div>
                  <div className="routeros-runtime-grid">
                    <div>
                      <span>Node ID</span>
                      <code>{editingInstance.address || "Pending"}</code>
                    </div>
                    <div>
                      <span>Public identity</span>
                      <code>
                        {editingInstance.identityPublic || "Not reported"}
                      </code>
                    </div>
                    <div className="routeros-runtime-moons">
                      <span>Moons</span>
                      {editingInstance.moons.length ? (
                        <div className="routeros-runtime-list">
                          {editingInstance.moons.map((moon) => (
                            <code key={moon}>{moon}</code>
                          ))}
                        </div>
                      ) : (
                        <small>No custom moon roots reported.</small>
                      )}
                    </div>
                  </div>
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
              <button
                className="button primary"
                disabled={busy || selectedInterfaces.length === 0}
              >
                {busy ? "Saving…" : "Save instance"}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
