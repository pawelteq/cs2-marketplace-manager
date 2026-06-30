// Persystencja stanu syncu Skinport — przetrwa restart serwera i HMR w dev.

import fs from "fs/promises";
import path from "path";

const META_FILE = path.join(process.cwd(), ".cache", "skinport-meta.json");

export interface SkinportSyncMeta {
  retryAfter: number;
  lastSyncAttempt: number;
  lastSyncSuccess: number | null;
  consecutiveFailures: number;
  lastError: string | null;
}

const DEFAULT_META: SkinportSyncMeta = {
  retryAfter: 0,
  lastSyncAttempt: 0,
  lastSyncSuccess: null,
  consecutiveFailures: 0,
  lastError: null,
};

export async function readSkinportMeta(): Promise<SkinportSyncMeta> {
  try {
    const raw = await fs.readFile(META_FILE, "utf-8");
    return { ...DEFAULT_META, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_META };
  }
}

export async function writeSkinportMeta(
  patch: Partial<SkinportSyncMeta>,
): Promise<SkinportSyncMeta> {
  const current = await readSkinportMeta();
  const next = { ...current, ...patch };
  await fs.mkdir(path.dirname(META_FILE), { recursive: true });
  await fs.writeFile(META_FILE, JSON.stringify(next));
  return next;
}
