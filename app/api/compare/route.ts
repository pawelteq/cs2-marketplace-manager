// GET /api/compare?name=<market_hash_name> — porównanie cen na wszystkich marketach.

import { NextResponse } from "next/server";
import { compareItem } from "@/lib/markets";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const name = (searchParams.get("name") || "").trim();

  if (!name) {
    return NextResponse.json(
      { error: "Parametr 'name' jest wymagany" },
      { status: 400 },
    );
  }

  try {
    const result = await compareItem(name);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Compare failed" },
      { status: 502 },
    );
  }
}
