"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import { api, ClientApiError } from "@/lib/client-api";
import { resolveActiveNode } from "@/lib/active-node";
import type {
  PublicController,
  PublicAppSettings,
  PublicManagedNode,
  PublicUser,
} from "@/lib/types";

interface Permissions {
  canManageControllers: boolean;
  canWriteNetworks: boolean;
  canWriteDevices: boolean;
  canManageUsers: boolean;
  canViewAudit: boolean;
  canExportAudit: boolean;
  canExportBackup: boolean;
  canRestore: boolean;
}
interface AuthValue {
  loading: boolean;
  error: string;
  setupRequired: boolean;
  user: PublicUser | null;
  permissions: Permissions;
  controllers: PublicController[];
  activeController: PublicController | null;
  nodes: PublicManagedNode[];
  activeNode: PublicManagedNode | null;
  settings: PublicAppSettings;
  refresh(options?: { silent?: boolean }): Promise<void>;
  activateController(id: string): Promise<void>;
  activateNode(id: string): Promise<void>;
}
const emptyPermissions: Permissions = {
  canManageControllers: false,
  canWriteNetworks: false,
  canWriteDevices: false,
  canManageUsers: false,
  canViewAudit: false,
  canExportAudit: false,
  canExportBackup: false,
  canRestore: false,
};
const defaultSettings: PublicAppSettings = {
  workspaceName: "Control Plane",
  refreshSeconds: 30,
};
const AuthContext = createContext<AuthValue | null>(null);
const publicPaths = new Set(["/login", "/setup"]);

export function AuthProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [setupRequired, setSetupRequired] = useState(false);
  const [user, setUser] = useState<PublicUser | null>(null);
  const [permissions, setPermissions] = useState<Permissions>(emptyPermissions);
  const [controllers, setControllers] = useState<PublicController[]>([]);
  const [nodes, setNodes] = useState<PublicManagedNode[]>([]);
  const [settings, setSettings] = useState<PublicAppSettings>(defaultSettings);

  async function refresh(options: { silent?: boolean } = {}) {
    if (!options.silent) setLoading(true);
    try {
      setError("");
      const status = await api<{
        setupRequired: boolean;
        authenticated: boolean;
        user: PublicUser | null;
        permissions: Permissions | null;
      }>("/api/auth/status");
      setSetupRequired(status.setupRequired);
      if (status.authenticated) {
        const me = await api<{
          user: PublicUser;
          permissions: Permissions;
          controllers: PublicController[];
          nodes: PublicManagedNode[];
          settings: PublicAppSettings;
        }>("/api/auth/me");
        setUser(me.user);
        setPermissions(me.permissions);
        setControllers(me.controllers);
        setNodes(me.nodes);
        setSettings(me.settings);
      } else {
        setUser(null);
        setPermissions(emptyPermissions);
        setControllers([]);
        setNodes([]);
        setSettings(defaultSettings);
      }
    } catch (caught) {
      if (caught instanceof ClientApiError && caught.status === 401) {
        setUser(null);
        setPermissions(emptyPermissions);
        setControllers([]);
        setNodes([]);
        setSettings(defaultSettings);
        setError("");
        return;
      }
      setError(
        caught instanceof Error
          ? caught.message
          : "Unable to reach the authentication service.",
      );
    } finally {
      if (!options.silent) setLoading(false);
    }
  }
  useEffect(() => {
    void refresh();
  }, []);
  useEffect(() => {
    if (loading || error) return;
    if (setupRequired && pathname !== "/setup") router.replace("/setup");
    else if (!setupRequired && !user && !publicPaths.has(pathname))
      router.replace("/login");
    else if (user && publicPaths.has(pathname))
      router.replace(user.landingPage);
  }, [error, loading, pathname, router, setupRequired, user]);
  useEffect(() => {
    document.documentElement.dataset.reducedMotion = String(
      Boolean(user?.reducedMotion),
    );
    return () => {
      delete document.documentElement.dataset.reducedMotion;
    };
  }, [user?.reducedMotion]);

  async function activateController(id: string) {
    await api(
      "/api/preferences/active-controller",
      jsonRequest("PUT", { controllerId: id }),
    );
    await refresh();
    router.refresh();
  }
  async function activateNode(id: string) {
    await api(
      "/api/preferences/active-node",
      jsonRequest("PUT", { nodeId: id }),
    );
    await refresh();
    router.refresh();
  }
  const activeController =
    controllers.find(
      (controller) => controller.id === user?.activeControllerId,
    ) || null;
  const activeNode = resolveActiveNode(
    nodes,
    activeController?.id,
    user?.activeNodeId,
  );
  return (
    <AuthContext.Provider
      value={{
        loading,
        error,
        setupRequired,
        user,
        permissions,
        controllers,
        activeController,
        nodes,
        activeNode,
        settings,
        refresh,
        activateController,
        activateNode,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider.");
  return context;
}

function jsonRequest(method: string, value: unknown): RequestInit {
  return {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(value),
  };
}
