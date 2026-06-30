/**
 * Ręczny sync katalogu Skinport (1 request REST).
 * Uruchom: npm run sync:skinport
 */

import { DEFAULT_CURRENCY } from "../lib/config";
import { getCatalogItemCount } from "../lib/skinport/catalog-store";
import { readSkinportMeta } from "../lib/skinport/meta";
import { syncSkinportCatalog } from "../lib/skinport/sync-worker";

async function main() {
  const force = process.argv.includes("--force");
  const ok = await syncSkinportCatalog(DEFAULT_CURRENCY, force);
  const count = getCatalogItemCount(DEFAULT_CURRENCY);
  if (ok && count > 0) {
    console.log(`Skinport sync OK — ${count} itemów w katalogu`);
    process.exit(0);
  }

  const meta = await readSkinportMeta();
  if (meta.retryAfter > Date.now()) {
    const sec = Math.ceil((meta.retryAfter - Date.now()) / 1000);
    const wait =
      sec >= 60 ? `~${Math.ceil(sec / 60)} min` : `${sec} s`;
    console.error(
      `Skinport API 429 — poczekaj ${wait} przed kolejną próbą (limit 8 req / 5 min). Użyj --force tylko gdy backoff minął.`,
    );
  } else {
    console.error("Skinport sync failed — brak danych w cache");
  }
  process.exit(1);
}

main();
