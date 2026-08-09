"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo, useState, type FormEvent } from "react";
import {
  Check,
  ChevronLeft,
  Cpu,
  Globe2,
  LogIn,
  LogOut,
  Plus,
  Settings2,
  Trash2,
  X,
} from "lucide-react";
import { api, jsonRequest } from "@/lib/client-api";
import { useAuth } from "@/shared/providers/AuthContext";
import {
  ControllerContext,
  ControllerTarget,
  useSynchronizeControllerScope,
} from "@/shared/providers/ControllerContext";
import { useAutoRefresh } from "@/shared/hooks/useAutoRefresh";
import { useDialog } from "@/shared/hooks/useDialog";
import { RouterOsInstances } from "@/features/nodes/RouterOsInstances";
import { RouterOsInstanceWorkspace } from "@/features/nodes/RouterOsInstanceWorkspace";
import { resolveActiveNode } from "@/lib/active-node";
import {
  instanceWorkspaceQuery,
  normalizeInstanceWorkspaceView,
  type InstanceWorkspaceView,
} from "@/lib/routeros-workspace";
import type {
  AdapterCapabilities,
  ClientNetwork,
  ManagedNetwork,
  Moon,
  RouterOsZeroTierInstance,
  ZeroTierPeer,
} from "@/lib/types";

interface FormState {
  instance: string;
  networkId: string;
  name: string;
  comment: string;
  enabled: boolean;
  vrf: string;
  arpTimeout: string;
  disableRunningCheck: boolean;
  allowManaged: boolean;
  allowDefault: boolean;
  allowGlobal: boolean;
  allowDNS: boolean;
}
const empty: FormState = {
  instance: "",
  networkId: "",
  name: "",
  comment: "",
  enabled: true,
  vrf: "main",
  arpTimeout: "auto",
  disableRunningCheck: false,
  allowManaged: true,
  allowDefault: false,
  allowGlobal: false,
  allowDNS: false,
};

const emptyMoon = { worldId: "", seed: "" };

function relativeTime(timestamp: number | null) {
  if (!timestamp) return "Never";
  const elapsed = Math.max(0, Date.now() - timestamp);
  if (elapsed < 1_000) return "Just now";
  if (elapsed < 60_000) return `${Math.floor(elapsed / 1_000)}s ago`;
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)}m ago`;
  return new Date(timestamp).toLocaleString();
}

export function DevicesPage({ controllerId }: { controllerId: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { nodes, permissions, user, settings } = useAuth();
  const controller = useSynchronizeControllerScope(controllerId);
  const activeNode = resolveActiveNode(nodes, controllerId, user?.activeNodeId);
  const [networks, setNetworks] = useState<ClientNetwork[]>([]);
  const [capabilities, setCapabilities] = useState<AdapterCapabilities | null>(
    null,
  );
  const [moons, setMoons] = useState<Moon[]>([]);
  const [planetRoots, setPlanetRoots] = useState<ZeroTierPeer[]>([]);
  const [peers, setPeers] = useState<ZeroTierPeer[]>([]);
  const [instances, setInstances] = useState<RouterOsZeroTierInstance[]>([]);
  const [controlledNetworks, setControlledNetworks] = useState<
    ManagedNetwork[]
  >([]);
  const [hostInterfaces, setHostInterfaces] = useState<string[]>([]);
  const [vrfs, setVrfs] = useState<string[]>([]);
  const [selectedInstance, setSelectedInstance] = useState("");
  const [instanceEditRequest, setInstanceEditRequest] = useState(0);
  const [form, setForm] = useState<FormState>(empty);
  const [open, setOpen] = useState(false);
  const [moonOpen, setMoonOpen] = useState(false);
  const [moonForm, setMoonForm] = useState(emptyMoon);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const networkDialog = useDialog<HTMLFormElement>(
    open,
    () => setOpen(false),
    busy,
  );
  const moonDialog = useDialog<HTMLFormElement>(
    moonOpen,
    () => setMoonOpen(false),
    busy,
  );
  const requestedInstance = searchParams.get("instance") || "";
  const instanceView = normalizeInstanceWorkspaceView(searchParams.get("view"));
  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!activeNode) return;
      setError("");
      try {
        const result = await api<{
          networks: ClientNetwork[];
          vrfs: string[];
          capabilities: AdapterCapabilities;
        }>(`/api/nodes/${activeNode.id}/client-networks`, { signal });
        if (signal?.aborted) return;
        setNetworks(result.networks);
        setVrfs(result.vrfs || []);
        setCapabilities(result.capabilities);
        if (activeNode.type === "mikrotik") {
          const [instanceResult, controllerResult] = await Promise.all([
            api<{
              instances: RouterOsZeroTierInstance[];
              hostInterfaces: string[];
            }>(`/api/nodes/${activeNode.id}/instances`, { signal }),
            api<{ networks: ManagedNetwork[] }>(
              `/api/controllers/${controllerId}/networks`,
              { signal },
            ),
          ]);
          if (signal?.aborted) return;
          setInstances(instanceResult.instances);
          setHostInterfaces(instanceResult.hostInterfaces || []);
          setControlledNetworks(controllerResult.networks || []);
          setSelectedInstance((current) => {
            if (
              requestedInstance &&
              instanceResult.instances.some(
                (item) => item.name === requestedInstance,
              )
            )
              return requestedInstance;
            if (instanceResult.instances.some((item) => item.name === current))
              return current;
            return (
              instanceResult.instances.find(
                (item) => !item.disabled && item.state === "running",
              )?.name ||
              instanceResult.instances.find((item) => !item.disabled)?.name ||
              instanceResult.instances[0]?.name ||
              ""
            );
          });
        } else {
          setInstances([]);
          setControlledNetworks([]);
          setHostInterfaces([]);
          setSelectedInstance("");
        }
        if (result.capabilities.moons || result.capabilities.peers) {
          const moonResult = await api<{
            moons: Moon[];
            planetRoots: ZeroTierPeer[];
            peers: ZeroTierPeer[];
          }>(`/api/nodes/${activeNode.id}/moons`, { signal });
          if (signal?.aborted) return;
          setMoons(moonResult.moons);
          setPlanetRoots(moonResult.planetRoots);
          setPeers(moonResult.peers || []);
        } else {
          setMoons([]);
          setPlanetRoots([]);
          setPeers([]);
        }
      } catch (caught) {
        if (signal?.aborted) return;
        setError(
          caught instanceof Error
            ? caught.message
            : "Unable to load client networks.",
        );
      }
    },
    [activeNode, controllerId, requestedInstance],
  );
  useAutoRefresh(load, {
    intervalMs: settings.refreshSeconds * 1000,
    refreshKey: activeNode?.id,
  });
  const visibleNetworks = useMemo(
    () =>
      activeNode?.type === "mikrotik"
        ? networks.filter((network) => network.instance === selectedInstance)
        : networks,
    [activeNode?.type, networks, selectedInstance],
  );
  const visiblePeers = useMemo(
    () => peers.filter((peer) => peer.instance === selectedInstance),
    [peers, selectedInstance],
  );
  const visibleControlledNetworks = useMemo(
    () =>
      controlledNetworks.filter(
        (network) => network.instance === selectedInstance,
      ),
    [controlledNetworks, selectedInstance],
  );
  const selectedInstanceRecord = instances.find(
    (instance) => instance.name === selectedInstance,
  );
  const availableVrfs = useMemo(
    () => [...new Set(["main", form.vrf, ...vrfs].filter(Boolean))],
    [form.vrf, vrfs],
  );
  const editingInterface = networks.find(
    (item) =>
      item.id === form.networkId &&
      (activeNode?.type !== "mikrotik" || item.instance === form.instance),
  );
  const editingNetwork = Boolean(editingInterface);
  function updateWorkspaceUrl(
    instance: string,
    view: InstanceWorkspaceView = instanceView,
  ) {
    const query = instanceWorkspaceQuery(searchParams, instance, view);
    router.replace(`?${query}`, { scroll: false });
  }
  function selectInstance(name: string) {
    setSelectedInstance(name);
    updateWorkspaceUrl(name);
  }
  function selectInstanceView(view: InstanceWorkspaceView) {
    updateWorkspaceUrl(selectedInstance, view);
  }
  function edit(network?: ClientNetwork) {
    setForm(
      network
        ? {
            instance: network.instance || selectedInstance,
            networkId: network.id,
            name: network.name,
            comment: network.comment || "",
            enabled: network.disabled !== true,
            vrf: network.vrf || "main",
            arpTimeout: network.arpTimeout || "auto",
            disableRunningCheck: Boolean(network.disableRunningCheck),
            allowManaged: network.allowManaged !== false,
            allowDefault: Boolean(network.allowDefault),
            allowGlobal: Boolean(network.allowGlobal),
            allowDNS: Boolean(network.allowDNS),
          }
        : { ...empty, instance: selectedInstance },
    );
    setOpen(true);
    setError("");
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!activeNode) return;
    setBusy(true);
    setError("");
    try {
      const payload =
        activeNode.type === "mikrotik"
          ? form
          : {
              networkId: form.networkId,
              allowManaged: form.allowManaged,
              allowDefault: form.allowDefault,
              allowGlobal: form.allowGlobal,
              allowDNS: form.allowDNS,
            };
      if (
        networks.some(
          (item) =>
            item.id === form.networkId &&
            (activeNode.type !== "mikrotik" || item.instance === form.instance),
        )
      )
        await api(
          `/api/nodes/${activeNode.id}/client-networks/${form.networkId}`,
          jsonRequest("PUT", payload),
        );
      else
        await api(
          `/api/nodes/${activeNode.id}/client-networks`,
          jsonRequest("POST", payload),
        );
      setOpen(false);
      await load();
      setMessage("Client network configuration saved.");
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Unable to save client network.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function leave(network: ClientNetwork) {
    if (
      !activeNode ||
      !confirm(
        `Leave ZeroTier network ${network.id} on ${activeNode.name} through ${controller?.name || controllerId}?`,
      )
    )
      return;
    try {
      const instanceQuery = network.instance
        ? `?instance=${encodeURIComponent(network.instance)}`
        : "";
      await api(
        `/api/nodes/${activeNode.id}/client-networks/${network.id}${instanceQuery}`,
        { method: "DELETE" },
      );
      await load();
      setMessage("The node left the network.");
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Unable to leave network.",
      );
    }
  }
  async function orbitMoon(event: FormEvent) {
    event.preventDefault();
    if (!activeNode) return;
    setBusy(true);
    setError("");
    try {
      await api(
        `/api/nodes/${activeNode.id}/moons`,
        jsonRequest("POST", moonForm),
      );
      setMoonOpen(false);
      setMoonForm(emptyMoon);
      await load();
      setMessage("Moon orbit request saved. Discovery may take a moment.");
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Unable to orbit moon.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function deorbitMoon(moon: Moon) {
    if (
      !activeNode ||
      !confirm(
        `Stop orbiting moon ${moon.id} on ${activeNode.name} through ${controller?.name || controllerId}?`,
      )
    )
      return;
    setBusy(true);
    setError("");
    try {
      await api(`/api/nodes/${activeNode.id}/moons/${moon.id}`, {
        method: "DELETE",
      });
      await load();
      setMessage("The node stopped orbiting the moon.");
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Unable to deorbit moon.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <ControllerContext
        controller={controller}
        section="Node management"
        node={activeNode}
      />
      <div className="page-heading">
        <div>
          <Link className="context-back" href="/controllers">
            <ChevronLeft /> Controllers
          </Link>
          <span className="eyebrow">{controller?.name || "Controller"}</span>
          <h1>Node management</h1>
          <p>
            {!activeNode
              ? "This controller does not expose a managed ZeroTier client connection."
              : activeNode.type === "mikrotik"
                ? "Select and manage a RouterOS ZeroTier instance, its client networks and peers."
                : "Join this ZeroTier One node to networks and control route acceptance."}
          </p>
        </div>
        <div className="page-actions">
          {permissions.canWriteDevices &&
            activeNode?.type !== "mikrotik" &&
            capabilities?.clientNetworks !== false && (
              <button className="button primary" onClick={() => edit()}>
                <LogIn /> Join network
              </button>
            )}
        </div>
      </div>
      {error && <div className="alert error">{error}</div>}
      {message && (
        <div className="alert success">
          <Check />
          {message}
        </div>
      )}
      {!activeNode && (
        <section className="card">
          <div className="empty-state">
            <span className="empty-icon">
              <Cpu />
            </span>
            <h2>Node management is unavailable</h2>
            <p>
              ZeroTier Central manages networks and their members, but it does
              not provide access to the client service running on those devices.
            </p>
            <Link className="button" href="/controllers">
              Back to controllers
            </Link>
          </div>
        </section>
      )}
      {activeNode && (
        <>
          {activeNode.type === "mikrotik" && (
            <RouterOsInstances
              nodeId={activeNode.id}
              instances={instances}
              hostInterfaces={hostInterfaces}
              selectedName={selectedInstance}
              canManage={permissions.canManageControllers}
              editRequest={instanceEditRequest}
              onSelect={selectInstance}
              onReload={() => load()}
              onMessage={setMessage}
              onError={setError}
            />
          )}
          {activeNode.type === "mikrotik" && (
            <RouterOsInstanceWorkspace
              controllerId={controllerId}
              instance={selectedInstanceRecord}
              controlledNetworks={visibleControlledNetworks}
              joinedNetworks={visibleNetworks}
              peers={visiblePeers}
              view={instanceView}
              canWriteDevices={permissions.canWriteDevices}
              canManageInstances={permissions.canManageControllers}
              onView={selectInstanceView}
              onJoin={() => edit()}
              onEditNetwork={edit}
              onLeave={(network) => void leave(network)}
              onEditInstance={() =>
                setInstanceEditRequest((request) => request + 1)
              }
            />
          )}
          {activeNode.type !== "mikrotik" && (
            <section className="card">
              <div className="card-header">
                <div>
                  <span className="eyebrow">Active node</span>
                  <h2>{activeNode.name}</h2>
                  <p>ZeroTier One joined networks</p>
                </div>
                <Cpu />
              </div>
              {visibleNetworks.length ? (
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Network</th>
                        <th>Status</th>
                        <th>Assigned addresses</th>
                        <th>Managed</th>
                        <th>Default</th>
                        <th>Global</th>
                        {capabilities?.clientDns && <th>DNS</th>}
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleNetworks.map((network) => (
                        <tr key={`${network.instance || "node"}:${network.id}`}>
                          <td>
                            <strong>{network.name}</strong>
                            {network.comment && (
                              <small className="table-secondary">
                                {network.comment}
                              </small>
                            )}
                            <br />
                            <code>{network.id}</code>
                          </td>
                          <td>
                            <span
                              className={`status-pill ${network.disabled ? "disabled" : ["OK", "ONLINE"].includes(network.status.toUpperCase()) ? "" : "neutral"}`}
                            >
                              {network.status}
                            </span>
                          </td>
                          <td className="mono">
                            {network.assignedAddresses?.join(", ") || "—"}
                          </td>
                          <td>{network.allowManaged ? "Yes" : "No"}</td>
                          <td>{network.allowDefault ? "Yes" : "No"}</td>
                          <td>{network.allowGlobal ? "Yes" : "No"}</td>
                          {capabilities?.clientDns && (
                            <td>{network.allowDNS ? "Yes" : "No"}</td>
                          )}
                          <td>
                            <div className="actions">
                              {permissions.canWriteDevices && (
                                <>
                                  <button
                                    className="button small"
                                    onClick={() => edit(network)}
                                  >
                                    <Settings2 /> Edit
                                  </button>
                                  <button
                                    className="button small danger"
                                    onClick={() => void leave(network)}
                                  >
                                    <LogOut /> Leave
                                  </button>
                                </>
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
                  <span className="empty-icon">
                    <Cpu />
                  </span>
                  <h2>No joined networks</h2>
                  <p>
                    This node is not currently operating as a ZeroTier client on
                    any network.
                  </p>
                  {permissions.canWriteDevices && (
                    <button className="button primary" onClick={() => edit()}>
                      <LogIn /> Join first network
                    </button>
                  )}
                </div>
              )}
            </section>
          )}
          {activeNode.type !== "mikrotik" &&
            (capabilities?.moons || capabilities?.peers) && (
              <section className="card devices-moons-card">
                <div className="card-header">
                  <div>
                    <span className="eyebrow">Peer discovery</span>
                    <h2>Root infrastructure</h2>
                    <p>
                      Live standard Planet connectivity and optional custom Moon
                      roots for this node.
                    </p>
                  </div>
                  {capabilities?.moons && permissions.canWriteDevices && (
                    <button
                      className="button primary"
                      onClick={() => setMoonOpen(true)}
                    >
                      <Plus /> Orbit moon
                    </button>
                  )}
                </div>
                <div className="root-infrastructure">
                  <section className="root-group">
                    <div className="root-group-header">
                      <div>
                        <span className="eyebrow">
                          ZeroTier managed · read only
                        </span>
                        <h3>Planet roots</h3>
                        <p>
                          Standard global roots currently visible to the active
                          node.
                        </p>
                      </div>
                      <span className="status-pill neutral">
                        {planetRoots.length} detected
                      </span>
                    </div>
                    {planetRoots.length ? (
                      <div className="table-wrap">
                        <table className="table">
                          <thead>
                            <tr>
                              <th>Root node</th>
                              <th>Connection</th>
                              <th>Latency</th>
                              <th>Active endpoint</th>
                              <th>Last receive</th>
                            </tr>
                          </thead>
                          <tbody>
                            {planetRoots.map((peer) => {
                              const activePath =
                                peer.paths.find(
                                  (path) => path.active && path.preferred,
                                ) || peer.paths.find((path) => path.active);
                              const connection = peer.tunneled
                                ? "Tunneled"
                                : activePath
                                  ? "Direct"
                                  : "No direct path";
                              return (
                                <tr key={peer.address}>
                                  <td>
                                    <strong className="mono">
                                      {peer.address}
                                    </strong>
                                  </td>
                                  <td>
                                    <span
                                      className={`status-pill ${activePath ? "" : "neutral"}`}
                                    >
                                      {connection}
                                    </span>
                                  </td>
                                  <td>
                                    {peer.latency === null
                                      ? "—"
                                      : `${peer.latency} ms`}
                                  </td>
                                  <td className="mono">
                                    {activePath?.address || "—"}
                                  </td>
                                  <td>
                                    {relativeTime(
                                      activePath?.lastReceive || null,
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <div className="empty-inline">
                        No standard Planet roots are currently reported by this
                        node.
                      </div>
                    )}
                  </section>

                  <section className="root-group">
                    <div className="root-group-header">
                      <div>
                        <span className="eyebrow">User-operated roots</span>
                        <h3>Custom moons</h3>
                        <p>
                          Supplementary root sets retained for existing
                          deployments.
                        </p>
                      </div>
                      <span className="status-pill neutral">
                        {moons.length} configured
                      </span>
                    </div>
                    {moons.length ? (
                      <div className="table-wrap">
                        <table className="table">
                          <thead>
                            <tr>
                              <th>World ID</th>
                              <th>Status</th>
                              <th>Roots</th>
                              <th>Stable endpoints</th>
                              <th></th>
                            </tr>
                          </thead>
                          <tbody>
                            {moons.map((moon) => {
                              const endpoints = (moon.roots || []).flatMap(
                                (root) => root.stableEndpoints || [],
                              );
                              return (
                                <tr key={moon.id}>
                                  <td>
                                    <strong className="mono">{moon.id}</strong>
                                  </td>
                                  <td>
                                    <span
                                      className={`status-pill ${moon.waiting ? "neutral" : ""}`}
                                    >
                                      {moon.waiting ? "Discovering" : "Active"}
                                    </span>
                                  </td>
                                  <td>{moon.roots?.length || 0}</td>
                                  <td className="mono">
                                    {endpoints.join(", ") ||
                                      "Waiting for world data"}
                                  </td>
                                  <td>
                                    {permissions.canWriteDevices && (
                                      <button
                                        className="icon-button danger-icon"
                                        disabled={busy}
                                        onClick={() => void deorbitMoon(moon)}
                                        aria-label={`Deorbit moon ${moon.id}`}
                                      >
                                        <Trash2 />
                                      </button>
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <div className="empty-state compact-empty">
                        <span className="empty-icon">
                          <Globe2 />
                        </span>
                        <h2>No custom moons configured</h2>
                        <p>
                          This node is connected through the standard ZeroTier
                          Planet roots shown above.
                        </p>
                      </div>
                    )}
                  </section>
                </div>
              </section>
            )}
        </>
      )}
      {open && (
        <div
          className="modal-backdrop"
          onMouseDown={() => !busy && setOpen(false)}
        >
          <form
            ref={networkDialog}
            className="modal wide"
            role="dialog"
            aria-modal="true"
            aria-labelledby="client-network-dialog-title"
            tabIndex={-1}
            onSubmit={save}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="modal-header">
              <div>
                <span className="eyebrow">Client configuration</span>
                <h2 id="client-network-dialog-title">
                  {editingNetwork ? "Edit joined network" : "Join network"}
                </h2>
                <p>
                  Controller authorization may still be required after the join
                  request.
                </p>
                <ControllerTarget controller={controller} node={activeNode} />
              </div>
              <button
                type="button"
                className="icon-button"
                onClick={() => setOpen(false)}
                aria-label="Close client network dialog"
              >
                <X />
              </button>
            </div>
            <div className="modal-body form-grid">
              {activeNode?.type === "mikrotik" && (
                <label className="field full">
                  <span>ZeroTier instance</span>
                  <select
                    className="select"
                    value={form.instance}
                    disabled={editingNetwork}
                    required
                    onChange={(event) =>
                      setForm({ ...form, instance: event.target.value })
                    }
                  >
                    {!instances.length && (
                      <option value="">No instances available</option>
                    )}
                    {instances.map((instance) => (
                      <option
                        key={instance.id}
                        value={instance.name}
                        disabled={instance.disabled}
                      >
                        {instance.name}
                        {instance.disabled ? " · disabled" : ""}
                      </option>
                    ))}
                  </select>
                  <small>
                    The client interface is owned by this RouterOS ZeroTier
                    instance.
                  </small>
                </label>
              )}
              <label className="field full">
                <span>Network ID</span>
                <input
                  className="input mono"
                  value={form.networkId}
                  disabled={editingNetwork}
                  maxLength={16}
                  pattern="[0-9a-fA-F]{16}"
                  onChange={(event) =>
                    setForm({
                      ...form,
                      networkId: event.target.value.toLowerCase(),
                    })
                  }
                  required
                  autoFocus
                />
              </label>
              {activeNode?.type === "mikrotik" && (
                <>
                  <div className="field full subsection-heading">
                    <div>
                      <span className="eyebrow">RouterOS interface</span>
                      <strong>General settings</strong>
                    </div>
                  </div>
                  <div className="field full switch-stack">
                    <div className="switch-field">
                      <div>
                        <strong>Enabled</strong>
                        <small>
                          Allow this RouterOS interface to run and join the
                          network.
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
                  </div>
                  <label className="field">
                    <span>Interface name</span>
                    <input
                      className="input"
                      value={form.name}
                      maxLength={128}
                      onChange={(event) =>
                        setForm({ ...form, name: event.target.value })
                      }
                    />
                  </label>
                  <label className="field">
                    <span>VRF</span>
                    <select
                      className="select"
                      value={form.vrf}
                      required
                      onChange={(event) =>
                        setForm({ ...form, vrf: event.target.value })
                      }
                    >
                      {availableVrfs.map((vrf) => (
                        <option key={vrf} value={vrf}>
                          {vrf}
                        </option>
                      ))}
                    </select>
                    <small>Available VRFs are loaded from RouterOS.</small>
                  </label>
                  <label className="field full">
                    <span>Comment</span>
                    <input
                      className="input"
                      value={form.comment}
                      maxLength={512}
                      placeholder="Optional description"
                      onChange={(event) =>
                        setForm({ ...form, comment: event.target.value })
                      }
                    />
                  </label>
                  <label className="field">
                    <span>ARP timeout</span>
                    <input
                      className="input mono"
                      value={form.arpTimeout}
                      maxLength={64}
                      placeholder="auto, 30s or 5m"
                      required
                      onChange={(event) =>
                        setForm({ ...form, arpTimeout: event.target.value })
                      }
                    />
                    <small>
                      Use auto or a RouterOS time value such as 30s or 5m.
                    </small>
                  </label>
                  {editingInterface && (
                    <>
                      <label className="field">
                        <span>Type</span>
                        <input
                          className="input"
                          value={editingInterface.type || "ZeroTier"}
                          disabled
                        />
                        <small>Read-only RouterOS interface type.</small>
                      </label>
                      <label className="field">
                        <span>MTU / actual MTU</span>
                        <input
                          className="input mono"
                          value={`${editingInterface.mtu || "—"} / ${editingInterface.actualMtu || "—"}`}
                          disabled
                        />
                        <small>Runtime values reported by RouterOS.</small>
                      </label>
                    </>
                  )}
                  <div className="field full switch-stack">
                    <div className="switch-field">
                      <div>
                        <strong>Disable running check</strong>
                        <small>
                          Force the interface into running state when RouterOS
                          cannot determine link state automatically.
                        </small>
                      </div>
                      <label className="switch">
                        <input
                          type="checkbox"
                          checked={form.disableRunningCheck}
                          onChange={(event) =>
                            setForm({
                              ...form,
                              disableRunningCheck: event.target.checked,
                            })
                          }
                        />
                        <span />
                      </label>
                    </div>
                  </div>
                  <div className="field full subsection-heading">
                    <div>
                      <span className="eyebrow">ZeroTier policy</span>
                      <strong>Managed route acceptance</strong>
                    </div>
                  </div>
                </>
              )}
              <div className="field full switch-stack">
                {[
                  [
                    "allowManaged",
                    "Allow managed addresses and routes",
                    "Accept controller-managed IP configuration.",
                  ],
                  [
                    "allowDefault",
                    "Allow default route",
                    "Permit the network to replace the system default route.",
                  ],
                  [
                    "allowGlobal",
                    "Allow global address ranges",
                    "Permit managed routes that overlap public address space.",
                  ],
                  ...(capabilities?.clientDns
                    ? [
                        [
                          "allowDNS",
                          "Allow managed DNS",
                          "Permit the network to configure system DNS servers.",
                        ],
                      ]
                    : []),
                ].map(([key, label, detail]) => (
                  <div className="switch-field" key={key}>
                    <div>
                      <strong>{label}</strong>
                      <small>{detail}</small>
                    </div>
                    <label className="switch">
                      <input
                        type="checkbox"
                        checked={Boolean(form[key as keyof FormState])}
                        onChange={(event) =>
                          setForm({ ...form, [key]: event.target.checked })
                        }
                      />
                      <span />
                    </label>
                  </div>
                ))}
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
              <button
                className="button primary"
                disabled={
                  busy || (activeNode?.type === "mikrotik" && !form.instance)
                }
              >
                {busy ? "Saving…" : "Save client configuration"}
              </button>
            </div>
          </form>
        </div>
      )}
      {moonOpen && (
        <div
          className="modal-backdrop"
          onMouseDown={() => !busy && setMoonOpen(false)}
        >
          <form
            ref={moonDialog}
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="moon-dialog-title"
            tabIndex={-1}
            onSubmit={orbitMoon}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="modal-header">
              <div>
                <span className="eyebrow">Federated root set</span>
                <h2 id="moon-dialog-title">Orbit a moon</h2>
                <p>
                  Enter the 10-character world ID and one 10-character seed root
                  node ID.
                </p>
                <ControllerTarget controller={controller} node={activeNode} />
              </div>
              <button
                type="button"
                className="icon-button"
                onClick={() => setMoonOpen(false)}
                aria-label="Close moon dialog"
              >
                <X />
              </button>
            </div>
            <div className="modal-body form-grid">
              <label className="field">
                <span>World ID</span>
                <input
                  className="input mono"
                  value={moonForm.worldId}
                  maxLength={10}
                  pattern="[0-9a-fA-F]{10}"
                  required
                  autoFocus
                  onChange={(event) =>
                    setMoonForm({
                      ...moonForm,
                      worldId: event.target.value.toLowerCase(),
                    })
                  }
                />
              </label>
              <label className="field">
                <span>Seed node ID</span>
                <input
                  className="input mono"
                  value={moonForm.seed}
                  maxLength={10}
                  pattern="[0-9a-fA-F]{10}"
                  required
                  onChange={(event) =>
                    setMoonForm({
                      ...moonForm,
                      seed: event.target.value.toLowerCase(),
                    })
                  }
                />
              </label>
            </div>
            <div className="modal-footer">
              <button
                type="button"
                className="button"
                onClick={() => setMoonOpen(false)}
              >
                Cancel
              </button>
              <button className="button primary" disabled={busy}>
                {busy ? "Saving…" : "Orbit moon"}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
