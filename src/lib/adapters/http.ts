import { Agent } from "undici";
import { restrictedEndpointLookup } from "@/lib/endpoint-security";
import { AdapterError } from "@/lib/adapters/types";

export const MAX_ADAPTER_RESPONSE_BYTES = 8 * 1024 * 1024;

export function createAdapterAgent(tlsVerify: boolean) {
  return new Agent({
    connect: {
      rejectUnauthorized: tlsVerify,
      lookup: restrictedEndpointLookup,
    },
    connectTimeout: 12_000,
    headersTimeout: 12_000,
    bodyTimeout: 12_000,
    maxResponseSize: MAX_ADAPTER_RESPONSE_BYTES,
  });
}

async function boundedResponseText(
  response: Response,
  provider: string,
  maxBytes = MAX_ADAPTER_RESPONSE_BYTES,
) {
  const declaredLength = Number(response.headers.get("content-length") || 0);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    await response.body?.cancel();
    throw new AdapterError(
      `${provider} returned a response larger than the allowed limit.`,
      502,
    );
  }
  if (!response.body) return "";

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new AdapterError(
          `${provider} returned a response larger than the allowed limit.`,
          502,
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

export async function parseAdapterResponse(
  response: Response,
  provider: string,
) {
  const text = await boundedResponseText(response, provider);
  if (!text) return null;
  if (!response.headers.get("content-type")?.toLowerCase().includes("json"))
    return text;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new AdapterError(`${provider} returned invalid JSON.`, 502);
  }
}
