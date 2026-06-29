# CS2 Marketplace Manager

Narzędzie do porównywania cen skinów CS2 między marketami oraz baza pod przyszłe
narzędzia do podejmowania akcji (kupno/sprzedaż/listowanie). Na start integruje
**Skinport** i **CSFloat**; architektura jest przygotowana pod dokładanie kolejnych
marketów (Buff, DMarket, itp.).

## Stack

- **Next.js 15** (App Router) + **React 19**
- **TypeScript**
- Brak dodatkowych zależności runtime — czyste API marketów + warstwa cache w pamięci

## Uruchomienie

```bash
npm install
cp .env.example .env        # ustaw walutę i kurs USD
npm run dev                 # http://localhost:3000
```

## Konfiguracja (`.env`)

| Zmienna | Opis |
| --- | --- |
| `NEXT_PUBLIC_DEFAULT_CURRENCY` | Waluta porównania (EUR, USD, PLN…). Skinport jest odpytywany w tej walucie. |
| `USD_TO_DEFAULT_FX` | Kurs USD → waluta domyślna. CSFloat podaje ceny w USD i są przeliczane tym kursem. |
| `CSFLOAT_API_KEY` | Opcjonalny. Niewymagany do odczytu listingów; przyda się przy akcjach (listowanie). |

## Architektura

```
app/
  api/
    search/route.ts     # GET /api/search?q=  — autocomplete (katalog Skinport)
    compare/route.ts    # GET /api/compare?name= — porównanie cen na marketach
  page.tsx              # interfejs porównywarki
  layout.tsx, globals.css
lib/
  types.ts              # MarketPrice, ComparisonResult, MarketAdapter, SearchHit
  config.ts             # konfiguracja z ENV
  cache.ts              # cache w pamięci z TTL + dedup równoległych zapytań
  markets/
    skinport.ts         # adapter Skinport (/v1/items, cache 5 min)
    csfloat.ts          # adapter CSFloat (/api/v1/listings, ceny w centach USD)
    index.ts            # rejestr marketów + compareItem()
```

### Jak dodać nowy market

1. Utwórz `lib/markets/<nazwa>.ts` i zaimplementuj interfejs `MarketAdapter`
   (`id`, `name`, `getCheapest(marketHashName)` zwracające `MarketPrice`).
2. Dodaj adapter do tablicy `MARKETS` w `lib/markets/index.ts`.
3. Gotowe — pojawi się automatycznie w porównaniu i w UI.

## Uwagi o API

- **Skinport** `/v1/items`: bez autoryzacji, cache 5 min, limit 8 req / 5 min.
  Pobieramy całą listę raz i trzymamy w cache; wyszukiwanie odbywa się lokalnie.
- **CSFloat** `/api/v1/listings`: ceny w **centach USD**; filtrujemy po
  `market_hash_name`, sortujemy po `lowest_price`.

## Roadmap (narzędzia do akcji)

- Alerty cenowe / progi arbitrażu (spread między marketami)
- Lista obserwowanych itemów (watchlist)
- Integracja z kontem (listowanie/kupno) — wymaga kluczy API i autoryzacji
- Kolejne markety: Buff163, DMarket, Steam Market
