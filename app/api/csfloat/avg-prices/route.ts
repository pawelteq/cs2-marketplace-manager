import { NextResponse } from "next/server";
import { clampSampleSize } from "@/lib/pricing";
import { fetchCsfloatAvgBatch } from "@/lib/markets/csfloat";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: { names?: string[]; sampleSize?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const names = (body.names ?? []).filter(
    (n): n is string => typeof n === "string" && n.length > 0,
  );
  if (names.length === 0) {
    return NextResponse.json({ prices: {} });
  }
  if (names.length > 80) {
    return NextResponse.json(
      { error: "Max 80 nazw na żądanie" },
      { status: 400 },
    );
  }

  const sampleSize = clampSampleSize(body.sampleSize ?? 5);

  try {
    const batch = await fetchCsfloatAvgBatch(names, sampleSize);
    const prices: Record<string, number> = {};
    for (const [name, data] of Object.entries(batch)) {
      prices[name] = data.avgNorm;
    }
    return NextResponse.json({ prices, sampleSize, details: batch });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "CSFloat avg failed" },
      { status: 502 },
    );
  }
}
