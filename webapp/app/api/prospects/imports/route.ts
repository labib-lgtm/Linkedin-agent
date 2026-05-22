import { NextResponse, type NextRequest } from "next/server";
import Papa from "papaparse";
import { tasks } from "@trigger.dev/sdk/v3";
import { createServiceClient } from "@/lib/supabase/server";
import { getActiveAccountId } from "@/lib/active-account";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB — fits 6,000+ rows easily
const DEFAULT_LIMIT = 200;
// Import the full book in one go; the daily-enrich scheduler paces the
// actual enrichment at ~200 Sales Nav calls/day, so a large pending
// backlog is fine (it just drains over days).
const HARD_LIMIT = 6000;

// Case-insensitive header lookup. The Google-Sheet export has clean headers
// but real-world CSVs vary; this trims whitespace and ignores case.
function headerLookup(row: Record<string, unknown>): (key: string) => string | undefined {
  const norm = new Map<string, string>();
  for (const k of Object.keys(row)) {
    norm.set(k.trim().toLowerCase(), k);
  }
  return (key: string) => {
    const realKey = norm.get(key.trim().toLowerCase());
    if (!realKey) return undefined;
    const v = row[realKey];
    if (v === null || v === undefined) return undefined;
    const s = String(v).trim();
    return s.length ? s : undefined;
  };
}

function num(s: string | undefined): number | null {
  if (!s) return null;
  // Strip $ , % and whitespace.
  const cleaned = s.replace(/[$,%\s]/g, "");
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function int(s: string | undefined): number | null {
  const n = num(s);
  return n === null ? null : Math.round(n);
}

// POST /api/prospects/imports — multipart CSV upload. Parses, validates,
// inserts a seller_imports row + N sellers rows (pending), then fires the
// Trigger.dev `enrich-seller-imports` task.
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

  // Limit (optional). Hard-cap at HARD_LIMIT regardless of caller input.
  const rawLimit = form.get("limit");
  let limit = DEFAULT_LIMIT;
  if (typeof rawLimit === "string" && rawLimit.trim()) {
    const parsed = parseInt(rawLimit.trim(), 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      limit = Math.min(parsed, HARD_LIMIT);
    }
  }

  const csvText = await file.text();
  const parsed = Papa.parse<Record<string, unknown>>(csvText, {
    header: true,
    skipEmptyLines: true,
  });

  if (parsed.errors.length > 0) {
    // Just surface the first error — Papa is lenient and will keep going,
    // but a single hard parse failure usually means malformed quotes.
    const firstFatal = parsed.errors.find((e) => e.type === "Quotes" || e.type === "Delimiter");
    if (firstFatal) {
      return NextResponse.json(
        { error: "csv_parse_error", message: firstFatal.message },
        { status: 400 },
      );
    }
  }

  const rows = parsed.data.slice(0, limit);
  if (rows.length === 0) {
    return NextResponse.json({ error: "no_rows" }, { status: 400 });
  }

  // Validate required columns on the first row.
  const probe = headerLookup(rows[0]);
  if (!probe("Seller") && !probe("Business Name")) {
    return NextResponse.json(
      {
        error: "missing_required_columns",
        message:
          "CSV must include at least 'Seller' or 'Business Name' column (case-insensitive).",
      },
      { status: 400 },
    );
  }

  const supabase = createServiceClient();
  const accountId = await getActiveAccountId();

  // Create the import row first so we have an id to attach sellers to.
  const { data: importRow, error: impErr } = await supabase
    .from("seller_imports")
    .insert({
      account_id: accountId,
      filename: file.name,
      row_count: rows.length,
      status: "queued",
    })
    .select()
    .single();
  if (impErr || !importRow) {
    return NextResponse.json(
      { error: "import_insert_failed", message: impErr?.message ?? "no row returned" },
      { status: 500 },
    );
  }

  // Build the sellers rows.
  const sellers = rows.map((r) => {
    const lookup = headerLookup(r);
    return {
      import_id: importRow.id as string,
      account_id: accountId,
      seller_name: lookup("Seller") ?? null,
      business_name: lookup("Business Name") ?? null,
      category: lookup("Category") ?? null,
      primary_subcategory: lookup("Primary Subcategory") ?? null,
      est_monthly_revenue: num(lookup("Estimated Monthly Revenue")),
      avg_price: num(lookup("Average Price")),
      percent_fba: num(lookup("Percent FBA")),
      num_asins: int(lookup("Number of ASINs")),
      num_brands: int(lookup("Number of Brands Selling")),
      growth_3mo: num(lookup("3 Month Growth")),
      city: lookup("City") ?? null,
      state: lookup("State") ?? null,
      country: lookup("Country") ?? null,
      storefront_url: lookup("URL") ?? null,
      enrichment_status: "pending" as const,
    };
  });

  // Insert in chunks of 500 to avoid Supabase request-size limits.
  const CHUNK = 500;
  for (let i = 0; i < sellers.length; i += CHUNK) {
    const slice = sellers.slice(i, i + CHUNK);
    const { error: sErr } = await supabase.from("sellers").insert(slice);
    if (sErr) {
      // Roll back the import row + any sellers already inserted.
      await supabase.from("seller_imports").delete().eq("id", importRow.id);
      return NextResponse.json(
        { error: "sellers_insert_failed", message: sErr.message },
        { status: 500 },
      );
    }
  }

  // Fire the enrichment task. The Trigger.dev secret is required.
  if (!process.env.TRIGGER_SECRET_KEY) {
    await supabase
      .from("seller_imports")
      .update({ status: "failed", error: "TRIGGER_SECRET_KEY not configured" })
      .eq("id", importRow.id);
    return NextResponse.json(
      {
        error: "trigger_not_configured",
        message: "TRIGGER_SECRET_KEY env var missing. Set in Vercel project settings.",
      },
      { status: 503 },
    );
  }

  try {
    // Budget the initial run too, so a large import processes one safe
    // batch immediately, then the daily-enrich scheduler drains the rest
    // at ~200 Sales Nav calls/day without hitting the 1h maxDuration.
    const handle = await tasks.trigger("enrich-seller-imports", {
      importId: importRow.id,
      budget: 200,
    });
    await supabase
      .from("seller_imports")
      .update({ status: "processing" })
      .eq("id", importRow.id);
    return NextResponse.json({
      importId: importRow.id,
      rowCount: rows.length,
      runId: handle.id,
    });
  } catch (e) {
    await supabase
      .from("seller_imports")
      .update({ status: "failed", error: (e as Error).message })
      .eq("id", importRow.id);
    return NextResponse.json(
      { error: "trigger_failed", message: (e as Error).message },
      { status: 502 },
    );
  }
}

// GET /api/prospects/imports — list recent imports for active account.
export async function GET() {
  const supabase = createServiceClient();
  const accountId = await getActiveAccountId();
  const { data, error } = await supabase
    .from("seller_imports")
    .select("*")
    .eq("account_id", accountId)
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ imports: data ?? [] });
}
