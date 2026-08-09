export class ClientApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
  ) {
    super(message);
  }
}

export async function api<T = unknown>(
  url: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...init.headers,
    },
    cache: "no-store",
  });
  const contentType = response.headers.get("content-type") || "";
  const body = contentType.includes("json")
    ? await response.json()
    : await response.text();
  if (!response.ok) {
    const error =
      body && typeof body === "object" && "error" in body
        ? String((body as { error: unknown }).error)
        : `Request failed with status ${response.status}.`;
    const code =
      body && typeof body === "object" && "code" in body
        ? String((body as { code: unknown }).code)
        : undefined;
    throw new ClientApiError(error, response.status, code);
  }
  return body as T;
}

export function jsonRequest(method: string, value?: unknown): RequestInit {
  return {
    method,
    body: value === undefined ? undefined : JSON.stringify(value),
  };
}
