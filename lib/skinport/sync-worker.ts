// Worker synchronizacji Skinport — jedyny moduł odpytujący REST API.
// Pełny sync co 10 min + inkrementalne aktualizacje przez WebSocket Sale Feed.
// Skinport: limit 8 req / 5 min — 1 req / 10 min jest bezpiecznym marginesem.

import { CS2_APP_ID, DEFAULT_CURRENCY } from "@/lib/config";
import type { SkinportItem } from "@/lib/markets/skinport-types";
import {
  ensureCatalogInitialized,
  getCatalogItemCount,
  hydrateCatalogFromDisk,
  replaceCatalog,
  writeDiskCatalog,
} from "@/lib/skinport/catalog-store";
import { skinportGlobals } from "@/lib/skinport/globals";
import { readSkinportMeta, writeSkinportMeta } from "@/lib/skinport/meta";
import { startSkinportSaleFeed } from "@/lib/skinport/sale-feed";
import { invalidateArbitrageSnapshot } from "@/lib/sync/invalidate";

const TEN_MIN_MS = 10 * 60 * 1000;
const SYNC_INTERVAL_MS = TEN_MIN_MS;
const BACKOFF_MS = TEN_MIN_MS;

let skinportRetryAfter = 0;
let lastSkinportWarning: string | null = null;
let syncInflight = false;
let metaLoaded = false;

export interface SkinportSyncStatus {
  catalogItems: number;
  backoffActive: boolean;
  retryAfter: number | null;
  retryInSec: number;
  lastSyncSuccess: number | null;
  lastSyncAttempt: number | null;
  consecutiveFailures: number;
  lastError: string | null;
  workerStarted: boolean;
}

async function loadMetaIntoMemory(): Promise<void> {
  if (metaLoaded) return;
  const meta = await readSkinportMeta();
  const now = Date.now();
  if (meta.retryAfter > now + BACKOFF_MS) {
    skinportRetryAfter = now + BACKOFF_MS;
    await writeSkinportMeta({ retryAfter: skinportRetryAfter });
  } else {
    skinportRetryAfter = meta.retryAfter;
  }
  metaLoaded = true;
}

export function isSkinportBackoffActive(): boolean {
  return Date.now() < skinportRetryAfter;
}

export function getSkinportStatusWarning(): string | null {
  return lastSkinportWarning;
}

export async function getSkinportSyncStatus(
  currency: string = DEFAULT_CURRENCY,
): Promise<SkinportSyncStatus> {
  await loadMetaIntoMemory();
  const meta = await readSkinportMeta();
  const retryInSec = Math.max(
    0,
    Math.ceil((skinportRetryAfter - Date.now()) / 1000),
  );
  return {
    catalogItems: getCatalogItemCount(currency),
    backoffActive: isSkinportBackoffActive(),
    retryAfter: skinportRetryAfter > Date.now() ? skinportRetryAfter : null,
    retryInSec,
    lastSyncSuccess: meta.lastSyncSuccess,
    lastSyncAttempt: meta.lastSyncAttempt,
    consecutiveFailures: meta.consecutiveFailures,
    lastError: meta.lastError,
    workerStarted: !!skinportGlobals().workerStarted,
  };
}

function computeBackoffMs(retryAfterHeader: string | null): number {
  if (retryAfterHeader) {
    const sec = Number(retryAfterHeader);
    if (Number.isFinite(sec) && sec > 0) {
      return Math.min(sec * 1000, BACKOFF_MS);
    }
  }
  return BACKOFF_MS;
}

async function record429(retryAfterHeader: string | null): Promise<void> {
  const meta = await readSkinportMeta();
  const backoffMs = computeBackoffMs(retryAfterHeader);
  skinportRetryAfter = Date.now() + backoffMs;
  await writeSkinportMeta({
    retryAfter: skinportRetryAfter,
    consecutiveFailures: meta.consecutiveFailures + 1,
    lastError: "Skinport API 429",
    lastSyncAttempt: Date.now(),
  });
  lastSkinportWarning = `Skinport API 429 — kolejna próba za ${Math.ceil(backoffMs / 60000)} min.`;
}

async function fetchFromSkinportApi(
  currency: string,
): Promise<SkinportItem[]> {
  const params = new URLSearchParams({
    app_id: String(CS2_APP_ID),
    currency,
    tradable: "0",
  });
  const res = await fetch(`https://api.skinport.com/v1/items?${params}`, {
    headers: { "Accept-Encoding": "br" },
    cache: "no-store",
  });

  if (res.status === 429) {
    await record429(res.headers.get("Retry-After"));
    throw new Error("Skinport API 429");
  }
  if (!res.ok) {
    await writeSkinportMeta({
      lastSyncAttempt: Date.now(),
      lastError: `Skinport API ${res.status}`,
    });
    throw new Error(`Skinport API ${res.status}`);
  }

  skinportRetryAfter = 0;
  lastSkinportWarning = null;
  await writeSkinportMeta({
    retryAfter: 0,
    consecutiveFailures: 0,
    lastError: null,
    lastSyncSuccess: Date.now(),
    lastSyncAttempt: Date.now(),
  });
  return (await res.json()) as SkinportItem[];
}

/** Pełny sync katalogu z REST API (max 1× / 10 min, respektuje backoff). */
export async function syncSkinportCatalog(
  currency: string = DEFAULT_CURRENCY,
  force = false,
): Promise<boolean> {
  await loadMetaIntoMemory();

  if (syncInflight) return getCatalogItemCount(currency) > 0;

  if (!force && isSkinportBackoffActive()) {
    lastSkinportWarning =
      getCatalogItemCount(currency) > 0
        ? "Skinport REST zablokowany (429) — katalog z cache/WebSocket."
        : `Skinport REST zablokowany (429) — kolejna próba za ${Math.ceil((skinportRetryAfter - Date.now()) / 60000)} min. WebSocket nadal nasłuchuje.`;
    return getCatalogItemCount(currency) > 0;
  }

  syncInflight = true;
  try {
    const items = await fetchFromSkinportApi(currency);
    replaceCatalog(items, currency);
    await writeDiskCatalog(currency, items);
    invalidateArbitrageSnapshot();
    lastSkinportWarning = null;
    return true;
  } catch (e) {
    if (getCatalogItemCount(currency) === 0) {
      await hydrateCatalogFromDisk(currency);
    }
    if (!lastSkinportWarning) {
      lastSkinportWarning =
        e instanceof Error ? e.message : "Skinport niedostępny";
    }
    return getCatalogItemCount(currency) > 0;
  } finally {
    syncInflight = false;
  }
}

async function bootstrap(currency: string): Promise<void> {
  ensureCatalogInitialized(currency);
  await hydrateCatalogFromDisk(currency);
  await syncSkinportCatalog(currency);
}

export function startSkinportSyncWorker(
  currency: string = DEFAULT_CURRENCY,
): void {
  const g = skinportGlobals();
  if (g.workerStarted) return;
  g.workerStarted = true;

  void bootstrap(currency).then(() => {
    startSkinportSaleFeed(currency, () => {
      invalidateArbitrageSnapshot();
    });
  });

  if (g.syncTimer) clearInterval(g.syncTimer);
  g.syncTimer = setInterval(() => {
    void syncSkinportCatalog(currency);
  }, SYNC_INTERVAL_MS);
}

export function ensureSkinportSyncWorkerStarted(
  currency: string = DEFAULT_CURRENCY,
): void {
  startSkinportSyncWorker(currency);
}
