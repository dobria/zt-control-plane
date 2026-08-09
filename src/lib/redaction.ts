const sensitiveKey =
  /^(?:authorization|cookie|password|passwd|secret|token|api[-_]?key|encrypted[-_]?credentials|identity[._-]?private|private[-_]?identity)$/i;

export function redactSensitiveValues(value: unknown, depth = 0): unknown {
  if (depth > 12) return "[maximum depth reached]";
  if (Array.isArray(value))
    return value.map((item) => redactSensitiveValues(item, depth + 1));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key,
      sensitiveKey.test(key)
        ? "[redacted]"
        : redactSensitiveValues(item, depth + 1),
    ]),
  );
}
