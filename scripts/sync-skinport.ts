/**
 * Ręczny sync katalogu Skinport (1 request REST).
 * Uruchom: npm run sync:skinport
 */

import { DEFAULT_CURRENCY } from "../lib/config";
import { getCatalogItemCount } from "../lib/skinport/catalog-store";
import { readSkinportMeta } from "../lib/skinport/meta";
import { syncSkinportCatalog } from "../lib/skinport/sync-worker";

async function main() {
  const ok = await syncSkinportCatalog(DEFAULT_CURRENCY, true);
  const count = getCatalogItemCount(DEFAULT_CURRENCY);
  if (ok && count > 0) {
    console.log(`Skinport sync OK — ${count} itemów w katalogu`);
    process.exit(0);
  }

  const meta = await readSkinportMeta();
  if (meta.retryAfter > Date.now()) {
    const min = Math.ceil((meta.retryAfter - Date.now()) / 60000);
    console.error(
      `Skinport API 429 — poczekaj ~${min} min przed kolejną próbą (limit 8 req / 5 min).`,
    );
  } else {
    console.error("Skinport sync failed — brak danych w cache");
  }
  process.exit(1);
}

main();
