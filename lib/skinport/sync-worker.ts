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
const MIN_BACKOFF_MS = 60 * 1000;

function gState() {
  return skinportGlobals();
}

function getRetryAfter(): number {
  return gState().skinportRetryAfter ?? 0;
}

function setRetryAfter(value: number): void {
  gState().skinportRetryAfter = value;
}

function getLastWarning(): string | null {
  return gState().lastSkinportWarning ?? null;
}

function setLastWarning(value: string | null): void {
  gState().lastSkinportWarning = value;
}

function isSyncInflight(): boolean {
  return !!gState().syncInflight;
}

function setSyncInflight(value: boolean): void {
  gState().syncInflight = value;
}

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

async function loadMetaIntoMemory(force = false): Promise<void> {
  const g = gState();
  if (g.metaLoaded && !force) return;
  const meta = await readSkinportMeta();
  const now = Date.now();
  if (meta.retryAfter > now + BACKOFF_MS) {
    setRetryAfter(now + BACKOFF_MS);
    await writeSkinportMeta({ retryAfter: getRetryAfter() });
  } else {
    setRetryAfter(meta.retryAfter);
  }
  g.metaLoaded = true;
}

export function isSkinportBackoffActive(): boolean {
  return Date.now() < getRetryAfter();
}

export function getSkinportStatusWarning(): string | null {
  return getLastWarning();
}

function clearRetryTimer(): void {
  const g = gState();
  if (g.retryTimer) {
    clearTimeout(g.retryTimer);
    g.retryTimer = undefined;
  }
}

/** Po 429 retry za Retry-After (np. 2 min), nie dopiero przy interwale 10 min. */
function scheduleRetrySync(currency: string): void {
  const g = gState();
  clearRetryTimer();

  const delay = getRetryAfter() - Date.now();
  if (delay <= 0) return;

  g.retryTimer = setTimeout(() => {
    g.retryTimer = undefined;
    void syncSkinportCatalog(currency);
  }, delay + 500);
}

export async function getSkinportSyncStatus(
  currency: string = DEFAULT_CURRENCY,
): Promise<SkinportSyncStatus> {
  await loadMetaIntoMemory(true);
  if (getCatalogItemCount(currency) === 0) {
    await hydrateCatalogFromDisk(currency);
  }
  const meta = await readSkinportMeta();
  const retryAfter = Math.max(getRetryAfter(), meta.retryAfter);
  setRetryAfter(retryAfter);
  const retryInSec = Math.max(0, Math.ceil((retryAfter - Date.now()) / 1000));
  return {
    catalogItems: getCatalogItemCount(currency),
    backoffActive: retryAfter > Date.now(),
    retryAfter: retryAfter > Date.now() ? retryAfter : null,
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
      return Math.min(Math.max(sec * 1000, MIN_BACKOFF_MS), BACKOFF_MS);
    }
  }
  return BACKOFF_MS;
}

async function record429(
  retryAfterHeader: string | null,
  currency: string,
): Promise<void> {
  const meta = await readSkinportMeta();
  const backoffMs = computeBackoffMs(retryAfterHeader);
  setRetryAfter(Date.now() + backoffMs);
  await writeSkinportMeta({
    retryAfter: getRetryAfter(),
    consecutiveFailures: meta.consecutiveFailures + 1,
    lastError: "Skinport API 429",
    lastSyncAttempt: Date.now(),
  });
  const retryInSec = Math.ceil(backoffMs / 1000);
  const retryLabel =
    retryInSec >= 60
      ? `${Math.ceil(retryInSec / 60)} min`
      : `${retryInSec} s`;
  setLastWarning(`Skinport API 429 — kolejna próba za ${retryLabel}.`);
  scheduleRetrySync(currency);
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
    await record429(res.headers.get("Retry-After"), currency);
    throw new Error("Skinport API 429");
  }
  if (!res.ok) {
    await writeSkinportMeta({
      lastSyncAttempt: Date.now(),
      lastError: `Skinport API ${res.status}`,
    });
    throw new Error(`Skinport API ${res.status}`);
  }

  setRetryAfter(0);
  setLastWarning(null);
  clearRetryTimer();
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
  await loadMetaIntoMemory(true);

  if (isSyncInflight()) return getCatalogItemCount(currency) > 0;

  if (!force && isSkinportBackoffActive()) {
    const retryInSec = Math.max(
      0,
      Math.ceil((getRetryAfter() - Date.now()) / 1000),
    );
    const retryLabel =
      retryInSec >= 60
        ? `${Math.ceil(retryInSec / 60)} min`
        : `${retryInSec} s`;
    setLastWarning(
      getCatalogItemCount(currency) > 0
        ? "Skinport REST zablokowany (429) — katalog z cache/WebSocket."
        : `Skinport REST zablokowany (429) — kolejna próba za ${retryLabel}. WebSocket nadal nasłuchuje.`,
    );
    scheduleRetrySync(currency);
    return getCatalogItemCount(currency) > 0;
  }

  setSyncInflight(true);
  try {
    const items = await fetchFromSkinportApi(currency);
    replaceCatalog(items, currency);
    await writeDiskCatalog(currency, items);
    invalidateArbitrageSnapshot();
    setLastWarning(null);
    console.info(
      `[skinport] sync OK — ${items.length.toLocaleString()} itemów`,
    );
    return true;
  } catch (e) {
    if (getCatalogItemCount(currency) === 0) {
      await hydrateCatalogFromDisk(currency);
    }
    if (!getLastWarning()) {
      setLastWarning(e instanceof Error ? e.message : "Skinport niedostępny");
    }
    return getCatalogItemCount(currency) > 0;
  } finally {
    setSyncInflight(false);
  }
}

async function bootstrap(currency: string): Promise<void> {
  ensureCatalogInitialized(currency);
  await hydrateCatalogFromDisk(currency);
  await loadMetaIntoMemory(true);
  if (isSkinportBackoffActive()) {
    scheduleRetrySync(currency);
    return;
  }
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
