import { NextRequest, NextResponse } from "next/server";
import { getAppSettings } from "@/lib/settings";
import {
  ipAllowlistBypassed,
  ipMatchesAccessList,
  trustedClientIp,
} from "@/lib/ip-access";

function enforceIpAccess(request: NextRequest) {
  if (request.nextUrl.pathname === "/api/health") return null;
  const settings = getAppSettings();
  if (!settings.ipAllowlistEnabled || ipAllowlistBypassed()) return null;
  const address = trustedClientIp(request.headers);
  if (address && ipMatchesAccessList(address, settings.ipAllowlist))
    return null;
  const headers = {
    "Cache-Control": "no-store",
    "Content-Type": request.nextUrl.pathname.startsWith("/api/")
      ? "application/json; charset=utf-8"
      : "text/plain; charset=utf-8",
  };
  return new NextResponse(
    request.nextUrl.pathname.startsWith("/api/")
      ? JSON.stringify({ error: "Access denied.", code: "IP_ACCESS_DENIED" })
      : "Access denied. Your IP address is not permitted to use this control plane.",
    { status: 403, headers },
  );
}

export function proxy(request: NextRequest) {
  const accessDenied = enforceIpAccess(request);
  if (accessDenied) return accessDenied;
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const development = process.env.NODE_ENV !== "production";
  const contentSecurityPolicy = [
    "default-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "img-src 'self' data:",
    `script-src 'self' 'nonce-${nonce}'${development ? " 'unsafe-eval'" : ""}`,
    "style-src 'self'",
    "connect-src 'self'",
    "font-src 'self' data:",
    "worker-src 'self' blob:",
    ...(development ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", contentSecurityPolicy);
  const response = NextResponse.next({
    request: { headers: requestHeaders },
  });
  response.headers.set("Content-Security-Policy", contentSecurityPolicy);
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Cross-Origin-Opener-Policy", "same-origin");
  response.headers.set("Cross-Origin-Resource-Policy", "same-origin");
  response.headers.set("X-DNS-Prefetch-Control", "off");
  const publicUrl = process.env.APP_PUBLIC_URL?.trim();
  if (
    process.env.NODE_ENV === "production" &&
    (request.nextUrl.protocol === "https:" || publicUrl?.startsWith("https://"))
  )
    response.headers.set(
      "Strict-Transport-Security",
      "max-age=31536000; includeSubDomains",
    );
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
