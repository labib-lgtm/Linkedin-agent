"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { OutreachQueue } from "./OutreachQueue";
import { SequenceTab } from "./SequenceTab";
import { ApolloProspectsTab } from "./ApolloProspectsTab";

export function OutreachTabs() {
  return (
    <Tabs defaultValue="queue" className="w-full">
      <TabsList>
        <TabsTrigger value="queue">Comment queue</TabsTrigger>
        <TabsTrigger value="sequence">Prospect sequence</TabsTrigger>
        <TabsTrigger value="apollo">Apollo prospects</TabsTrigger>
      </TabsList>
      <TabsContent value="queue" className="pt-4">
        <OutreachQueue />
      </TabsContent>
      <TabsContent value="sequence" className="pt-4">
        <SequenceTab />
      </TabsContent>
      <TabsContent value="apollo" className="pt-4">
        <ApolloProspectsTab />
      </TabsContent>
    </Tabs>
  );
}
