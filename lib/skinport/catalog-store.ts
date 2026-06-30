// Centralny katalog Skinport w pamięci + zapis na dysk.
// Aktualizowany wyłącznie przez sync-worker (REST co 5 min + WebSocket).

import fs from "fs/promises";
import path from "path";
import type { SkinportItem } from "@/lib/markets/skinport-types";

const CACHE_DIR = path.join(process.cwd(), ".cache");

export interface SaleFeedSale {
  marketHashName: string;
  salePrice: number;
  url?: string;
  currency?: string;
}

interface CatalogState {
  items: Map<string, SkinportItem>;
  loadedAt: number;
  currency: string;
}

let state: CatalogState | null = null;

function cacheFilePath(currency: string): string {
  return path.join(CACHE_DIR, `skinport-${currency}.json`);
}

export function getCatalogItems(currency: string): SkinportItem[] {
  if (!state || state.currency !== currency) return [];
  return Array.from(state.items.values());
}

export function getCatalogLoadedAt(currency: string): number | null {
  if (!state || state.currency !== currency) return null;
  return state.loadedAt;
}

export function isCatalogLoaded(currency: string): boolean {
  return getCatalogItemCount(currency) > 0;
}

export function getCatalogItemCount(currency: string): number {
  if (!state || state.currency !== currency) return 0;
  return state.items.size;
}

/** Pusty katalog — WebSocket może go wypełniać bez REST. */
export function ensureCatalogInitialized(currency: string): void {
  if (!state || state.currency !== currency) {
    state = { items: new Map(), loadedAt: Date.now(), currency };
  }
}

export async function readDiskCatalog(
  currency: string,
): Promise<{ items: SkinportItem[]; savedAt: number } | null> {
  try {
    const raw = await fs.readFile(cacheFilePath(currency), "utf-8");
    const parsed = JSON.parse(raw) as {
      items?: SkinportItem[];
      savedAt?: number;
    };
    if (!parsed.items?.length) return null;
    return { items: parsed.items, savedAt: parsed.savedAt ?? 0 };
  } catch {
    return null;
  }
}

export async function writeDiskCatalog(
  currency: string,
  items: SkinportItem[],
): Promise<void> {
  const file = cacheFilePath(currency);
  await fs.mkdir(CACHE_DIR, { recursive: true });
  await fs.writeFile(
    file,
    JSON.stringify({ savedAt: Date.now(), currency, items }),
  );
}

export function loadCatalogIntoMemory(
  items: SkinportItem[],
  currency: string,
  loadedAt = Date.now(),
): void {
  const map = new Map<string, SkinportItem>();
  for (const it of items) map.set(it.market_hash_name, it);
  state = { items: map, loadedAt, currency };
}

export async function hydrateCatalogFromDisk(currency: string): Promise<boolean> {
  const disk = await readDiskCatalog(currency);
  if (!disk) return false;
  loadCatalogIntoMemory(disk.items, currency, disk.savedAt);
  return true;
}

export function replaceCatalog(items: SkinportItem[], currency: string): void {
  loadCatalogIntoMemory(items, currency, Date.now());
}

function emptyItem(name: string, currency: string, url?: string): SkinportItem {
  return {
    market_hash_name: name,
    currency,
    suggested_price: null,
    item_page: url ? `https://skinport.com/item/${url}` : "",
    market_page: "",
    min_price: null,
    max_price: null,
    mean_price: null,
    median_price: null,
    quantity: 0,
  };
}

/** Inkrementalna aktualizacja z WebSocket Sale Feed — event `listed`. */
export function applyListedSale(sale: SaleFeedSale, currency: string): boolean {
  ensureCatalogInitialized(currency);
  if (!state) return false;

  const price = sale.salePrice / 100;
  const name = sale.marketHashName;
  const existing = state.items.get(name) ?? emptyItem(name, currency, sale.url);

  const quantity = existing.quantity + 1;
  const min_price =
    existing.min_price === null || existing.min_price <= 0
      ? price
      : Math.min(existing.min_price, price);

  state.items.set(name, {
    ...existing,
    currency: sale.currency ?? currency,
    quantity,
    min_price,
    item_page: existing.item_page || (sale.url ? `https://skinport.com/item/${sale.url}` : ""),
  });
  state.loadedAt = Date.now();
  return true;
}

/** Inkrementalna aktualizacja z WebSocket Sale Feed — event `sold`. */
export function applySoldSale(sale: SaleFeedSale, currency: string): boolean {
  ensureCatalogInitialized(currency);
  if (!state) return false;

  const existing = state.items.get(sale.marketHashName);
  if (!existing) return false;

  const quantity = Math.max(0, existing.quantity - 1);
  state.items.set(sale.marketHashName, {
    ...existing,
    quantity,
    min_price: quantity === 0 ? null : existing.min_price,
  });
  state.loadedAt = Date.now();
  return true;
}
