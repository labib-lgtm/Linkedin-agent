import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { publishMediaPost, publishTextPost, UnipileError } from "@/lib/unipile";

const PUBLISHABLE_STATUSES = new Set(["Visual Ready", "Drafted", "Scheduled"]);
const STORAGE_BUCKET = "post-assets";

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

  // Phase E: pull the right media bytes out of Storage and ship via
  // Unipile's multipart endpoint.
  //   carousel  → angles.carousel_pdf_path (rendered PDF, one page per slide)
  //   image     → first picked variant from slide_image_paths
  //   text/poll → no attachment, plain text post
  let postId: string;
  let postUrl: string;
  let mediaUrn: string | null = null;
  try {
    if (fmt === "carousel") {
      const path = angle.carousel_pdf_path as string | null;
      if (!path) {
        return NextResponse.json(
          { error: "no_pdf", message: "Render the carousel PDF first (studio → Render & publish)." },
          { status: 400 },
        );
      }
      const { data: file, error: dlErr } = await supabase.storage
        .from(STORAGE_BUCKET)
        .download(path);
      if (dlErr || !file) {
        return NextResponse.json(
          { error: "download_failed", message: dlErr?.message ?? "PDF not in Storage" },
          { status: 500 },
        );
      }
      const arr = new Uint8Array(await file.arrayBuffer());
      const result = await publishMediaPost(body, [
        { bytes: arr, mime: "application/pdf", filename: `${id}-carousel.pdf` },
      ]);
      postId = result.postId;
      postUrl = result.postUrl;
      mediaUrn = (result.raw.media_urn as string | undefined) ?? null;
    } else if (fmt === "image") {
      const paths = (angle.slide_image_paths as Record<string, string> | null) ?? {};
      const firstPath = paths["1"] ?? Object.values(paths)[0] ?? null;
      if (!firstPath) {
        return NextResponse.json(
          { error: "no_image", message: "Generate + pick an image variant first." },
          { status: 400 },
        );
      }
      const { data: file, error: dlErr } = await supabase.storage
        .from(STORAGE_BUCKET)
        .download(firstPath);
      if (dlErr || !file) {
        return NextResponse.json(
          { error: "download_failed", message: dlErr?.message ?? "image not in Storage" },
          { status: 500 },
        );
      }
      const arr = new Uint8Array(await file.arrayBuffer());
      const mime =
        firstPath.endsWith(".png") ? "image/png" :
        firstPath.endsWith(".webp") ? "image/webp" : "image/jpeg";
      const result = await publishMediaPost(body, [
        { bytes: arr, mime, filename: `${id}.${mime.split("/")[1]}` },
      ]);
      postId = result.postId;
      postUrl = result.postUrl;
      mediaUrn = (result.raw.media_urn as string | undefined) ?? null;
    } else if (fmt === "text" || fmt === "poll") {
      const result = await publishTextPost(body);
      postId = result.postId;
      postUrl = result.postUrl;
    } else {
      return NextResponse.json(
        {
          error: "format_not_supported",
          message: `${fmt} posts aren't auto-publishable yet. Use the CLI: python3 tools/unipile_publish.py --angle-id ${id}`,
        },
        { status: 422 },
      );
    }
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
      published_media_urn: mediaUrn,
    })
    .eq("angle_id", id);

  await supabase.from("audit_log").insert({
    angle_id: id,
    event_type: "post_published",
    payload: { format: fmt, post_url: postUrl, source: "webapp" },
  });

  return NextResponse.json({ angle_id: id, post_id: postId, post_url: postUrl });
}
