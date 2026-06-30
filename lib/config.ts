// Centralna konfiguracja czytana ze zmiennych środowiskowych.
//
// WALUTA — JEDNO ŹRÓDŁO PRAWDY:
// Cała porównywarka działa w jednej walucie (DEFAULT_CURRENCY). Skinport jest
// pobierany natywnie w tej walucie, a ceny CSFloat (zwracane w USD) są do niej
// przeliczane. Kurs USD->waluta dobierany jest AUTOMATYCZNIE z tabeli poniżej,
// na podstawie wybranej waluty — dzięki temu waluta i kurs nie mogą się
// "rozjechać" (to był powód błędu, gdy waluta=EUR, a kurs=3.85 dla PLN).

/** Waluta, do której normalizujemy wszystkie ceny przy porównaniu. */
export const DEFAULT_CURRENCY =
  process.env.NEXT_PUBLIC_DEFAULT_CURRENCY?.toUpperCase() || "PLN";

/**
 * Przybliżone kursy USD -> waluta (1 USD = X waluty).
 * Aktualizuj ręcznie w razie potrzeby (stan ~czerwiec 2026).
 * USD jest walutą bazową CSFloat, więc kurs USD->USD = 1.
 */
export const USD_FX_TABLE: Record<string, number> = {
  USD: 1,
  PLN: 3.76,
  EUR: 0.88,
  GBP: 0.79,
  CZK: 21.8,
  SEK: 9.6,
  NOK: 10.2,
  DKK: 6.55,
  CHF: 0.8,
  CAD: 1.37,
  AUD: 1.5,
  BRL: 5.4,
};

/**
 * Kurs USD -> waluta domyślna.
 * Priorytet: jawny override z ENV (USD_TO_DEFAULT_FX) -> tabela -> 1 (z ostrzeżeniem).
 */
export const USD_TO_DEFAULT_FX = resolveUsdFx();

function resolveUsdFx(): number {
  const override = process.env.USD_TO_DEFAULT_FX;
  if (override !== undefined && override !== "") {
    const n = Number(override);
    if (Number.isFinite(n) && n > 0) return n;
  }
  const fromTable = USD_FX_TABLE[DEFAULT_CURRENCY];
  if (fromTable && fromTable > 0) return fromTable;

  console.warn(
    `[config] Brak kursu USD->${DEFAULT_CURRENCY} w USD_FX_TABLE — używam 1:1. ` +
      `Dodaj kurs do tabeli lub ustaw USD_TO_DEFAULT_FX w .env.`,
  );
  return 1;
}

/** Opcjonalny klucz API CSFloat (nie wymagany do odczytu listingów). */
export const CSFLOAT_API_KEY = process.env.CSFLOAT_API_KEY || "";

/** App ID gry — 730 to CS2 / CS:GO. */
export const CS2_APP_ID = 730;

/**
 * Prowizja sprzedawcy na Skinport.
 * Konto standardowe: 12%. Konto Pro (subskrypcja): 8%.
 * Ustaw SKINPORT_SELLER_FEE=0.08 w .env jeśli masz subskrypcję.
 */
export const SKINPORT_SELLER_FEE = (() => {
  const env = process.env.SKINPORT_SELLER_FEE;
  if (env !== undefined && env !== "") {
    const n = Number(env);
    if (Number.isFinite(n) && n >= 0 && n < 1) return n;
  }
  return 0.12;
})();

/**
 * Prowizja sprzedawcy na CSFloat.
 * Standardowo: 2%.
 */
export const CSFLOAT_SELLER_FEE = (() => {
  const env = process.env.CSFLOAT_SELLER_FEE;
  if (env !== undefined && env !== "") {
    const n = Number(env);
    if (Number.isFinite(n) && n >= 0 && n < 1) return n;
  }
  return 0.02;
})();
