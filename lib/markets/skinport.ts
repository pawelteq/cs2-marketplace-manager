// Adapter Skinport.
// Dokumentacja: https://docs.skinport.com/items
// Endpoint /v1/items zwraca CAŁĄ listę itemów (bez autoryzacji),
// jest cache'owany 5 min i limitowany do 8 req / 5 min, dlatego
// pobieramy go raz i trzymamy w cache, a wyszukiwanie robimy lokalnie.

import { cached } from "@/lib/cache";
import { CS2_APP_ID, DEFAULT_CURRENCY } from "@/lib/config";
import type { MarketAdapter, MarketPrice } from "@/lib/types";

const ITEMS_TTL_MS = 5 * 60 * 1000; // 5 minut, zgodnie z cache API

interface SkinportItem {
  market_hash_name: string;
  currency: string;
  suggested_price: number | null;
  item_page: string;
  market_page: string;
  min_price: number | null;
  max_price: number | null;
  mean_price: number | null;
  median_price: number | null;
  quantity: number;
}

/** Pobiera (i cache'uje) pełną listę itemów ze Skinport w danej walucie. */
export async function fetchSkinportItems(
  currency: string = DEFAULT_CURRENCY,
): Promise<SkinportItem[]> {
  const key = `skinport:items:${currency}`;
  return cached(key, ITEMS_TTL_MS, async () => {
    const params = new URLSearchParams({
      app_id: String(CS2_APP_ID),
      currency,
      tradable: "0",
    });
    const res = await fetch(`https://api.skinport.com/v1/items?${params}`, {
      headers: { "Accept-Encoding": "br" },
      // Cache po stronie Next/serwera; my i tak trzymamy własny TTL.
      cache: "no-store",
    });
    if (!res.ok) {
      throw new Error(`Skinport API ${res.status}`);
    }
    return (await res.json()) as SkinportItem[];
  });
}

/** Mapa market_hash_name -> item, do szybkiego wyszukiwania. */
export async function getSkinportIndex(
  currency: string = DEFAULT_CURRENCY,
): Promise<Map<string, SkinportItem>> {
  const key = `skinport:index:${currency}`;
  return cached(key, ITEMS_TTL_MS, async () => {
    const items = await fetchSkinportItems(currency);
    const map = new Map<string, SkinportItem>();
    for (const it of items) map.set(it.market_hash_name, it);
    return map;
  });
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
        // Skinport pobieramy już w walucie porównania, więc normalizacja 1:1.
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
