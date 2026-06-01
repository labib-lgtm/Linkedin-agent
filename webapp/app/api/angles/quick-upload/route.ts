import { NextResponse, type NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { createServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const STORAGE_BUCKET = "post-assets";

// LinkedIn caps: images ~10 MB, document/PDF carousels ~100 MB. We hard-cap
// here so a runaway upload can't fill Storage. Image cap is lower than
// LinkedIn's max because a >5 MB single image is almost certainly the wrong
// thing to attach anyway.
const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // 8 MB
const MAX_PDF_BYTES = 80 * 1024 * 1024; // 80 MB

const IMAGE_MIMES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/webp": "webp",
};
const PDF_MIMES: Record<string, string> = {
  "application/pdf": "pdf",
};

// POST /api/angles/quick-upload
//
// multipart/form-data with a single `file` field. Validates MIME + size,
// uploads to the post-assets Supabase Storage bucket under
// quick/<uuid>/<filename>, and returns:
//   { path, format, mime, bytes, filename }
//
// The caller then PATCHes the angle with the right field:
//   image     → format='image',    slide_image_paths={"1": path}
//   carousel  → format='carousel', carousel_pdf_path=path
export async function POST(req: NextRequest) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch (e) {
    return NextResponse.json(
      { error: "invalid_multipart", message: (e as Error).message },
      { status: 400 },
    );
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file_missing" }, { status: 400 });
  }

  const mime = (file.type || "").toLowerCase();
  const isImage = mime in IMAGE_MIMES;
  const isPdf = mime in PDF_MIMES;
  if (!isImage && !isPdf) {
    return NextResponse.json(
      {
        error: "unsupported_type",
        message: `MIME '${mime}' not supported. Allowed: PNG, JPG, WebP, PDF.`,
      },
      { status: 415 },
    );
  }

  const cap = isImage ? MAX_IMAGE_BYTES : MAX_PDF_BYTES;
  if (file.size > cap) {
    return NextResponse.json(
      {
        error: "too_large",
        message: `${file.size} bytes is over the ${cap}-byte cap for this MIME.`,
        cap,
      },
      { status: 413 },
    );
  }
  if (file.size === 0) {
    return NextResponse.json({ error: "empty_file" }, { status: 400 });
  }

  const extension = isImage ? IMAGE_MIMES[mime] : PDF_MIMES[mime];
  const safeName = (file.name || `creative.${extension}`)
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .slice(0, 80);
  const folder = `quick/${randomUUID()}`;
  const path = `${folder}/${safeName.endsWith("." + extension) ? safeName : `${safeName}.${extension}`}`;

  const bytes = new Uint8Array(await file.arrayBuffer());
  const supabase = createServiceClient();
  const { error: upErr } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(path, bytes, {
      contentType: mime,
      cacheControl: "3600",
      upsert: false,
    });
  if (upErr) {
    return NextResponse.json(
      { error: "upload_failed", message: upErr.message },
      { status: 500 },
    );
  }

  return NextResponse.json({
    path,
    format: isImage ? "image" : "carousel",
    mime,
    bytes: file.size,
    filename: safeName,
  });
}
