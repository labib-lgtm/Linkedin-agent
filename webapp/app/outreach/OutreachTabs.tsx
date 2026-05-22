"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { OutreachQueue } from "./OutreachQueue";
import { SequenceTab } from "./SequenceTab";

export function OutreachTabs() {
  return (
    <Tabs defaultValue="queue" className="w-full">
      <TabsList>
        <TabsTrigger value="queue">Comment queue</TabsTrigger>
        <TabsTrigger value="sequence">Prospect sequence</TabsTrigger>
      </TabsList>
      <TabsContent value="queue" className="pt-4">
        <OutreachQueue />
      </TabsContent>
      <TabsContent value="sequence" className="pt-4">
        <SequenceTab />
      </TabsContent>
    </Tabs>
  );
}
