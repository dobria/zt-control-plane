import { NetworkDetailPage } from "@/features/networks/NetworkDetailPage";
import { networkTab } from "@/lib/network-tabs";

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ controllerId: string; networkId: string }>;
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
  const { controllerId, networkId } = await params;
  const { tab } = await searchParams;
  return (
    <NetworkDetailPage
      controllerId={controllerId}
      networkId={networkId}
      initialTab={networkTab(tab)}
    />
  );
}
