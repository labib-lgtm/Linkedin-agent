import { NextResponse, type NextRequest } from "next/server";
import {
  describeSettings,
  setSetting,
  SETTING_KEYS,
  type SettingKey,
} from "@/lib/settings";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const data = await describeSettings();
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message },
      { status: 500 },
    );
  }
}

export async function PUT(req: NextRequest) {
  let body: { key?: string; value?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const key = String(body.key ?? "") as SettingKey;
  const value = String(body.value ?? "");
  if (!(key in SETTING_KEYS)) {
    return NextResponse.json({ error: "unknown_key" }, { status: 400 });
  }

  try {
    await setSetting(key, value);
    const data = await describeSettings();
    return NextResponse.json({ ok: true, ...data });
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message },
      { status: 500 },
    );
  }
}
