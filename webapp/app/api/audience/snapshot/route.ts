import { NextResponse } from "next/server";
import { tasks } from "@trigger.dev/sdk/v3";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// POST /api/audience/snapshot → fires snapshot-own-account on demand.
// Task is currently on-demand (not scheduled) while we're at the
// Trigger.dev schedule limit; Tab 1's Followers card fires this to refresh
// the follower/connection count.
export async function POST() {
  try {
    const handle = await tasks.trigger("snapshot-own-account", {});
    return NextResponse.json({ run_id: handle.id });
  } catch (e) {
    return NextResponse.json(
      { error: "trigger_failed", message: (e as Error).message },
      { status: 502 },
    );
  }
}
