// Buduje snapshot arbitrażu z bulk API Skinport + CSFloat.
// Skinport odświeża się co 10 min, CSFloat co 1 min (TTL w adapterach).

import { getCatalogItemCount } from "@/lib/skinport/catalog-store";
import { DEFAULT_CURRENCY, USD_TO_DEFAULT_FX } from "@/lib/config";
import { getCsfloatPriceIndex } from "@/lib/markets/csfloat";
import {
  fetchSkinportItems,
  getSkinportStatusWarning,
  isSkinportBackoffActive,
} from "@/lib/markets/skinport";
import { ensureSkinportSyncWorkerStarted } from "@/lib/skinport/sync-worker";
import {
  filterArbitrageSnapshot,
  type ArbitragePage,
  type ArbitrageQuery,
  type ArbitrageSort,
} from "@/lib/sync/arbitrage-filter";
import type { ArbitrageRow, ArbitrageSnapshot, MarketSnapshot } from "@/lib/types";

export type { ArbitragePage, ArbitrageQuery, ArbitrageSort };
export { filterArbitrageSnapshot };
import { onArbitrageSnapshotInvalidate } from "@/lib/sync/invalidate";

const SNAPSHOT_TTL_MS = 10 * 60 * 1000; // zgodnie z interwałem sync Skinport

function csfloatSearchUrl(marketHashName: string): string {
  const params = new URLSearchParams({
    market_hash_name: marketHashName,
    sort_by: "lowest_price",
    type: "buy_now",
  });
  return `https://csfloat.com/search?${params}`;
}

function buildSpread(
  a: number | null,
  b: number | null,
): { spread: number | null; spreadPct: number | null; cheaperOn: "skinport" | "csfloat" | null } {
  if (a === null || b === null || a <= 0 || b <= 0) {
    return { spread: null, spreadPct: null, cheaperOn: null };
  }

  const cheaperOn = a < b ? "skinport" : b < a ? "csfloat" : null;
  const cheapest = Math.min(a, b);
  const dearest = Math.max(a, b);

  if (cheapest === dearest) {
    return { spread: 0, spreadPct: 0, cheaperOn: null };
  }

  return {
    spread: dearest - cheapest,
    spreadPct: (dearest / cheapest - 1) * 100,
    cheaperOn,
  };
}

async function buildSnapshot(): Promise<ArbitrageSnapshot> {
  const warnings: string[] = [];
  let skinportItems: Awaited<ReturnType<typeof fetchSkinportItems>> = [];

  try {
    skinportItems = await fetchSkinportItems();
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Skinport niedostępny";
    warnings.push(msg);
  }

  const skinportWarning = getSkinportStatusWarning();
  if (skinportWarning) warnings.push(skinportWarning);

  const csfloatIndex = await getCsfloatPriceIndex();

  const skinportMap = new Map<string, (typeof skinportItems)[number]>();
  for (const it of skinportItems) skinportMap.set(it.market_hash_name, it);

  const names = new Set<string>();
  for (const name of skinportMap.keys()) names.add(name);
  for (const name of csfloatIndex.keys()) names.add(name);

  const rows: ArbitrageRow[] = [];

  for (const marketHashName of names) {
    const sp = skinportMap.get(marketHashName);
    const cf = csfloatIndex.get(marketHashName);

    const skinportNorm =
      sp?.min_price !== null && sp?.min_price !== undefined && sp.min_price > 0
        ? sp.min_price
        : null;
    const csfloatNorm =
      cf && cf.min_price > 0
        ? (cf.min_price / 100) *
          (DEFAULT_CURRENCY === "USD" ? 1 : USD_TO_DEFAULT_FX)
        : null;

    const skinport: MarketSnapshot | null =
      skinportNorm !== null
        ? {
            marketId: "skinport",
            marketName: "Skinport",
            price: sp!.min_price,
            currency: sp!.currency || DEFAULT_CURRENCY,
            normalizedPrice: skinportNorm,
            quantity: sp!.quantity ?? 0,
            url: sp!.item_page ?? null,
          }
        : null;

    const csfloat: MarketSnapshot | null =
      csfloatNorm !== null
        ? {
            marketId: "csfloat",
            marketName: "CSFloat",
            price: cf!.min_price / 100,
            currency: "USD",
            normalizedPrice: csfloatNorm,
            quantity: cf!.quantity ?? 0,
            url: csfloatSearchUrl(marketHashName),
          }
        : null;

    if (!skinport && !csfloat) continue;

    const { spread, spreadPct, cheaperOn } = buildSpread(skinportNorm, csfloatNorm);

    rows.push({
      marketHashName,
      skinport,
      csfloat,
      spread,
      spreadPct,
      cheaperOn,
    });
  }

  const now = new Date().toISOString();
  const bothMarketsCount = rows.filter((r) => r.skinport && r.csfloat).length;
  const skinportAvailable = getCatalogItemCount(DEFAULT_CURRENCY) > 0;

  return {
    rows,
    currency: DEFAULT_CURRENCY,
    lastUpdatedAt: now,
    skinportUpdatedAt: now,
    csfloatUpdatedAt: now,
    totalItems: rows.length,
    bothMarketsCount,
    skinportAvailable,
    warnings,
  };
}

let snapshotCache: { value: ArbitrageSnapshot; expiresAt: number } | null = null;
let snapshotInflight: Promise<ArbitrageSnapshot> | null = null;

onArbitrageSnapshotInvalidate(() => {
  snapshotCache = null;
});

export { invalidateArbitrageSnapshot } from "@/lib/sync/invalidate";

/** Zwraca snapshot z cache (odświeżany co ~10 min). */
export async function getArbitrageSnapshot(): Promise<ArbitrageSnapshot> {
  ensureSkinportSyncWorkerStarted();

  if (snapshotCache && Date.now() < snapshotCache.expiresAt) {
    return snapshotCache.value;
  }

  // Podczas backoff Skinport nie przebudowuj — użyj ostatniego snapshotu.
  if (snapshotCache && isSkinportBackoffActive()) {
    return snapshotCache.value;
  }

  if (snapshotInflight) return snapshotInflight;

  snapshotInflight = (async () => {
    try {
      const value = await buildSnapshot();
      snapshotCache = { value, expiresAt: Date.now() + SNAPSHOT_TTL_MS };
      return value;
    } catch (e) {
      if (snapshotCache) return snapshotCache.value;
      throw e;
    } finally {
      snapshotInflight = null;
    }
  })();

  return snapshotInflight;
}

export async function queryArbitrage(query: ArbitrageQuery): Promise<ArbitragePage> {
  const snapshot = await getArbitrageSnapshot();
  return filterArbitrageSnapshot(snapshot, query, getSnapshotRefreshInSec());
}

/** Pozostały czas do odświeżenia snapshotu (sekundy). */
export function getSnapshotRefreshInSec(): number {
  if (!snapshotCache) return 0;
  return Math.max(0, Math.ceil((snapshotCache.expiresAt - Date.now()) / 1000));
}
