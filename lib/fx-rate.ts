// Dynamiczny kurs walutowy USD → waluta docelowa.
// Źródło: api.frankfurter.app (darmowe, bez klucza API).
// Cache w pamięci: 1 godzina. Fallback: statyczna tabela z lib/config.ts.

import { DEFAULT_CURRENCY, USD_FX_TABLE } from "@/lib/config";

const FX_CACHE_TTL_MS = 60 * 60 * 1000; // 1 godzina

interface FxCache {
  rate: number;
  fetchedAt: number;
  currency: string;
}

let fxCache: FxCache | null = null;
let fxInflight: Promise<number> | null = null;

/**
 * Synchroniczny odczyt ostatniego pobranego kursu (lub statycznej tabeli).
 * Używany przez usdCentsToDefault() — bez await.
 */
export function getCachedUsdFx(currency: string = DEFAULT_CURRENCY): number {
  if (fxCache && fxCache.currency === currency) return fxCache.rate;
  return USD_FX_TABLE[currency] ?? 1;
}

async function fetchLiveRate(currency: string): Promise<number> {
  const res = await fetch(
    `https://api.frankfurter.app/latest?from=USD&to=${currency}`,
    { cache: "no-store", signal: AbortSignal.timeout(5000) },
  );
  if (!res.ok) throw new Error(`Frankfurter API ${res.status}`);
  const data = (await res.json()) as { rates?: Record<string, number> };
  const rate = data.rates?.[currency];
  if (!rate || !Number.isFinite(rate) || rate <= 0) {
    throw new Error(`Brak kursu USD->${currency} w odpowiedzi`);
  }
  return rate;
}

/**
 * Odświeża kurs walutowy z zewnętrznego API (cache 1h).
 * Bezpieczne do wielokrotnego wywołania — deduplikuje równoległe requesty.
 * Przy błędzie zwraca ostatni znany kurs lub wartość statyczną.
 */
export async function refreshUsdFxRate(
  currency: string = DEFAULT_CURRENCY,
): Promise<number> {
  if (
    fxCache &&
    fxCache.currency === currency &&
    Date.now() - fxCache.fetchedAt < FX_CACHE_TTL_MS
  ) {
    return fxCache.rate;
  }

  if (fxInflight) return fxInflight;

  fxInflight = (async () => {
    try {
      const rate = await fetchLiveRate(currency);
      fxCache = { rate, fetchedAt: Date.now(), currency };
      console.info(
        `[fx-rate] USD->${currency} = ${rate} (live, Frankfurter)`,
      );
      return rate;
    } catch (e) {
      const fallback = fxCache?.rate ?? USD_FX_TABLE[currency] ?? 1;
      console.warn(
        `[fx-rate] Błąd pobierania kursu USD->${currency}: ${e instanceof Error ? e.message : e}. Fallback: ${fallback}`,
      );
      return fallback;
    } finally {
      fxInflight = null;
    }
  })();

  return fxInflight;
}
