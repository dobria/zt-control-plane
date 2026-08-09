import { Suspense } from "react";
import { AuditPage } from "@/features/audit/AuditPage";
export default function Page() {
  return (
    <Suspense fallback={<div className="skeleton tall" />}>
      <AuditPage />
    </Suspense>
  );
}
