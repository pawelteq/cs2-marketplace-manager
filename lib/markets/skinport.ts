// Adapter Skinport — odczyt z lokalnego katalogu (worker + WebSocket).
// REST API odpytuje wyłącznie lib/skinport/sync-worker.ts.

import type { MarketAdapter, MarketPrice } from "@/lib/types";
import { DEFAULT_CURRENCY } from "@/lib/config";
import type { SkinportItem } from "@/lib/markets/skinport-types";
import {
  getCatalogItems,
  hydrateCatalogFromDisk,
} from "@/lib/skinport/catalog-store";
import {
  getSkinportStatusWarning,
  isSkinportBackoffActive,
} from "@/lib/skinport/sync-worker";

export type { SkinportItem } from "@/lib/markets/skinport-types";
export { getSkinportStatusWarning, isSkinportBackoffActive };

/** Pobiera katalog z pamięci/dysku — bez REST API i bez uruchamiania workera. */
export async function fetchSkinportItems(
  currency: string = DEFAULT_CURRENCY,
): Promise<SkinportItem[]> {
  const mem = getCatalogItems(currency);
  if (mem.length) return mem;

  await hydrateCatalogFromDisk(currency);
  return getCatalogItems(currency);
}

/** Mapa market_hash_name -> item, do szybkiego wyszukiwania. */
export async function getSkinportIndex(
  currency: string = DEFAULT_CURRENCY,
): Promise<Map<string, SkinportItem>> {
  const items = await fetchSkinportItems(currency);
  const map = new Map<string, SkinportItem>();
  for (const it of items) map.set(it.market_hash_name, it);
  return map;
}

export const skinportAdapter: MarketAdapter = {
  id: "skinport",
  name: "Skinport",
  async getCheapest(marketHashName: string): Promise<MarketPrice> {
    try {
      const index = await getSkinportIndex();
      const item = index.get(marketHashName);
      const price = item?.min_price ?? null;
      return {
        marketId: "skinport",
        marketName: "Skinport",
        price,
        currency: item?.currency ?? DEFAULT_CURRENCY,
        normalizedPrice: price,
        quantity: item?.quantity ?? null,
        url: item?.item_page ?? null,
        ok: true,
      };
    } catch (e) {
      return {
        marketId: "skinport",
        marketName: "Skinport",
        price: null,
        currency: DEFAULT_CURRENCY,
        normalizedPrice: null,
        ok: false,
        error: e instanceof Error ? e.message : "Unknown error",
      };
    }
  },
};
