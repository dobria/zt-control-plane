"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  Check,
  ChevronDown,
  Cloud,
  Cpu,
  Router,
  ServerCog,
} from "lucide-react";
import { useAuth } from "@/shared/providers/AuthContext";
import { controllerSwitchDestination } from "@/lib/controller-navigation";
import type { PublicController, PublicManagedNode } from "@/lib/types";

function providerName(controller: PublicController) {
  if (controller.embedded) return "Embedded ZeroTier One";
  if (controller.type === "mikrotik") return "MikroTik RouterOS";
  if (controller.type === "central_v2") return "New ZeroTier Central";
  if (controller.type === "central_v1") return "Legacy ZeroTier Central";
  return "Remote ZeroTier One";
}

function ControllerIcon({ controller }: { controller: PublicController }) {
  if (controller.type === "central_v1" || controller.type === "central_v2")
    return <Cloud />;
  if (controller.type === "mikrotik") return <Router />;
  if (controller.embedded) return <Cpu />;
  return <ServerCog />;
}

export function useSynchronizeControllerScope(controllerId: string) {
  const { controllers, activeController, activateController } = useAuth();
  const pending = useRef("");
  const controller = controllers.find((item) => item.id === controllerId);

  useEffect(() => {
    if (
      !controller?.enabled ||
      activeController?.id === controllerId ||
      pending.current === controllerId
    )
      return;
    pending.current = controllerId;
    void activateController(controllerId).finally(() => {
      pending.current = "";
    });
  }, [activeController?.id, activateController, controller, controllerId]);

  return controller;
}

export function ControllerContext({
  controller,
  section,
  node,
}: {
  controller: PublicController | null | undefined;
  section: string;
  node?: PublicManagedNode | null;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { controllers, activateController } = useAuth();
  const picker = useRef<HTMLDetailsElement>(null);
  const [switching, setSwitching] = useState("");
  const [switchError, setSwitchError] = useState("");

  useEffect(() => {
    function closePicker(event: PointerEvent) {
      if (!picker.current?.contains(event.target as Node))
        picker.current?.removeAttribute("open");
    }
    document.addEventListener("pointerdown", closePicker);
    return () => document.removeEventListener("pointerdown", closePicker);
  }, []);

  if (!controller) return null;
  const activeControllerId = controller.id;
  const status = !controller.enabled
    ? "Paused"
    : controller.lastOnline === false
      ? "Offline"
      : controller.lastOnline === null
        ? "Not tested"
        : "Online";

  async function switchController(controllerId: string) {
    if (controllerId === activeControllerId) {
      picker.current?.removeAttribute("open");
      return;
    }
    if (
      document.documentElement.dataset.unsavedControllerChanges === "true" &&
      !window.confirm(
        "This page has unsaved controller changes. Switch controllers and discard them?",
      )
    )
      return;
    const nextController = controllers.find(
      (item) => item.id === controllerId && item.enabled,
    );
    if (!nextController) return;
    setSwitching(controllerId);
    setSwitchError("");
    try {
      await activateController(controllerId);
      picker.current?.removeAttribute("open");
      const destination = controllerSwitchDestination(
        pathname,
        controllerId,
        nextController.type,
      );
      if (destination) router.push(destination);
    } catch (caught) {
      setSwitchError(
        caught instanceof Error
          ? caught.message
          : "Unable to switch controller.",
      );
    } finally {
      setSwitching("");
    }
  }

  return (
    <section
      className={`controller-context ${controller.type}`}
      aria-label={`Controller context: ${controller.name}`}
    >
      <div className="controller-context-icon">
        <ControllerIcon controller={controller} />
      </div>
      <div className="controller-context-identity">
        <span className="eyebrow">Managing through</span>
        <strong>{controller.name}</strong>
        <div className="controller-context-meta">
          <span>{providerName(controller)}</span>
          <span className="mono">
            {controller.type.startsWith("central_") ? "Scope" : "Controller"} ID
            · {controller.lastAddress || "Pending"}
          </span>
          <span
            className={`context-status ${controller.lastOnline === false ? "offline" : !controller.enabled || controller.lastOnline === null ? "neutral" : ""}`}
          >
            {status}
          </span>
        </div>
      </div>
      <div className="controller-context-scope">
        <span className="eyebrow">Page scope</span>
        <strong>{section}</strong>
        {node ? (
          <small>
            Managed node · {node.name} · ID {node.lastAddress || "Pending"}
          </small>
        ) : (
          <small>All changes apply to {controller.name}</small>
        )}
      </div>
      <details className="context-switcher" ref={picker}>
        <summary className="context-change">
          Change <ChevronDown />
        </summary>
        <div className="context-switcher-options">
          <span className="eyebrow">Switch controller</span>
          {controllers
            .filter((item) => item.enabled)
            .map((item) => {
              const active = item.id === controller.id;
              return (
                <button
                  type="button"
                  className={`context-controller-option ${item.type} ${active ? "active" : ""}`}
                  key={item.id}
                  aria-current={active ? "true" : undefined}
                  disabled={Boolean(switching)}
                  onClick={() => void switchController(item.id)}
                >
                  <span className="context-option-dot" />
                  <span>
                    <strong>{item.name}</strong>
                    <small>
                      {switching === item.id
                        ? "Switching…"
                        : providerName(item)}
                    </small>
                  </span>
                  {active && <Check aria-hidden="true" />}
                </button>
              );
            })}
          {switchError && (
            <div className="context-switch-error" role="alert">
              {switchError}
            </div>
          )}
        </div>
      </details>
    </section>
  );
}

export function ControllerTarget({
  controller,
  node,
}: {
  controller: PublicController | null | undefined;
  node?: PublicManagedNode | null;
}) {
  if (!controller) return null;
  return (
    <div className={`controller-target ${controller.type}`}>
      <span className="controller-target-dot" />
      <span>
        Applies to <strong>{controller.name}</strong>
        {node ? ` · ${node.name}` : ""}
      </span>
    </div>
  );
}
