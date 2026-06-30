// Czysta logika filtrowania arbitrażu — używana po stronie serwera i klienta.

import {
  buildArbitrageRowFromRaw,
  clampSampleSize,
  type PriceMode,
  priceModeLabel,
} from "@/lib/pricing";
import type { ArbitrageRow, ArbitrageSnapshot } from "@/lib/types";

export type ArbitrageSort = "spreadPct" | "spread" | "name";

export interface ArbitrageQuery {
  sort?: ArbitrageSort;
  sortDir?: "asc" | "desc";
  minSpreadPct?: number;
  /** @deprecated użyj minSkinportQty / minCsfloatQty */
  minQuantity?: number;
  minSkinportQty?: number;
  minCsfloatQty?: number;
  onlyBoth?: boolean;
  search?: string;
  page?: number;
  limit?: number;
  priceMode?: PriceMode;
  avgSampleSize?: number;
  /** CSFloat: średnie N najtańszych (PLN), klucz = market_hash_name */
  csfloatAvgByName?: Record<string, number>;
}

export interface ArbitragePage {
  rows: ArbitrageRow[];
  total: number;
  page: number;
  limit: number;
  currency: string;
  lastUpdatedAt: string;
  nextRefreshInSec: number;
  totalItems: number;
  bothMarketsCount: number;
  skinportAvailable: boolean;
  warnings: string[];
  appliedFilters: {
    minSpreadPct: number;
    minSkinportQty: number;
    minCsfloatQty: number;
    onlyBoth: boolean;
    search: string;
    priceMode: PriceMode;
    avgSampleSize: number;
    priceModeLabel: string;
  };
}

function csfloatSearchUrl(marketHashName: string): string {
  const params = new URLSearchParams({
    market_hash_name: marketHashName,
    sort_by: "lowest_price",
    type: "buy_now",
  });
  return `https://csfloat.com/search?${params}`;
}

function repriceRow(
  row: ArbitrageRow,
  priceMode: PriceMode,
  avgSampleSize: number,
  csfloatAvgByName?: Record<string, number>,
): ArbitrageRow {
  const sp = row.skinport;
  const cf = row.csfloat;
  if (!sp && !cf) return row;

  return buildArbitrageRowFromRaw(
    {
      marketHashName: row.marketHashName,
      skinportItem: sp
        ? {
            market_hash_name: row.marketHashName,
            currency: sp.currency,
            suggested_price: null,
            item_page: sp.url ?? "",
            market_page: "",
            min_price: sp.price,
            max_price: null,
            mean_price: sp.meanPrice ?? null,
            median_price: sp.medianPrice ?? null,
            quantity: sp.quantity,
          }
        : null,
      csfloatMinCents: cf ? Math.round(cf.price! * 100) : undefined,
      csfloatQuantity: cf?.quantity,
      csfloatAvgNorm: cf ? csfloatAvgByName?.[row.marketHashName] : undefined,
    },
    { priceMode, avgSampleSize },
    csfloatSearchUrl,
  );
}

function passesQuantityFilters(
  row: ArbitrageRow,
  minSkinportQty: number,
  minCsfloatQty: number,
  onlyBoth: boolean,
  csfloatFallback: boolean,
): boolean {
  const spQty = row.skinport?.quantity ?? 0;
  const cfQty = row.csfloat?.quantity ?? 0;

  if (onlyBoth && !csfloatFallback) {
    return (
      !!row.skinport &&
      !!row.csfloat &&
      spQty >= minSkinportQty &&
      cfQty >= minCsfloatQty
    );
  }

  if (csfloatFallback) {
    return !!row.csfloat && cfQty >= minCsfloatQty;
  }

  const spOk = !row.skinport || spQty >= minSkinportQty;
  const cfOk = !row.csfloat || cfQty >= minCsfloatQty;
  return spOk && cfOk;
}

export function filterArbitrageSnapshot(
  snapshot: ArbitrageSnapshot,
  query: ArbitrageQuery,
  nextRefreshInSec = 60,
): ArbitragePage {
  const sort = query.sort ?? "spreadPct";
  const sortDir = query.sortDir ?? "desc";
  const minSpreadPct = query.minSpreadPct ?? 0;
  const minSkinportQty =
    query.minSkinportQty ?? query.minQuantity ?? 5;
  const minCsfloatQty =
    query.minCsfloatQty ?? query.minQuantity ?? 5;
  const onlyBoth = query.onlyBoth ?? true;
  const search = (query.search ?? "").trim().toLowerCase();
  const page = Math.max(1, query.page ?? 1);
  const limit = Math.min(100, Math.max(1, query.limit ?? 50));
  const priceMode = query.priceMode ?? "avg";
  const avgSampleSize = clampSampleSize(query.avgSampleSize ?? 5);
  const csfloatAvgByName = query.csfloatAvgByName;

  const warnings: string[] = [];
  const csfloatFallback = !snapshot.skinportAvailable;
  const effectiveOnlyBoth = csfloatFallback ? false : onlyBoth;

  if (csfloatFallback) {
    warnings.push(
      "Skinport chwilowo niedostępny (limit API) — pokazuję oferty CSFloat. Spread ze Skinport niedostępny.",
    );
  }

  let filtered = snapshot.rows.map((row) =>
    repriceRow(row, priceMode, avgSampleSize, csfloatAvgByName),
  );

  if (effectiveOnlyBoth) {
    filtered = filtered.filter((r) => r.skinport && r.csfloat);
  } else if (csfloatFallback) {
    filtered = filtered.filter((r) => r.csfloat);
  }

  filtered = filtered.filter((r) =>
    passesQuantityFilters(
      r,
      minSkinportQty,
      minCsfloatQty,
      effectiveOnlyBoth,
      csfloatFallback,
    ),
  );

  if (minSpreadPct > 0 && !csfloatFallback) {
    filtered = filtered.filter(
      (r) => r.spreadPct !== null && r.spreadPct >= minSpreadPct,
    );
  }

  if (search) {
    filtered = filtered.filter((r) =>
      r.marketHashName.toLowerCase().includes(search),
    );
  }

  filtered = [...filtered].sort((a, b) => {
    let av: number | string;
    let bv: number | string;

    if (csfloatFallback) {
      av = a.csfloat?.normalizedPrice ?? -1;
      bv = b.csfloat?.normalizedPrice ?? -1;
      const cmp = (av as number) - (bv as number);
      return sortDir === "asc" ? cmp : -cmp;
    }

    switch (sort) {
      case "name":
        av = a.marketHashName;
        bv = b.marketHashName;
        break;
      case "spread":
        av = a.spread ?? -1;
        bv = b.spread ?? -1;
        break;
      case "spreadPct":
      default:
        av = a.spreadPct ?? -1;
        bv = b.spreadPct ?? -1;
        break;
    }

    if (typeof av === "string" && typeof bv === "string") {
      const cmp = av.localeCompare(bv, "pl");
      return sortDir === "asc" ? cmp : -cmp;
    }

    const cmp = (av as number) - (bv as number);
    return sortDir === "asc" ? cmp : -cmp;
  });

  const total = filtered.length;
  const start = (page - 1) * limit;

  return {
    rows: filtered.slice(start, start + limit),
    total,
    page,
    limit,
    currency: snapshot.currency,
    lastUpdatedAt: snapshot.lastUpdatedAt,
    nextRefreshInSec,
    totalItems: snapshot.totalItems,
    bothMarketsCount: snapshot.bothMarketsCount,
    skinportAvailable: snapshot.skinportAvailable,
    warnings: [...new Set([...snapshot.warnings, ...warnings])],
    appliedFilters: {
      minSpreadPct,
      minSkinportQty,
      minCsfloatQty,
      onlyBoth,
      search,
      priceMode,
      avgSampleSize,
      priceModeLabel: priceModeLabel(priceMode, avgSampleSize),
    },
  };
}

/** Nazwy itemów kwalifikujących się do pobrania średniej CSFloat. */
export function listCsfloatAvgCandidates(
  snapshot: ArbitrageSnapshot,
  query: Pick<
    ArbitrageQuery,
    "minSkinportQty" | "minCsfloatQty" | "onlyBoth" | "search" | "minQuantity"
  >,
  maxNames = 400,
): string[] {
  const minSkinportQty =
    query.minSkinportQty ?? query.minQuantity ?? 5;
  const minCsfloatQty =
    query.minCsfloatQty ?? query.minQuantity ?? 5;
  const onlyBoth = query.onlyBoth ?? true;
  const search = (query.search ?? "").trim().toLowerCase();
  const csfloatFallback = !snapshot.skinportAvailable;
  const effectiveOnlyBoth = csfloatFallback ? false : onlyBoth;

  const names: string[] = [];
  for (const row of snapshot.rows) {
    if (!row.csfloat) continue;
    if (
      !passesQuantityFilters(
        row,
        minSkinportQty,
        minCsfloatQty,
        effectiveOnlyBoth,
        csfloatFallback,
      )
    ) {
      continue;
    }
    if (effectiveOnlyBoth && (!row.skinport || !row.csfloat)) continue;
    if (search && !row.marketHashName.toLowerCase().includes(search)) continue;
    names.push(row.marketHashName);
    if (names.length >= maxNames) break;
  }
  return names;
}
