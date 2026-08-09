import { DevicesPage } from "@/features/nodes/DevicesPage";

export default async function Page({
  params,
}: {
  params: Promise<{ controllerId: string }>;
}) {
  const { controllerId } = await params;
  return <DevicesPage controllerId={controllerId} />;
}
