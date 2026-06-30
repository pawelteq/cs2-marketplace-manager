// GET /api/arbitrage — tabela arbitrażu Skinport vs CSFloat (bulk snapshot).

import { NextResponse } from "next/server";
import { queryArbitrage } from "@/lib/sync/snapshot";
import type { ArbitrageSort } from "@/lib/sync/arbitrage-filter";

export const dynamic = "force-dynamic";

const VALID_SORT: ArbitrageSort[] = ["spreadPct", "spread", "name"];

function parseFilterInt(value: string | null, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.floor(n);
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  const sortParam = searchParams.get("sort") || "spreadPct";
  const sort = VALID_SORT.includes(sortParam as ArbitrageSort)
    ? (sortParam as ArbitrageSort)
    : "spreadPct";

    try {
    const priceMode =
      searchParams.get("priceMode") === "min" ? "min" : "avg";
    const result = await queryArbitrage({
      sort,
      sortDir: searchParams.get("sortDir") === "asc" ? "asc" : "desc",
      minSpreadPct: parseFilterInt(searchParams.get("minSpreadPct"), 0),
      minSkinportQty: parseFilterInt(
        searchParams.get("minSkinportQty") ??
          searchParams.get("minQuantity"),
        5,
      ),
      minCsfloatQty: parseFilterInt(
        searchParams.get("minCsfloatQty") ??
          searchParams.get("minQuantity"),
        5,
      ),
      onlyBoth: searchParams.get("onlyBoth") !== "false",
      search: searchParams.get("search") || "",
      page: Number(searchParams.get("page") || "1"),
      limit: Number(searchParams.get("limit") || "50"),
      priceMode,
      avgSampleSize: parseFilterInt(searchParams.get("avgSampleSize"), 5),
    });

    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Arbitrage fetch failed" },
      { status: 502 },
    );
  }
}
