// Adapter CSFloat.
// Dokumentacja: https://docs.csfloat.com/#get-all-listings
// Ceny zwracane są w CENTACH USD. Filtrujemy po market_hash_name
// i sortujemy rosnąco, by uzyskać najtańszą ofertę typu buy_now.

import { cached } from "@/lib/cache";
import {
  CSFLOAT_API_KEY,
  DEFAULT_CURRENCY,
  USD_TO_DEFAULT_FX,
} from "@/lib/config";
import type { MarketAdapter, MarketPrice } from "@/lib/types";

const LISTING_TTL_MS = 60 * 1000; // 1 minuta na zapytanie o konkretny item
const PRICE_LIST_TTL_MS = 60 * 1000; // 1 minuta — indeks całego rynku

interface CsfloatPriceListItem {
  market_hash_name: string;
  quantity: number;
  min_price: number; // centy USD
}

interface CsfloatListing {
  id: string;
  type: string;
  price: number; // w centach USD
  state: string;
  item: {
    market_hash_name: string;
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

function normalizeCsfloatPrice(priceCents: number): number {
  const priceUsd = priceCents / 100;
  return DEFAULT_CURRENCY === "USD" ? priceUsd : priceUsd * USD_TO_DEFAULT_FX;
}

/** Pobiera (i cache'uje) indeks cen całego rynku CSFloat. */
export async function fetchCsfloatPriceList(): Promise<CsfloatPriceListItem[]> {
  const key = "csfloat:price-list";
  return cached(key, PRICE_LIST_TTL_MS, async () => {
    const headers: Record<string, string> = {};
    if (CSFLOAT_API_KEY) headers["Authorization"] = CSFLOAT_API_KEY;

    const res = await fetch("https://csfloat.com/api/v1/listings/price-list", {
      headers,
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`CSFloat price-list ${res.status}`);
    return (await res.json()) as CsfloatPriceListItem[];
  });
}

/** Mapa market_hash_name -> wpis z price-list. */
export async function getCsfloatPriceIndex(): Promise<
  Map<string, CsfloatPriceListItem>
> {
  const key = "csfloat:price-index";
  return cached(key, PRICE_LIST_TTL_MS, async () => {
    const items = await fetchCsfloatPriceList();
    const map = new Map<string, CsfloatPriceListItem>();
    for (const it of items) map.set(it.market_hash_name, it);
    return map;
  });
}

async function fetchCheapestListing(
  marketHashName: string,
): Promise<CsfloatListing | null> {
  const key = `csfloat:cheapest:${marketHashName}`;
  return cached(key, LISTING_TTL_MS, async () => {
    const params = new URLSearchParams({
      market_hash_name: marketHashName,
      sort_by: "lowest_price",
      type: "buy_now",
      limit: "1",
    });
    const headers: Record<string, string> = {};
    if (CSFLOAT_API_KEY) headers["Authorization"] = CSFLOAT_API_KEY;

    const res = await fetch(`https://csfloat.com/api/v1/listings?${params}`, {
      headers,
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`CSFloat API ${res.status}`);

    const data = await res.json();
    // API może zwrócić tablicę lub obiekt { data: [...] } zależnie od wersji.
    const list: CsfloatListing[] = Array.isArray(data) ? data : data?.data ?? [];
    return list.length > 0 ? list[0] : null;
  });
}

export const csfloatAdapter: MarketAdapter = {
  id: "csfloat",
  name: "CSFloat",
  async getCheapest(marketHashName: string): Promise<MarketPrice> {
    try {
      const index = await getCsfloatPriceIndex();
      const indexed = index.get(marketHashName);
      if (indexed && indexed.min_price > 0) {
        const priceUsd = indexed.min_price / 100;
        return {
          marketId: "csfloat",
          marketName: "CSFloat",
          price: priceUsd,
          currency: "USD",
          normalizedPrice: normalizeCsfloatPrice(indexed.min_price),
          quantity: indexed.quantity,
          url: csfloatSearchUrl(marketHashName),
          ok: true,
        };
      }

      const listing = await fetchCheapestListing(marketHashName);
      if (!listing) {
        return {
          marketId: "csfloat",
          marketName: "CSFloat",
          price: null,
          currency: "USD",
          normalizedPrice: null,
          quantity: 0,
          url: null,
          ok: true,
        };
      }
      const priceUsd = listing.price / 100;
      return {
        marketId: "csfloat",
        marketName: "CSFloat",
        price: priceUsd,
        currency: "USD",
        normalizedPrice: normalizeCsfloatPrice(listing.price),
        quantity: null,
        url: `https://csfloat.com/item/${listing.id}`,
        ok: true,
      };
    } catch (e) {
      return {
        marketId: "csfloat",
        marketName: "CSFloat",
        price: null,
        currency: "USD",
        normalizedPrice: null,
        ok: false,
        error: e instanceof Error ? e.message : "Unknown error",
      };
    }
  },
};
