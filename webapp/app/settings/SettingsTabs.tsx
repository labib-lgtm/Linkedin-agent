"use client";

import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { IntegrationsPanel } from "./IntegrationsPanel";
import { AccountPanel } from "./AccountPanel";
import { BusinessPanel } from "./BusinessPanel";
import { AccountsPanel } from "./AccountsPanel";
import { LeadMagnetsPanel } from "./LeadMagnetsPanel";
import type { SettingService, SettingKey } from "@/lib/settings";

export type SettingsPayload = {
  groups: Record<
    SettingService,
    Array<{
      key: SettingKey;
      label: string;
      hasValue: boolean;
      source: "db" | "env" | null;
      masked: string;
      readOnly: boolean;
      secret: boolean;
    }>
  >;
  lastUpdated: string | null;
};

export function SettingsTabs({ initial }: { initial: SettingsPayload }) {
  const [data, setData] = useState<SettingsPayload>(initial);

  return (
    <Tabs defaultValue="accounts" className="w-full">
      <TabsList>
        <TabsTrigger value="accounts">Accounts</TabsTrigger>
        <TabsTrigger value="integrations">Integrations</TabsTrigger>
        <TabsTrigger value="business">Business</TabsTrigger>
        <TabsTrigger value="lead-magnets">Lead Magnets</TabsTrigger>
        <TabsTrigger value="account">Sign-in</TabsTrigger>
        <TabsTrigger value="preferences">Preferences</TabsTrigger>
      </TabsList>

      <TabsContent value="accounts">
        <AccountsPanel />
      </TabsContent>

      <TabsContent value="integrations">
        <IntegrationsPanel data={data} onChange={setData} />
      </TabsContent>

      <TabsContent value="business">
        <BusinessPanel data={data} onChange={setData} />
      </TabsContent>

      <TabsContent value="lead-magnets">
        <LeadMagnetsPanel />
      </TabsContent>

      <TabsContent value="account">
        <AccountPanel />
      </TabsContent>

      <TabsContent value="preferences">
        <p className="text-sm text-muted-foreground">
          More preferences coming soon.
        </p>
      </TabsContent>
    </Tabs>
  );
}
