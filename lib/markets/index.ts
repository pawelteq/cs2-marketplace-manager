// Rejestr marketów. Aby dodać nowy market (np. Buff, DMarket),
// zaimplementuj MarketAdapter w osobnym pliku i dopisz go tutaj.

import { DEFAULT_CURRENCY } from "@/lib/config";
import type { ComparisonResult, MarketAdapter, MarketPrice } from "@/lib/types";
import { csfloatAdapter } from "./csfloat";
import { skinportAdapter } from "./skinport";

export const MARKETS: MarketAdapter[] = [skinportAdapter, csfloatAdapter];

/** Odpytuje wszystkie markety równolegle i buduje wynik porównania. */
export async function compareItem(
  marketHashName: string,
): Promise<ComparisonResult> {
  const results: MarketPrice[] = await Promise.all(
    MARKETS.map((m) => m.getCheapest(marketHashName)),
  );

  const priced = results.filter(
    (r) => r.ok && typeof r.normalizedPrice === "number" && r.normalizedPrice! > 0,
  );

  let bestMarketId: string | null = null;
  let spread: number | null = null;
  let spreadPct: number | null = null;

  if (priced.length > 0) {
    const sorted = [...priced].sort(
      (a, b) => (a.normalizedPrice as number) - (b.normalizedPrice as number),
    );
    const cheapest = sorted[0];
    const dearest = sorted[sorted.length - 1];
    bestMarketId = cheapest.marketId;
    if (priced.length > 1) {
      spread =
        (dearest.normalizedPrice as number) - (cheapest.normalizedPrice as number);
      spreadPct =
        ((dearest.normalizedPrice as number) /
          (cheapest.normalizedPrice as number) -
          1) *
        100;
    }
  }

  return {
    marketHashName,
    currency: DEFAULT_CURRENCY,
    results,
    bestMarketId,
    spread,
    spreadPct,
  };
}
