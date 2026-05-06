import { describeSettings } from "@/lib/settings";
import { SettingsTabs } from "./SettingsTabs";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const initial = await describeSettings();
  return (
    <div className="container-tight py-6 sm:py-8">
      <div className="flex items-baseline justify-between mb-6">
        <h1 className="font-heading text-2xl sm:text-3xl font-bold tracking-tight">
          Settings
        </h1>
        <p className="text-xs text-muted-foreground">
          Values saved here override Vercel env vars at runtime.
        </p>
      </div>
      <SettingsTabs initial={initial} />
    </div>
  );
}
