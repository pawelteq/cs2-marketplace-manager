// Wspólne typy domeny dla porównywarki cen CS2.

/** Cena znaleziona na danym markecie dla konkretnego itemu. */
export interface MarketPrice {
  /** id marketu, np. "skinport" */
  marketId: string;
  /** czytelna nazwa marketu, np. "Skinport" */
  marketName: string;
  /** najniższa dostępna cena (w walucie `currency`) lub null jeśli brak ofert */
  price: number | null;
  /** waluta ceny zwróconej przez market (przed normalizacją) */
  currency: string;
  /** cena znormalizowana do waluty porównania (ustawianej w konfiguracji) */
  normalizedPrice: number | null;
  /** liczba dostępnych ofert (jeśli market to udostępnia) */
  quantity?: number | null;
  /** bezpośredni link do strony itemu na markecie */
  url?: string | null;
  /** czy odpytanie się powiodło */
  ok: boolean;
  /** komunikat błędu, gdy ok === false */
  error?: string;
}

/** Pełny wynik porównania dla jednego itemu na wielu marketach. */
export interface ComparisonResult {
  marketHashName: string;
  currency: string;
  results: MarketPrice[];
  /** marketId z najniższą znormalizowaną ceną */
  bestMarketId: string | null;
  /** potencjalny zysk (różnica między najdroższym a najtańszym) w walucie porównania */
  spread: number | null;
  /** różnica procentowa między najtańszym a najdroższym */
  spreadPct: number | null;
}

/** Wpis w wynikach wyszukiwania (autocomplete). */
export interface SearchHit {
  marketHashName: string;
  /** orientacyjna cena (ze Skinport) do podglądu */
  refPrice: number | null;
  currency: string;
}

/**
 * Adapter pojedynczego marketu. Aby dodać nowy market, wystarczy
 * zaimplementować ten interfejs i zarejestrować adapter w lib/markets/index.ts.
 */
export interface MarketAdapter {
  id: string;
  name: string;
  /** Zwraca najtańszą ofertę dla danej nazwy itemu (market_hash_name). */
  getCheapest(marketHashName: string): Promise<MarketPrice>;
}

/** Snapshot ceny z jednego marketu dla danego itemu. */
export interface MarketSnapshot {
  marketId: string;
  marketName: string;
  /** Surowa najniższa cena z API (przed trybem avg). */
  price: number | null;
  currency: string;
  /** Cena do porównania wg wybranego trybu (min / avg). */
  normalizedPrice: number | null;
  quantity: number;
  url: string | null;
  /** Skinport: mediana / średnia z bulk API (do estymacji avg). */
  medianPrice?: number | null;
  meanPrice?: number | null;
}

/** Wiersz porównania arbitrażowego między marketami. */
export interface ArbitrageRow {
  marketHashName: string;
  skinport: MarketSnapshot | null;
  csfloat: MarketSnapshot | null;
  spread: number | null;
  spreadPct: number | null;
  cheaperOn: "skinport" | "csfloat" | null;
}

/** Pełny snapshot rynku do tabeli arbitrażu. */
export interface ArbitrageSnapshot {
  rows: ArbitrageRow[];
  currency: string;
  lastUpdatedAt: string;
  skinportUpdatedAt: string;
  csfloatUpdatedAt: string;
  totalItems: number;
  bothMarketsCount: number;
  skinportAvailable: boolean;
  warnings: string[];
}
