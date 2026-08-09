import type { AppRole, Permission } from "@/lib/types";

const grants: Record<AppRole, ReadonlySet<Permission>> = {
  admin: new Set([
    "controllers:read",
    "controllers:write",
    "networks:read",
    "networks:write",
    "devices:read",
    "devices:write",
    "users:write",
    "audit:read",
    "audit:export",
    "backup:read",
    "backup:write",
  ]),
  operator: new Set([
    "controllers:read",
    "networks:read",
    "networks:write",
    "devices:read",
    "devices:write",
    "backup:read",
    "backup:write",
  ]),
  auditor: new Set([
    "controllers:read",
    "networks:read",
    "devices:read",
    "audit:read",
    "backup:read",
  ]),
  viewer: new Set(["controllers:read", "networks:read", "devices:read"]),
};

export function hasPermission(role: AppRole, permission: Permission) {
  return grants[role].has(permission);
}

export function permissionsFor(role: AppRole) {
  return {
    canManageControllers: hasPermission(role, "controllers:write"),
    canWriteNetworks: hasPermission(role, "networks:write"),
    canWriteDevices: hasPermission(role, "devices:write"),
    canManageUsers: hasPermission(role, "users:write"),
    canViewAudit: hasPermission(role, "audit:read"),
    canExportAudit: hasPermission(role, "audit:export"),
    canExportBackup: hasPermission(role, "backup:read"),
    canRestore: hasPermission(role, "backup:write"),
  };
}
