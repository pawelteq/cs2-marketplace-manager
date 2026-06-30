// Czysta logika filtrowania arbitrażu — używana po stronie serwera i klienta.

import type { ArbitrageRow, ArbitrageSnapshot } from "@/lib/types";

export type ArbitrageSort = "spreadPct" | "spread" | "name";

export interface ArbitrageQuery {
  sort?: ArbitrageSort;
  sortDir?: "asc" | "desc";
  minSpreadPct?: number;
  minQuantity?: number;
  onlyBoth?: boolean;
  search?: string;
  page?: number;
  limit?: number;
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
    minQuantity: number;
    onlyBoth: boolean;
    search: string;
  };
}

export function filterArbitrageSnapshot(
  snapshot: ArbitrageSnapshot,
  query: ArbitrageQuery,
  nextRefreshInSec = 60,
): ArbitragePage {
  const sort = query.sort ?? "spreadPct";
  const sortDir = query.sortDir ?? "desc";
  const minSpreadPct = query.minSpreadPct ?? 0;
  const minQuantity = query.minQuantity ?? 5;
  const onlyBoth = query.onlyBoth ?? true;
  const search = (query.search ?? "").trim().toLowerCase();
  const page = Math.max(1, query.page ?? 1);
  const limit = Math.min(100, Math.max(1, query.limit ?? 50));
  const warnings: string[] = [];
  const csfloatFallback = !snapshot.skinportAvailable;
  const effectiveOnlyBoth = csfloatFallback ? false : onlyBoth;

  if (csfloatFallback) {
    warnings.push(
      "Skinport chwilowo niedostępny (limit API) — pokazuję oferty CSFloat. Spread ze Skinport niedostępny.",
    );
  }

  let filtered = snapshot.rows;

  if (effectiveOnlyBoth) {
    filtered = filtered.filter((r) => r.skinport && r.csfloat);
  } else if (csfloatFallback) {
    filtered = filtered.filter((r) => r.csfloat);
  }

  if (minSpreadPct > 0 && !csfloatFallback) {
    filtered = filtered.filter(
      (r) => r.spreadPct !== null && r.spreadPct >= minSpreadPct,
    );
  }

  if (minQuantity > 0) {
    filtered = filtered.filter((r) => {
      const spQty = r.skinport?.quantity ?? 0;
      const cfQty = r.csfloat?.quantity ?? 0;

      if (effectiveOnlyBoth) {
        return spQty >= minQuantity && cfQty >= minQuantity;
      }

      if (csfloatFallback) {
        return cfQty >= minQuantity;
      }

      const spOk = !r.skinport || spQty >= minQuantity;
      const cfOk = !r.csfloat || cfQty >= minQuantity;
      return spOk && cfOk;
    });
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
      minQuantity,
      onlyBoth,
      search,
    },
  };
}
