"use client";

import Link from "next/link";
import { useState, type CSSProperties } from "react";
import {
  ArrowRight,
  Cloud,
  Cpu,
  Network,
  Router,
  ServerCog,
} from "lucide-react";
import type {
  OverviewControllerSnapshot,
  OverviewNetworkSnapshot,
} from "@/lib/types";

type VisualStyle = CSSProperties & Record<`--${string}`, string | number>;

function providerName(controller: OverviewControllerSnapshot) {
  if (controller.embedded) return "Embedded ZeroTier One";
  if (controller.type === "mikrotik") return "MikroTik RouterOS";
  if (controller.type === "central_v2") return "New ZeroTier Central";
  if (controller.type === "central_v1") return "Legacy ZeroTier Central";
  return "Remote ZeroTier One";
}

function ControllerIcon({
  controller,
}: {
  controller: OverviewControllerSnapshot;
}) {
  if (controller.type === "central_v1" || controller.type === "central_v2")
    return <Cloud />;
  if (controller.type === "mikrotik") return <Router />;
  if (controller.embedded) return <Cpu />;
  return <ServerCog />;
}

function controllerPosition(index: number, count: number) {
  if (count === 1) return { x: 50, y: 18 };
  const firstRingCount = Math.min(count, 6);
  const outer = index >= firstRingCount;
  const ringIndex = outer ? index - firstRingCount : index;
  const ringCount = outer ? count - firstRingCount : firstRingCount;
  const angle = -90 + (360 / ringCount) * ringIndex + (outer ? 30 : 0);
  const radiusX = outer ? 43 : 35;
  const radiusY = outer ? 39 : 32;
  const radians = (angle * Math.PI) / 180;
  return {
    x: 50 + Math.cos(radians) * radiusX,
    y: 50 + Math.sin(radians) * radiusY,
  };
}

export function ControllerFleet({
  controllers,
  selectedId,
  activeId,
  switching,
  onSelect,
  onActivate,
}: {
  controllers: OverviewControllerSnapshot[];
  selectedId: string;
  activeId?: string | null;
  switching: boolean;
  onSelect(controllerId: string): void;
  onActivate(controllerId: string): void;
}) {
  const visible = controllers.slice(0, 10);
  const selected =
    controllers.find((controller) => controller.id === selectedId) ||
    controllers[0];
  const selectedMembers =
    selected?.networks.reduce((sum, network) => sum + network.memberCount, 0) ||
    0;
  return (
    <section className="card overview-visual-card">
      <div className="card-header overview-visual-head">
        <div>
          <span className="eyebrow">All management endpoints</span>
          <h2>Controller fleet</h2>
          <p>Select a controller to inspect its topology</p>
        </div>
        <span className="visual-count">{controllers.length}</span>
      </div>
      <div className="fleet-canvas" aria-label="Controller fleet map">
        <div className="fleet-radar-ring ring-one" />
        <div className="fleet-radar-ring ring-two" />
        <div className="fleet-core">
          <ServerCog />
          <strong>Control plane</strong>
          <span>
            {controllers.filter((item) => item.enabled).length} enabled
          </span>
        </div>
        {visible.map((controller, index) => {
          const position = controllerPosition(index, visible.length);
          return (
            <div
              className={`fleet-node-shell ${controller.type}`}
              key={controller.id}
              style={
                {
                  left: `${position.x}%`,
                  top: `${position.y}%`,
                } as VisualStyle
              }
            >
              <button
                type="button"
                className={`fleet-node ${controller.health} ${selected?.id === controller.id ? "selected" : ""}`}
                onClick={() => onSelect(controller.id)}
                aria-label={`Inspect ${controller.name}`}
                aria-pressed={selected?.id === controller.id}
              >
                <ControllerIcon controller={controller} />
                <span className="fleet-health-dot" />
              </button>
              <span className="fleet-hover-label">{controller.name}</span>
            </div>
          );
        })}
        {controllers.length > visible.length && (
          <span className="fleet-overflow">
            +{controllers.length - visible.length} more
          </span>
        )}
      </div>
      {selected && (
        <div className="visual-detail-panel">
          <div className="visual-detail-identity">
            <span className={`selection-icon ${selected.type}`}>
              <ControllerIcon controller={selected} />
            </span>
            <span>
              <small>{providerName(selected)}</small>
              <strong>{selected.name}</strong>
            </span>
          </div>
          <dl className="visual-detail-metrics">
            <div>
              <dt>Networks</dt>
              <dd>{selected.networks.length}</dd>
            </div>
            <div>
              <dt>Members</dt>
              <dd>{selectedMembers}</dd>
            </div>
            <div>
              <dt>Nodes</dt>
              <dd>{selected.managedNodeCount}</dd>
            </div>
          </dl>
          <span className={`status-pill ${selected.health}`}>
            {selected.health}
          </span>
          <div className="selection-actions">
            <Link
              className="button small"
              href={`/controllers#controller-${selected.id}`}
            >
              Manage
            </Link>
            {selected.enabled && selected.id !== activeId && (
              <button
                type="button"
                className="button small primary"
                disabled={switching}
                onClick={() => onActivate(selected.id)}
              >
                {switching ? "Switching…" : "Make active"}
              </button>
            )}
            {selected.id === activeId && (
              <span className="active-label">ACTIVE</span>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function OrbitNetwork({
  network,
  index,
  total,
  radius,
  duration,
  selected,
  onSelect,
}: {
  network: OverviewNetworkSnapshot;
  index: number;
  total: number;
  radius: number;
  duration: number;
  selected: boolean;
  onSelect(networkId: string): void;
}) {
  const angle = -90 + (360 / Math.max(1, total)) * index;
  return (
    <div
      className="network-orbit-position"
      style={
        {
          "--angle": `${angle}deg`,
          "--counter-angle": `${-angle}deg`,
          "--orbit-offset": `${-radius}px`,
          "--orbit-duration": `${duration}s`,
        } as VisualStyle
      }
    >
      <div className="network-orbit-counter">
        <button
          type="button"
          className={`topology-network-node ${selected ? "selected" : ""}`}
          onClick={() => onSelect(network.id)}
          aria-label={`Inspect ${network.name}, ${network.memberCount} members`}
          aria-pressed={selected}
        >
          <span className="network-member-count">{network.memberCount}</span>
          <strong>{network.name}</strong>
          <span className="network-privacy">
            {network.private ? "Private" : "Public"}
          </span>
        </button>
      </div>
    </div>
  );
}

export function ControllerTopology({
  controller,
}: {
  controller: OverviewControllerSnapshot | undefined;
}) {
  const [selectedNetworkKey, setSelectedNetworkKey] = useState<string | null>(
    null,
  );
  if (!controller)
    return (
      <section className="card overview-visual-card">
        <div className="empty-state">
          <ServerCog />
          <h2>No controller available</h2>
        </div>
      </section>
    );
  const visible = [...controller.networks]
    .sort((a, b) => b.memberCount - a.memberCount)
    .slice(0, 9);
  const outer = visible.slice(0, 5);
  const inner = visible.slice(5);
  const members = controller.networks.reduce(
    (sum, network) => sum + network.memberCount,
    0,
  );
  const selectedNetwork = controller.networks.find(
    (network) => `${controller.id}:${network.id}` === selectedNetworkKey,
  );
  const selectNetwork = (networkId: string) =>
    setSelectedNetworkKey(`${controller.id}:${networkId}`);
  return (
    <section className="card overview-visual-card">
      <div className="card-header overview-visual-head">
        <div>
          <span className="eyebrow">Selected infrastructure</span>
          <h2>Controller topology</h2>
          <p>Networks orbit the controller · members appear as totals</p>
        </div>
        <span className={`status-pill ${controller.health}`}>
          {controller.health}
        </span>
      </div>
      <div
        className={`topology-canvas ${controller.type} ${controller.health}`}
        aria-label={`${controller.name} network topology`}
      >
        <span className="topology-ring inner" />
        <span className="topology-ring outer" />
        {outer.length > 0 && (
          <div className="network-orbit-layer outer-layer">
            {outer.map((network, index) => (
              <OrbitNetwork
                key={network.id}
                network={network}
                index={index}
                total={outer.length}
                radius={145}
                duration={48}
                selected={selectedNetwork?.id === network.id}
                onSelect={selectNetwork}
              />
            ))}
          </div>
        )}
        {inner.length > 0 && (
          <div className="network-orbit-layer inner-layer">
            {inner.map((network, index) => (
              <OrbitNetwork
                key={network.id}
                network={network}
                index={index}
                total={inner.length}
                radius={91}
                duration={36}
                selected={selectedNetwork?.id === network.id}
                onSelect={selectNetwork}
              />
            ))}
          </div>
        )}
        <button
          type="button"
          className={`topology-controller-core ${selectedNetwork ? "" : "selected"}`}
          onClick={() => setSelectedNetworkKey(null)}
          aria-label={`Inspect ${controller.name}`}
          aria-pressed={!selectedNetwork}
        >
          <ControllerIcon controller={controller} />
          <strong>{controller.name}</strong>
          <code>{controller.address || "Identity pending"}</code>
          <span>Controller</span>
        </button>
        {!visible.length && (
          <div className="topology-empty">
            <Network />
            <span>No networks</span>
          </div>
        )}
        {controller.networks.length > visible.length && (
          <span className="topology-overflow">
            +{controller.networks.length - visible.length} more networks
          </span>
        )}
      </div>
      <div className="visual-detail-panel topology-detail-panel">
        <div className="visual-detail-identity">
          <span
            className={`selection-icon ${selectedNetwork ? "network" : controller.type}`}
          >
            {selectedNetwork ? (
              <Network />
            ) : (
              <ControllerIcon controller={controller} />
            )}
          </span>
          <span>
            <small>
              {selectedNetwork ? "Selected network" : providerName(controller)}
            </small>
            <strong>{selectedNetwork?.name || controller.name}</strong>
            <code>
              {selectedNetwork?.id || controller.address || "Identity pending"}
            </code>
          </span>
        </div>
        <dl className="visual-detail-metrics">
          {selectedNetwork ? (
            <>
              <div>
                <dt>Members</dt>
                <dd>{selectedNetwork.memberCount}</dd>
              </div>
              <div>
                <dt>Routes</dt>
                <dd>{selectedNetwork.routeCount}</dd>
              </div>
              <div>
                <dt>Access</dt>
                <dd>{selectedNetwork.private ? "Private" : "Public"}</dd>
              </div>
            </>
          ) : (
            <>
              <div>
                <dt>Networks</dt>
                <dd>{controller.networks.length}</dd>
              </div>
              <div>
                <dt>Members</dt>
                <dd>{members}</dd>
              </div>
              <div>
                <dt>Nodes</dt>
                <dd>{controller.managedNodeCount}</dd>
              </div>
            </>
          )}
        </dl>
        {selectedNetwork ? (
          <span className="status-pill neutral">
            {selectedNetwork.private ? "Private" : "Public"}
          </span>
        ) : (
          <span className={`status-pill ${controller.health}`}>
            {controller.health}
          </span>
        )}
        <div className="selection-actions">
          <Link
            className="button small"
            href={
              selectedNetwork
                ? `/networks/${controller.id}/${selectedNetwork.id}`
                : `/controllers#controller-${controller.id}`
            }
          >
            {selectedNetwork ? "Open network" : "Manage"} <ArrowRight />
          </Link>
          {controller.stale && <span className="stale-label">Cached data</span>}
        </div>
      </div>
    </section>
  );
}
