// Logika porównywania cen — PLN, najtańsza sztuka vs średnia N najtańszych.

import { DEFAULT_CURRENCY, SKINPORT_SELLER_FEE, CSFLOAT_SELLER_FEE } from "@/lib/config";
import { getCachedUsdFx } from "@/lib/fx-rate";
import type { SkinportItem } from "@/lib/markets/skinport-types";
import type { ArbitrageRow, MarketSnapshot } from "@/lib/types";

export type PriceMode = "min" | "avg";

export interface PricingOptions {
  priceMode: PriceMode;
  /** Ile najtańszych ofert uśredniać (tryb avg). */
  avgSampleSize: number;
}

export interface QuantityFilters {
  minSkinportQty: number;
  minCsfloatQty: number;
  onlyBoth: boolean;
}

const DEFAULT_SAMPLE_SIZE = 5;
const MAX_SAMPLE_SIZE = 20;

export function clampSampleSize(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_SAMPLE_SIZE;
  return Math.min(MAX_SAMPLE_SIZE, Math.max(1, Math.floor(value)));
}

export function usdCentsToDefault(cents: number): number {
  const usd = cents / 100;
  return DEFAULT_CURRENCY === "USD" ? usd : usd * getCachedUsdFx();
}

/** Skinport bulk API — estymacja średniej N najtańszych z min + mediana. */
export function estimateSkinportAvgCheapest(
  item: Pick<
    SkinportItem,
    "min_price" | "median_price" | "mean_price" | "quantity"
  >,
  sampleSize: number,
): number | null {
  const min = item.min_price;
  if (min === null || min === undefined || min <= 0) return null;

  const n = clampSampleSize(sampleSize);
  if (n <= 1) return min;

  const median = item.median_price ?? item.mean_price;
  if (median === null || median === undefined || median <= min) return min;

  // min … median ≈ dolny segment rynku; N=5 daje ~połowę przedziału.
  const t = Math.min(1, (n - 1) / (n + 3));
  return min + (median - min) * t;
}

export function skinportComparablePrice(
  item: Pick<
    SkinportItem,
    "min_price" | "median_price" | "mean_price" | "quantity" | "currency"
  >,
  options: PricingOptions,
): number | null {
  if (options.priceMode === "min") {
    return item.min_price !== null && item.min_price > 0 ? item.min_price : null;
  }
  return estimateSkinportAvgCheapest(item, options.avgSampleSize);
}

export function csfloatComparablePrice(
  minPriceCents: number,
  options: PricingOptions,
  avgNormOverride?: number | null,
): number | null {
  if (minPriceCents <= 0) return null;
  if (options.priceMode === "avg" && avgNormOverride !== undefined && avgNormOverride !== null) {
    return avgNormOverride;
  }
  return usdCentsToDefault(minPriceCents);
}

export function buildSpread(
  a: number | null,
  b: number | null,
): {
  spread: number | null;
  spreadPct: number | null;
  cheaperOn: "skinport" | "csfloat" | null;
  netSpread: number | null;
  netSpreadPct: number | null;
} {
  if (a === null || b === null || a <= 0 || b <= 0) {
    return { spread: null, spreadPct: null, cheaperOn: null, netSpread: null, netSpreadPct: null };
  }

  const cheaperOn = a < b ? "skinport" : b < a ? "csfloat" : null;
  const cheapest = Math.min(a, b);
  const dearest = Math.max(a, b);

  if (cheapest === dearest) {
    return { spread: 0, spreadPct: 0, cheaperOn: null, netSpread: 0, netSpreadPct: 0 };
  }

  // Prowizja sprzedawcy zależy od strony, na której SPRZEDAJEMY (droższy market).
  const sellerFee = cheaperOn === "skinport" ? CSFLOAT_SELLER_FEE : SKINPORT_SELLER_FEE;
  const netSale = dearest * (1 - sellerFee);
  const netSpread = netSale - cheapest;
  const netSpreadPct = (netSpread / cheapest) * 100;

  return {
    spread: dearest - cheapest,
    spreadPct: (dearest / cheapest - 1) * 100,
    cheaperOn,
    netSpread,
    netSpreadPct,
  };
}

export interface RawArbitrageInputs {
  marketHashName: string;
  skinportItem?: SkinportItem | null;
  csfloatMinCents?: number;
  csfloatQuantity?: number;
  csfloatAvgNorm?: number | null;
}

export function buildArbitrageRowFromRaw(
  input: RawArbitrageInputs,
  pricing: PricingOptions,
  csfloatSearchUrl: (name: string) => string,
): ArbitrageRow {
  const sp = input.skinportItem;
  const cfMin = input.csfloatMinCents ?? 0;

  const skinportNorm = sp ? skinportComparablePrice(sp, pricing) : null;
  const csfloatNorm =
    cfMin > 0
      ? csfloatComparablePrice(cfMin, pricing, input.csfloatAvgNorm)
      : null;

  const skinport: MarketSnapshot | null =
    skinportNorm !== null && sp
      ? {
          marketId: "skinport",
          marketName: "Skinport",
          price: sp.min_price,
          currency: sp.currency || DEFAULT_CURRENCY,
          normalizedPrice: skinportNorm,
          quantity: sp.quantity ?? 0,
          url: sp.item_page ?? null,
          medianPrice: sp.median_price,
          meanPrice: sp.mean_price,
        }
      : null;

  const csfloat: MarketSnapshot | null =
    csfloatNorm !== null && cfMin > 0
      ? {
          marketId: "csfloat",
          marketName: "CSFloat",
          price: cfMin / 100,
          currency: "USD",
          normalizedPrice: csfloatNorm,
          quantity: input.csfloatQuantity ?? 0,
          url: csfloatSearchUrl(input.marketHashName),
        }
      : null;

  const { spread, spreadPct, cheaperOn, netSpread, netSpreadPct } = buildSpread(skinportNorm, csfloatNorm);

  return {
    marketHashName: input.marketHashName,
    skinport,
    csfloat,
    spread,
    spreadPct,
    cheaperOn,
    netSpread,
    netSpreadPct,
  };
}

export function priceModeLabel(mode: PriceMode, sampleSize: number): string {
  if (mode === "min") return "najtańsza sztuka";
  return `śr. ${clampSampleSize(sampleSize)} najtańszych`;
}
