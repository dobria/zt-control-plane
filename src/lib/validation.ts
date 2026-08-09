import type { AppRole, ControllerType, ManagedNodeType } from "@/lib/types";
import { isIP } from "node:net";
import { endpointAddressIsForbidden } from "@/lib/endpoint-security";

export class ValidationError extends Error {
  status = 400;
}

export function requiredText(value: unknown, field: string, max = 200) {
  if (typeof value !== "string" || !value.trim())
    throw new ValidationError(`${field} is required.`);
  const result = value.trim();
  if (result.length > max) throw new ValidationError(`${field} is too long.`);
  return result;
}

export function optionalText(value: unknown, max = 4000) {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value !== "string" || value.length > max)
    throw new ValidationError("Text value is invalid.");
  return value.trim();
}

export function email(value: unknown) {
  const result = requiredText(value, "Email", 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result))
    throw new ValidationError("Enter a valid email address.");
  return result;
}

export function role(value: unknown): AppRole {
  if (!["admin", "operator", "auditor", "viewer"].includes(String(value)))
    throw new ValidationError("Invalid role.");
  return value as AppRole;
}

export function controllerType(
  value: unknown,
): Exclude<ControllerType, "embedded"> {
  if (
    !["zerotier", "mikrotik", "central_v2", "central_v1"].includes(
      String(value),
    )
  )
    throw new ValidationError("Invalid controller type.");
  return value as Exclude<ControllerType, "embedded">;
}

export function managedNodeType(
  value: unknown,
): Exclude<ManagedNodeType, "local"> {
  if (!["zerotier", "mikrotik"].includes(String(value)))
    throw new ValidationError("Invalid managed node type.");
  return value as Exclude<ManagedNodeType, "local">;
}

export function baseUrl(value: unknown) {
  const result = requiredText(value, "Base URL", 500).replace(/\/+$/, "");
  let parsed: URL;
  try {
    parsed = new URL(result);
  } catch {
    throw new ValidationError("Enter a valid controller URL.");
  }
  if (!["http:", "https:"].includes(parsed.protocol))
    throw new ValidationError(
      "Only HTTP and HTTPS controller URLs are supported.",
    );
  if (parsed.username || parsed.password)
    throw new ValidationError("Credentials must not be included in the URL.");
  const hostname = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const blockedMetadataNames = new Set([
    "metadata.google.internal",
    "metadata.google",
    "instance-data",
  ]);
  if (blockedMetadataNames.has(hostname))
    throw new ValidationError("Cloud metadata endpoints are not allowed.");
  if (isIP(hostname) && endpointAddressIsForbidden(hostname))
    throw new ValidationError(
      "Link-local, unspecified, metadata and reserved endpoint addresses are not allowed.",
    );
  return parsed.toString().replace(/\/$/, "");
}

export function networkId(value: unknown) {
  const result = requiredText(value, "Network ID", 16).toLowerCase();
  if (!/^[0-9a-f]{16}$/.test(result))
    throw new ValidationError(
      "Network ID must contain 16 hexadecimal characters.",
    );
  return result;
}

export function memberId(value: unknown) {
  const result = requiredText(value, "Member ID", 10).toLowerCase();
  if (!/^[0-9a-f]{10}$/.test(result))
    throw new ValidationError(
      "Member ID must contain 10 hexadecimal characters.",
    );
  return result;
}

export function moonId(value: unknown, field = "Moon ID") {
  const result = requiredText(value, field, 10).toLowerCase();
  if (!/^[0-9a-f]{10}$/.test(result))
    throw new ValidationError(
      `${field} must contain 10 hexadecimal characters.`,
    );
  return result;
}

export function routerOsRecordId(value: unknown) {
  const result = requiredText(value, "RouterOS record ID", 32);
  if (!/^\*[0-9a-f]+$/i.test(result))
    throw new ValidationError("RouterOS record ID is invalid.");
  return result;
}

export function booleanValue(
  value: unknown,
  field: string,
  defaultValue?: boolean,
) {
  if (value === undefined && defaultValue !== undefined) return defaultValue;
  if (typeof value !== "boolean")
    throw new ValidationError(`${field} must be true or false.`);
  return value;
}

export async function jsonBody(request: Request, maxBytes = 1024 * 1024) {
  const length = Number(request.headers.get("content-length") || 0);
  if (Number.isFinite(length) && length > maxBytes)
    throw new ValidationError("Request body is too large.");
  if (!request.body)
    throw new ValidationError("Request body must be valid JSON.");

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new ValidationError("Request body is too large.");
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const parsed = JSON.parse(new TextDecoder().decode(bytes));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      throw new ValidationError("Request body must be a JSON object.");
    return parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    if (total > maxBytes)
      throw new ValidationError("Request body is too large.");
    throw new ValidationError("Request body must be valid JSON.");
  } finally {
    reader.releaseLock();
  }
}
