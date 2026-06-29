// GET /api/search?q=ak-47 — wyszukiwanie nazw itemów (autocomplete).
// Korzysta z pełnej listy Skinport jako katalogu nazw.

import { NextResponse } from "next/server";
import { DEFAULT_CURRENCY } from "@/lib/config";
import { fetchSkinportItems } from "@/lib/markets/skinport";
import type { SearchHit } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = (searchParams.get("q") || "").trim().toLowerCase();

  if (q.length < 2) {
    return NextResponse.json({ hits: [] as SearchHit[] });
  }

  try {
    const items = await fetchSkinportItems();
    const hits: SearchHit[] = items
      .filter((it) => it.market_hash_name.toLowerCase().includes(q))
      .slice(0, 25)
      .map((it) => ({
        marketHashName: it.market_hash_name,
        refPrice: it.min_price,
        currency: it.currency || DEFAULT_CURRENCY,
      }));
    return NextResponse.json({ hits });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Search failed", hits: [] },
      { status: 502 },
    );
  }
}
