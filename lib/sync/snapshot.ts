// Buduje snapshot arbitrażu z bulk API Skinport + CSFloat.
// Surowe dane — tryb ceny (min/avg) stosuje filterArbitrageSnapshot po stronie klienta.

import { getCatalogItemCount } from "@/lib/skinport/catalog-store";
import { DEFAULT_CURRENCY } from "@/lib/config";
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
import type { ArbitrageSnapshot } from "@/lib/types";

export type { ArbitragePage, ArbitrageQuery, ArbitrageSort };
export { filterArbitrageSnapshot };
import { onArbitrageSnapshotInvalidate } from "@/lib/sync/invalidate";
import { buildArbitrageRowFromRaw } from "@/lib/pricing";

const SNAPSHOT_TTL_MS = 10 * 60 * 1000;

function csfloatSearchUrl(marketHashName: string): string {
  const params = new URLSearchParams({
    market_hash_name: marketHashName,
    sort_by: "lowest_price",
    type: "buy_now",
  });
  return `https://csfloat.com/search?${params}`;
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

  const rows = [];

  for (const marketHashName of names) {
    const sp = skinportMap.get(marketHashName);
    const cf = csfloatIndex.get(marketHashName);

    const row = buildArbitrageRowFromRaw(
      {
        marketHashName,
        skinportItem: sp ?? null,
        csfloatMinCents: cf?.min_price,
        csfloatQuantity: cf?.quantity,
      },
      { priceMode: "min", avgSampleSize: 1 },
      csfloatSearchUrl,
    );

    if (!row.skinport && !row.csfloat) continue;
    rows.push(row);
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

export async function getArbitrageSnapshot(): Promise<ArbitrageSnapshot> {
  ensureSkinportSyncWorkerStarted();

  if (snapshotCache && Date.now() < snapshotCache.expiresAt) {
    return snapshotCache.value;
  }

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

export function getSnapshotRefreshInSec(): number {
  if (!snapshotCache) return 0;
  return Math.max(0, Math.ceil((snapshotCache.expiresAt - Date.now()) / 1000));
}
