// Adapter CSFloat.
// Dokumentacja: https://docs.csfloat.com/#get-all-listings
// Ceny zwracane są w CENTACH USD. Filtrujemy po market_hash_name
// i sortujemy rosnąco, by uzyskać najtańszą ofertę typu buy_now.

import { cached } from "@/lib/cache";
import {
  CSFLOAT_API_KEY,
} from "@/lib/config";
import { usdCentsToDefault } from "@/lib/pricing";
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
  return usdCentsToDefault(priceCents);
}

function listingHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  if (CSFLOAT_API_KEY) headers["Authorization"] = CSFLOAT_API_KEY;
  return headers;
}

async function fetchListingsRaw(
  marketHashName: string,
  limit: number,
): Promise<CsfloatListing[]> {
  const params = new URLSearchParams({
    market_hash_name: marketHashName,
    sort_by: "lowest_price",
    type: "buy_now",
    limit: String(limit),
  });

  const res = await fetch(`https://csfloat.com/api/v1/listings?${params}`, {
    headers: listingHeaders(),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`CSFloat API ${res.status}`);

  const data = await res.json();
  return Array.isArray(data) ? data : data?.data ?? [];
}

/** Średnia ceny N najtańszych listingów buy_now (centy USD). */
export async function fetchCsfloatAvgCheapest(
  marketHashName: string,
  sampleSize: number,
): Promise<{ avgUsd: number; avgNorm: number; sampleCount: number } | null> {
  const n = Math.min(20, Math.max(1, Math.floor(sampleSize)));
  const key = `csfloat:avg:${n}:${marketHashName}`;
  return cached(key, LISTING_TTL_MS, async () => {
    const list = await fetchListingsRaw(marketHashName, n);
    const prices = list
      .map((l) => l.price)
      .filter((p) => typeof p === "number" && p > 0)
      .slice(0, n);
    if (prices.length === 0) return null;

    const avgCents = prices.reduce((a, b) => a + b, 0) / prices.length;
    return {
      avgUsd: avgCents / 100,
      avgNorm: usdCentsToDefault(avgCents),
      sampleCount: prices.length,
    };
  });
}

export async function fetchCsfloatAvgBatch(
  names: string[],
  sampleSize: number,
): Promise<
  Record<string, { avgUsd: number; avgNorm: number; sampleCount: number }>
> {
  const out: Record<
    string,
    { avgUsd: number; avgNorm: number; sampleCount: number }
  > = {};
  const chunkSize = 8;
  for (let i = 0; i < names.length; i += chunkSize) {
    const chunk = names.slice(i, i + chunkSize);
    const results = await Promise.all(
      chunk.map(async (name) => {
        try {
          const avg = await fetchCsfloatAvgCheapest(name, sampleSize);
          return [name, avg] as const;
        } catch {
          return [name, null] as const;
        }
      }),
    );
    for (const [name, avg] of results) {
      if (avg) out[name] = avg;
    }
  }
  return out;
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
    const list = await fetchListingsRaw(marketHashName, 1);
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
