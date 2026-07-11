"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AudienceTab } from "./AudienceTab";
import { RequestsTab } from "./RequestsTab";
import { TargetingTab } from "./TargetingTab";
import { CompetitorsTab } from "./CompetitorsTab";
import { MonthlyReportTab } from "./MonthlyReportTab";

export function AudienceTabs() {
  return (
    <Tabs defaultValue="audience" className="w-full">
      <TabsList>
        <TabsTrigger value="audience">Audience</TabsTrigger>
        <TabsTrigger value="requests">Requests</TabsTrigger>
        <TabsTrigger value="targeting">Targeting</TabsTrigger>
        <TabsTrigger value="competitors">Competitors</TabsTrigger>
        <TabsTrigger value="report">Monthly report</TabsTrigger>
      </TabsList>
      <TabsContent value="audience" className="pt-4"><AudienceTab /></TabsContent>
      <TabsContent value="requests" className="pt-4"><RequestsTab /></TabsContent>
      <TabsContent value="targeting" className="pt-4"><TargetingTab /></TabsContent>
      <TabsContent value="competitors" className="pt-4"><CompetitorsTab /></TabsContent>
      <TabsContent value="report" className="pt-4"><MonthlyReportTab /></TabsContent>
    </Tabs>
  );
}
