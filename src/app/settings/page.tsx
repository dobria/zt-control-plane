import { SettingsPage } from "@/features/settings/SettingsPage";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab } = await searchParams;
  return (
    <SettingsPage
      initialTab={tab === "security" || tab === "users" ? tab : "general"}
    />
  );
}
