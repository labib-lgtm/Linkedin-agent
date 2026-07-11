import { NextResponse } from "next/server";
import { tasks } from "@trigger.dev/sdk/v3";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// POST /api/audience/competitors/mine-engagers → fires the daily mine task manually
export async function POST() {
  try {
    const handle = await tasks.trigger("mine-competitor-engagers", {});
    return NextResponse.json({ run_id: handle.id });
  } catch (e) {
    return NextResponse.json(
      { error: "trigger_failed", message: (e as Error).message },
      { status: 502 },
    );
  }
}
