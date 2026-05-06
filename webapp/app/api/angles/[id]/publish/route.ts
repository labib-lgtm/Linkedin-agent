import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

const UNIPILE_API_KEY = process.env.UNIPILE_API_KEY;
const UNIPILE_DSN = process.env.UNIPILE_DSN;
const UNIPILE_LINKEDIN_ACCOUNT_ID = process.env.UNIPILE_LINKEDIN_ACCOUNT_ID;

const PUBLISHABLE_STATUSES = new Set(["Visual Ready", "Drafted", "Scheduled"]);

export async function POST(
  _request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  if (!UNIPILE_API_KEY || !UNIPILE_DSN || !UNIPILE_LINKEDIN_ACCOUNT_ID) {
    return NextResponse.json(
      {
        error:
          "Unipile env vars not set in Vercel. Required: UNIPILE_API_KEY, UNIPILE_DSN, UNIPILE_LINKEDIN_ACCOUNT_ID.",
      },
      { status: 500 },
    );
  }

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

  // Webapp can only publish text-only posts directly. Media posts (image,
  // carousel) need the local CLI because the rendered asset lives on the
  // user's Mac, not Vercel. Tell the caller to use the CLI for those.
  if (fmt !== "text") {
    return NextResponse.json(
      {
        error: "media_publish_not_supported",
        message: `${fmt} posts must be published from the CLI (asset is local). Run: python3 tools/unipile_publish.py --angle-id ${id}`,
      },
      { status: 422 },
    );
  }

  // Publish text-only via Unipile.
  const dsn = UNIPILE_DSN.replace(/\/$/, "");
  const publishResp = await fetch(`${dsn}/api/v1/posts`, {
    method: "POST",
    headers: {
      "X-API-KEY": UNIPILE_API_KEY,
      "Content-Type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      account_id: UNIPILE_LINKEDIN_ACCOUNT_ID,
      text: body,
    }),
  });

  if (!publishResp.ok) {
    const errText = await publishResp.text().catch(() => "");
    return NextResponse.json(
      {
        error: "unipile_publish_failed",
        status: publishResp.status,
        body: errText.slice(0, 800),
      },
      { status: 502 },
    );
  }

  const publishJson = (await publishResp.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  const postId =
    (publishJson.post_id as string | undefined) ??
    (publishJson.id as string | undefined) ??
    (publishJson.social_id as string | undefined) ??
    (publishJson.urn as string | undefined);
  if (!postId) {
    return NextResponse.json(
      {
        error: "unipile_response_missing_post_id",
        payload: JSON.stringify(publishJson).slice(0, 800),
      },
      { status: 502 },
    );
  }

  const postUrl =
    (publishJson.share_url as string | undefined) ??
    (publishJson.url as string | undefined) ??
    (publishJson.post_url as string | undefined) ??
    (publishJson.public_url as string | undefined) ??
    `https://www.linkedin.com/feed/update/${postId}/`;

  // Update angle row + insert audit event (best-effort).
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

  return NextResponse.json({
    angle_id: id,
    post_id: postId,
    post_url: postUrl,
  });
}
