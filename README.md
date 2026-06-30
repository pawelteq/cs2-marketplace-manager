# CS2 Marketplace Manager

Narzędzie do porównywania cen skinów CS2 między marketami oraz baza pod przyszłe
narzędzia do podejmowania akcji (kupno/sprzedaż/listowanie). Na start integruje
**Skinport** i **CSFloat**; architektura jest przygotowana pod dokładanie kolejnych
marketów (Buff, DMarket, itp.).

## Stack

- **Next.js 15** (App Router) + **React 19**
- **TypeScript**, **socket.io-client** (Skinport WebSocket Sale Feed)
- Warstwa cache w pamięci + `.cache/` na dysku (Skinport)

## Uruchomienie

```bash
npm install
cp .env.example .env        # ustaw walutę i kurs USD
npm run sync:skinport       # opcjonalnie: pierwszy sync katalogu Skinport
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
    arbitrage/route.ts  # GET /api/arbitrage — tabela arbitrażu (bulk snapshot)
  page.tsx              # tabela arbitrażu + porównywarka pojedynczego itemu
  layout.tsx, globals.css
lib/
  types.ts              # MarketPrice, ComparisonResult, ArbitrageRow, …
  config.ts             # konfiguracja z ENV
  cache.ts              # cache w pamięci z TTL + dedup równoległych zapytań
  sync/
    snapshot.ts         # join Skinport + CSFloat
    invalidate.ts       # unieważnianie cache snapshotu
  skinport/
    sync-worker.ts      # REST sync co 10 min (jedyny moduł wołający Skinport API)
    sale-feed.ts        # WebSocket live (listed/sold)
    catalog-store.ts    # katalog w pamięci + zapis .cache/
  markets/
    skinport.ts         # adapter odczytu z lokalnego katalogu
    csfloat.ts          # adapter CSFloat (price-list cache 1 min)
    index.ts            # rejestr marketów + compareItem()
instrumentation.ts      # start worker Skinport przy starcie serwera
scripts/sync-skinport.ts # ręczny sync: npm run sync:skinport
```

### Odświeżanie danych

| Źródło | Mechanizm | Interwał |
| --- | --- | --- |
| Skinport katalog | Worker REST `/v1/items` | co 10 min (1 req) |
| Skinport live | WebSocket Sale Feed | eventy listed/sold |
| CSFloat | `/api/v1/listings/price-list` | cache 1 min |
| UI (polling) | `/api/arbitrage` | co 60 s (tylko odczyt cache) |

### Jak dodać nowy market

1. Utwórz `lib/markets/<nazwa>.ts` i zaimplementuj interfejs `MarketAdapter`
   (`id`, `name`, `getCheapest(marketHashName)` zwracające `MarketPrice`).
2. Dodaj adapter do tablicy `MARKETS` w `lib/markets/index.ts`.
3. Gotowe — pojawi się automatycznie w porównaniu i w UI.

## Uwagi o API

- **Skinport** `/v1/items`: odpytywany **wyłącznie przez worker** (`lib/skinport/sync-worker.ts`),
  max 1× co 10 min. UI i filtry czytają lokalny katalog. Live update przez WebSocket Sale Feed.
- **CSFloat** `/api/v1/listings/price-list`: indeks ~26k itemów, cache 1 min.

## Roadmap (narzędzia do akcji)

- Alerty cenowe / progi arbitrażu (spread między marketami)
- Lista obserwowanych itemów (watchlist)
- Integracja z kontem (listowanie/kupno) — wymaga kluczy API i autoryzacji
- Kolejne markety: Buff163, DMarket, Steam Market
