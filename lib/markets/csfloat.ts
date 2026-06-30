// Adapter CSFloat.
// Dokumentacja: https://docs.csfloat.com/#get-all-listings
// Ceny zwracane są w CENTACH USD. Filtrujemy po market_hash_name
// i sortujemy rosnąco, by uzyskać najtańszą ofertę typu buy_now.

import { cached } from "@/lib/cache";
import { CSFLOAT_API_KEY } from "@/lib/config";
import { usdCentsToDefault } from "@/lib/pricing";
import type { MarketAdapter, MarketPrice } from "@/lib/types";

const LISTING_TTL_MS = 30 * 60 * 1000; // 30 min na zapytanie o konkretny item
const PRICE_LIST_TTL_MS = 30 * 60 * 1000; // 30 min — indeks całego rynku

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

// --- Ochrona przed rate-limitem (429) ---------------------------------------
// CSFloat (zwłaszcza bez klucza API) ma niski limit zapytań. Po otrzymaniu 429
// wstrzymujemy ruch do CSFloat na czas z nagłówka Retry-After (lub domyślnie),
// zamiast dalej go zalewać i pogłębiać blokadę.

const DEFAULT_BACKOFF_MS = 60 * 1000;
const MAX_BACKOFF_MS = 5 * 60 * 1000;
let csfloatRetryAfter = 0;
let lastCsfloatWarning: string | null = null;

export class CsfloatRateLimitError extends Error {
  constructor(public retryInSec: number) {
    super(`CSFloat API 429 — backoff ${retryInSec}s`);
    this.name = "CsfloatRateLimitError";
  }
}

export function isCsfloatBackoffActive(): boolean {
  return Date.now() < csfloatRetryAfter;
}

export function getCsfloatStatusWarning(): string | null {
  return isCsfloatBackoffActive() ? lastCsfloatWarning : null;
}

function csfloatRetryInSec(): number {
  return Math.max(0, Math.ceil((csfloatRetryAfter - Date.now()) / 1000));
}

function activateBackoff(retryAfterHeader: string | null): void {
  let ms = DEFAULT_BACKOFF_MS;
  if (retryAfterHeader) {
    const sec = Number(retryAfterHeader);
    if (Number.isFinite(sec) && sec > 0) ms = sec * 1000;
  }
  ms = Math.min(ms, MAX_BACKOFF_MS);
  csfloatRetryAfter = Date.now() + ms;
  lastCsfloatWarning = `CSFloat API 429 — wstrzymane na ${Math.ceil(ms / 1000)}s.`;
  console.warn(`[csfloat] 429 — backoff ${Math.ceil(ms / 1000)}s`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchListingsRaw(
  marketHashName: string,
  limit: number,
): Promise<CsfloatListing[]> {
  if (isCsfloatBackoffActive()) {
    throw new CsfloatRateLimitError(csfloatRetryInSec());
  }

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
  if (res.status === 429) {
    activateBackoff(res.headers.get("Retry-After"));
    throw new CsfloatRateLimitError(csfloatRetryInSec());
  }
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
  // Łagodniej dla rate-limitu CSFloat: mniejsze paczki + przerwa między nimi.
  const chunkSize = 3;
  const chunkDelayMs = 300;
  for (let i = 0; i < names.length; i += chunkSize) {
    // Jeśli CSFloat zwrócił 429, przerywamy resztę — zwracamy to, co mamy.
    if (isCsfloatBackoffActive()) break;

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
    if (i + chunkSize < names.length) await sleep(chunkDelayMs);
  }
  return out;
}

/** Pobiera (i cache'uje) indeks cen całego rynku CSFloat. */
export async function fetchCsfloatPriceList(): Promise<CsfloatPriceListItem[]> {
  const key = "csfloat:price-list";
  return cached(key, PRICE_LIST_TTL_MS, async () => {
    if (isCsfloatBackoffActive()) {
      throw new CsfloatRateLimitError(csfloatRetryInSec());
    }
    const res = await fetch("https://csfloat.com/api/v1/listings/price-list", {
      headers: listingHeaders(),
      cache: "no-store",
    });
    if (res.status === 429) {
      activateBackoff(res.headers.get("Retry-After"));
      throw new CsfloatRateLimitError(csfloatRetryInSec());
    }
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
