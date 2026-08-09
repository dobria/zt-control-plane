import type { Metadata } from "next";
import type { ReactNode } from "react";
import { headers } from "next/headers";
import "./base.css";
import "./globals.css";
import { AppShell } from "@/shared/layout/AppShell";

export const metadata: Metadata = {
  title: "ZT Control Plane",
  description: "Self-hosted multi-controller ZeroTier management",
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  await headers();
  return (
    <html lang="en">
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
