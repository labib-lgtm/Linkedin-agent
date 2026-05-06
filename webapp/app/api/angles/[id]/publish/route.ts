import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { publishTextPost, UnipileError } from "@/lib/unipile";

const PUBLISHABLE_STATUSES = new Set(["Visual Ready", "Drafted", "Scheduled"]);

export async function POST(
  _request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const supabase = createServiceClient();

  const { data: angle, error: fetchErr } = await supabase
    .from("angles")
    .select("*")
    .eq("angle_id", id)
    .single();

  if (fetchErr || !angle) {
    return NextResponse.json(
      { error: fetchErr?.message ?? "angle_not_found" },
      { status: 404 },
    );
  }

  if (!PUBLISHABLE_STATUSES.has(angle.status)) {
    return NextResponse.json(
      {
        error: `status is '${angle.status}'. Must be one of: ${[...PUBLISHABLE_STATUSES].join(", ")}.`,
      },
      { status: 400 },
    );
  }

  const body = String(angle.draft_body ?? "").trim();
  if (!body) {
    return NextResponse.json(
      { error: "draft_body is empty. Run 04_post_writer first." },
      { status: 400 },
    );
  }

  const fmt = String(angle.format ?? "text").toLowerCase();
  if (fmt !== "text") {
    return NextResponse.json(
      {
        error: "media_publish_not_supported",
        message: `${fmt} posts must be published from the CLI (asset is local). Run: python3 tools/unipile_publish.py --angle-id ${id}`,
      },
      { status: 422 },
    );
  }

  let postId: string;
  let postUrl: string;
  try {
    const result = await publishTextPost(body);
    postId = result.postId;
    postUrl = result.postUrl;
  } catch (e) {
    if (e instanceof UnipileError) {
      return NextResponse.json(
        { error: "unipile_publish_failed", status: e.status, body: e.body },
        { status: e.status === 400 ? 500 : 502 },
      );
    }
    return NextResponse.json(
      { error: "unipile_publish_failed", message: (e as Error).message },
      { status: 502 },
    );
  }

  await supabase
    .from("angles")
    .update({
      status: "Posted",
      date_posted: new Date().toISOString(),
      post_url: postUrl,
    })
    .eq("angle_id", id);

  await supabase.from("audit_log").insert({
    angle_id: id,
    event_type: "post_published",
    payload: { format: fmt, post_url: postUrl, source: "webapp" },
  });

  return NextResponse.json({ angle_id: id, post_id: postId, post_url: postUrl });
}
