import type { RouterOsZeroTierInstanceInput } from "@/lib/types";
import {
  ValidationError,
  booleanValue,
  optionalText,
  requiredText,
} from "@/lib/validation";

function integer(
  value: unknown,
  field: string,
  minimum: number,
  maximum: number,
  fallback: number,
) {
  if (value === undefined) return fallback;
  if (
    !Number.isInteger(value) ||
    Number(value) < minimum ||
    Number(value) > maximum
  )
    throw new ValidationError(
      `${field} must be an integer between ${minimum} and ${maximum}.`,
    );
  return Number(value);
}

export function routerOsInstancePayload(
  body: Record<string, unknown>,
): RouterOsZeroTierInstanceInput {
  const rawInterfaces =
    body.interfaces === undefined ? ["all"] : body.interfaces;
  if (
    !Array.isArray(rawInterfaces) ||
    rawInterfaces.length < 1 ||
    rawInterfaces.length > 32
  )
    throw new ValidationError("Interfaces must contain one to 32 names.");
  const interfaces = rawInterfaces.map((value) =>
    requiredText(value, "Interface", 64),
  );
  return {
    name: requiredText(body.name, "Instance name", 64),
    comment: optionalText(body.comment, 512),
    port: integer(body.port, "Port", 1, 65_535, 9_993),
    interfaces,
    routeDistance: integer(body.routeDistance, "Route distance", 1, 255, 1),
    enabled: booleanValue(body.enabled, "Enabled", true),
  };
}
