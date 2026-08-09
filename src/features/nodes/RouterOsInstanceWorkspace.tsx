"use client";

import Link from "next/link";
import {
  ArrowRight,
  Cpu,
  LayoutDashboard,
  LogIn,
  LogOut,
  Network,
  Radio,
  Settings2,
  SlidersHorizontal,
} from "lucide-react";
import type {
  ClientNetwork,
  ManagedNetwork,
  RouterOsZeroTierInstance,
  ZeroTierPeer,
} from "@/lib/types";
import type { InstanceWorkspaceView } from "@/lib/routeros-workspace";

interface Props {
  controllerId: string;
  instance: RouterOsZeroTierInstance | undefined;
  controlledNetworks: ManagedNetwork[];
  joinedNetworks: ClientNetwork[];
  peers: ZeroTierPeer[];
  view: InstanceWorkspaceView;
  canWriteDevices: boolean;
  canManageInstances: boolean;
  onView(view: InstanceWorkspaceView): void;
  onJoin(): void;
  onEditNetwork(network: ClientNetwork): void;
  onLeave(network: ClientNetwork): void;
  onEditInstance(): void;
}

const views = [
  ["overview", "Overview", LayoutDashboard],
  ["controlled", "Controlled networks", Network],
  ["joined", "Joined networks", LogIn],
  ["peers", "Peers", Radio],
  ["settings", "Settings", SlidersHorizontal],
] as const;

export function RouterOsInstanceWorkspace({
  controllerId,
  instance,
  controlledNetworks,
  joinedNetworks,
  peers,
  view,
  canWriteDevices,
  canManageInstances,
  onView,
  onJoin,
  onEditNetwork,
  onLeave,
  onEditInstance,
}: Props) {
  if (!instance)
    return (
      <section className="card">
        <div className="empty-state">
          <span className="empty-icon">
            <Cpu />
          </span>
          <h2>Select a ZeroTier instance</h2>
          <p>
            Choose an instance above to inspect its controller, client and
            runtime roles.
          </p>
        </div>
      </section>
    );

  const online = !instance.disabled && instance.online;
  return (
    <section className="instance-workspace">
      <div className="instance-workspace-heading">
        <div>
          <span className="eyebrow">Instance workspace</span>
          <div className="instance-workspace-title">
            <h2>{instance.name}</h2>
            <code>{instance.address || "Identity pending"}</code>
            <span
              className={`status-pill ${instance.disabled ? "disabled" : online ? "" : "neutral"}`}
            >
              {instance.disabled ? "Disabled" : instance.state || "Unknown"}
            </span>
          </div>
          <p>
            Controller, client and runtime roles for this ZeroTier identity.
          </p>
        </div>
      </div>

      <div className="instance-workspace-tabs" role="tablist">
        {views.map(([key, label, Icon]) => (
          <button
            className={view === key ? "active" : ""}
            key={key}
            role="tab"
            aria-selected={view === key}
            onClick={() => onView(key)}
          >
            <Icon />
            <span>{label}</span>
            {key === "controlled" && <small>{controlledNetworks.length}</small>}
            {key === "joined" && <small>{joinedNetworks.length}</small>}
            {key === "peers" && <small>{peers.length}</small>}
          </button>
        ))}
      </div>

      {view === "overview" && (
        <div className="instance-role-grid">
          <button
            className="instance-role-card"
            onClick={() => onView("controlled")}
          >
            <span className="instance-role-icon controller-role">
              <Network />
            </span>
            <span>
              <small>Controller role</small>
              <strong>Controlled networks</strong>
              <p>
                Networks whose membership and configuration are issued by this
                instance.
              </p>
            </span>
            <b>{controlledNetworks.length}</b>
            <ArrowRight />
          </button>
          <button
            className="instance-role-card"
            onClick={() => onView("joined")}
          >
            <span className="instance-role-icon client-role">
              <LogIn />
            </span>
            <span>
              <small>Client role</small>
              <strong>Joined networks</strong>
              <p>
                RouterOS interfaces through which this instance participates as
                a member.
              </p>
            </span>
            <b>{joinedNetworks.length}</b>
            <ArrowRight />
          </button>
          <button
            className="instance-role-card"
            onClick={() => onView("peers")}
          >
            <span className="instance-role-icon runtime-role">
              <Radio />
            </span>
            <span>
              <small>Runtime role</small>
              <strong>Peers and paths</strong>
              <p>
                Planet, moon and leaf connectivity currently known to this
                identity.
              </p>
            </span>
            <b>{peers.length}</b>
            <ArrowRight />
          </button>
          <button
            className="instance-role-card"
            onClick={() => onView("settings")}
          >
            <span className="instance-role-icon settings-role">
              <SlidersHorizontal />
            </span>
            <span>
              <small>Identity role</small>
              <strong>Instance settings</strong>
              <p>
                UDP port, discovery interfaces, route distance and runtime
                identity.
              </p>
            </span>
            <ArrowRight />
          </button>
        </div>
      )}

      {view === "controlled" && (
        <div className="card instance-workspace-panel">
          <div className="card-header">
            <div>
              <span className="eyebrow">Controller role</span>
              <h2>Controlled networks</h2>
              <p>Virtual networks issued by {instance.name}.</p>
            </div>
            <Link className="button" href="/networks">
              Manage networks
            </Link>
          </div>
          {controlledNetworks.length ? (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Network</th>
                    <th>Access</th>
                    <th>Members</th>
                    <th>Routes</th>
                    <th>State</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {controlledNetworks.map((network) => (
                    <tr key={network.id}>
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
                      <td>{network.private ? "Private" : "Public"}</td>
                      <td>{network.memberCount || 0}</td>
                      <td>{network.routes?.length || 0}</td>
                      <td>
                        <span
                          className={`status-pill ${network.disabled ? "disabled" : ""}`}
                        >
                          {network.disabled ? "Disabled" : "Enabled"}
                        </span>
                      </td>
                      <td>
                        <Link
                          className="button small"
                          href={`/networks/${encodeURIComponent(controllerId)}/${encodeURIComponent(network.id)}`}
                        >
                          Open <ArrowRight />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty-state compact-empty">
              <h2>No controlled networks</h2>
              <p>
                This instance is not currently issuing any virtual networks.
              </p>
              <Link className="button primary" href="/networks">
                <Network /> Create network
              </Link>
            </div>
          )}
        </div>
      )}

      {view === "joined" && (
        <div className="card instance-workspace-panel">
          <div className="card-header">
            <div>
              <span className="eyebrow">Client role</span>
              <h2>Joined networks</h2>
              <p>RouterOS ZeroTier interfaces owned by {instance.name}.</p>
            </div>
            {canWriteDevices && (
              <button className="button primary" onClick={onJoin}>
                <LogIn /> Join network
              </button>
            )}
          </div>
          {joinedNetworks.length ? (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Network</th>
                    <th>Status</th>
                    <th>Assigned addresses</th>
                    <th>VRF</th>
                    <th>MTU</th>
                    <th>Managed</th>
                    <th>Default</th>
                    <th>Global</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {joinedNetworks.map((network) => (
                    <tr key={`${network.instance}:${network.id}`}>
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
                      <td>{network.vrf || "main"}</td>
                      <td>{network.actualMtu || network.mtu || "—"}</td>
                      <td>{network.allowManaged ? "Yes" : "No"}</td>
                      <td>{network.allowDefault ? "Yes" : "No"}</td>
                      <td>{network.allowGlobal ? "Yes" : "No"}</td>
                      <td>
                        {canWriteDevices && (
                          <div className="actions">
                            <button
                              className="button small"
                              onClick={() => onEditNetwork(network)}
                            >
                              <Settings2 /> Edit
                            </button>
                            <button
                              className="button small danger"
                              onClick={() => onLeave(network)}
                            >
                              <LogOut /> Leave
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty-state compact-empty">
              <h2>No joined networks</h2>
              <p>This instance is not currently acting as a network member.</p>
              {canWriteDevices && (
                <button className="button primary" onClick={onJoin}>
                  <LogIn /> Join first network
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {view === "peers" && (
        <div className="card instance-workspace-panel">
          <div className="card-header">
            <div>
              <span className="eyebrow">Runtime role</span>
              <h2>Peers and paths</h2>
              <p>Live connectivity reported by {instance.name}.</p>
            </div>
            <span className="status-pill neutral">{peers.length} detected</span>
          </div>
          {peers.length ? (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>ZeroTier address</th>
                    <th>Role</th>
                    <th>Latency</th>
                    <th>Active path</th>
                  </tr>
                </thead>
                <tbody>
                  {peers.map((peer) => (
                    <tr key={`${peer.instance}:${peer.address}`}>
                      <td>
                        <strong className="mono">{peer.address}</strong>
                      </td>
                      <td>{peer.role}</td>
                      <td>
                        {peer.latency === null ? "—" : `${peer.latency} ms`}
                      </td>
                      <td className="mono">
                        {peer.paths.find((path) => path.preferred)?.address ||
                          peer.paths.find((path) => path.active)?.address ||
                          "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty-inline">
              No peers are currently reported for this ZeroTier instance.
            </div>
          )}
        </div>
      )}

      {view === "settings" && (
        <div className="card instance-workspace-panel">
          <div className="card-header">
            <div>
              <span className="eyebrow">Identity role</span>
              <h2>Instance settings</h2>
              <p>Configuration and safe runtime identity from RouterOS.</p>
            </div>
            {canManageInstances && (
              <button className="button primary" onClick={onEditInstance}>
                <Settings2 /> Edit instance
              </button>
            )}
          </div>
          <div className="instance-settings-grid">
            <div>
              <span>Name</span>
              <strong>{instance.name}</strong>
            </div>
            <div>
              <span>Node ID</span>
              <code>{instance.address || "Pending"}</code>
            </div>
            <div>
              <span>UDP port</span>
              <strong>{instance.port || "—"}</strong>
            </div>
            <div>
              <span>Route distance</span>
              <strong>{instance.routeDistance || "—"}</strong>
            </div>
            <div className="wide">
              <span>Discovery interfaces</span>
              <code>{instance.interfaces.join(", ") || "—"}</code>
            </div>
            <div className="wide">
              <span>Public identity</span>
              <code>{instance.identityPublic || "Not reported"}</code>
            </div>
            <div className="wide">
              <span>Comment</span>
              <strong>{instance.comment || "No comment"}</strong>
            </div>
            <div className="wide">
              <span>Moons</span>
              <code>
                {instance.moons.join(", ") || "No custom moons reported"}
              </code>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
