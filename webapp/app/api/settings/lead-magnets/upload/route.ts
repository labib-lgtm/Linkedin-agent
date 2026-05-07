import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getActiveAccountId } from "@/lib/active-account";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const BUCKET = "lead-magnets";
const MAX_BYTES = 25 * 1024 * 1024; // 25 MB
const ALLOWED_MIME = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "video/mp4",
  "application/zip",
]);

function safeFilename(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

// POST /api/settings/lead-magnets/upload — multipart file upload.
// Returns { file_path, public_url } that the create-magnet form then
// posts to /api/settings/lead-magnets together with the operator-supplied
// label + description.
export async function POST(req: NextRequest) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "invalid_form" }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file_missing" }, { status: 400 });
  }

  if (file.size === 0) {
    return NextResponse.json({ error: "empty_file" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: "file_too_large", message: `Max ${MAX_BYTES / 1024 / 1024} MB.` },
      { status: 413 },
    );
  }
  if (file.type && !ALLOWED_MIME.has(file.type)) {
    return NextResponse.json(
      {
        error: "unsupported_mime",
        message: `Allowed: PDF, PNG, JPEG, WebP, MP4, ZIP. Got ${file.type}.`,
      },
      { status: 415 },
    );
  }

  const supabase = createServiceClient();
  const accountId = await getActiveAccountId();
  const ext = file.name.includes(".") ? file.name.split(".").pop()! : "";
  const base = safeFilename(file.name.replace(/\.[^.]+$/, "")) || "asset";
  const id = crypto.randomUUID();
  const path = `${accountId}/${id}-${base}${ext ? `.${ext}` : ""}`;

  const bytes = new Uint8Array(await file.arrayBuffer());
  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(path, bytes, {
      contentType: file.type || "application/octet-stream",
      upsert: false,
    });
  if (upErr) {
    return NextResponse.json(
      {
        error: "upload_failed",
        message: upErr.message.includes("not found")
          ? `Bucket "${BUCKET}" not found. Create a public-read bucket named "${BUCKET}" in the Supabase dashboard.`
          : upErr.message,
      },
      { status: 500 },
    );
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "";
  const publicUrl = supabaseUrl
    ? `${supabaseUrl}/storage/v1/object/public/${BUCKET}/${path}`
    : path;

  return NextResponse.json({ file_path: path, public_url: publicUrl });
}
