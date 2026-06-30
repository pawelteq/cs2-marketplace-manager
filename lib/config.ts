// Centralna konfiguracja czytana ze zmiennych środowiskowych.

/** Waluta, do której normalizujemy wszystkie ceny przy porównaniu. */
export const DEFAULT_CURRENCY =
  process.env.NEXT_PUBLIC_DEFAULT_CURRENCY?.toUpperCase() || "PLN";

/** Kurs USD -> waluta domyślna (CSFloat podaje ceny w USD). */
export const USD_TO_DEFAULT_FX = Number(process.env.USD_TO_DEFAULT_FX || "3.85");

/** Opcjonalny klucz API CSFloat (nie wymagany do odczytu listingów). */
export const CSFLOAT_API_KEY = process.env.CSFLOAT_API_KEY || "";

/** App ID gry — 730 to CS2 / CS:GO. */
export const CS2_APP_ID = 730;
