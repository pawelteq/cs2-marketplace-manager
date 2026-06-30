// Prosty cache w pamięci procesu z TTL.
// Wykorzystywany m.in. do trzymania pełnej listy itemów ze Skinport
// (endpoint /v1/items jest cache'owany 5 min i ma limit 8 req / 5 min).

interface Entry<T> {
  value: T;
  expiresAt: number;
}

const store = new Map<string, Entry<unknown>>();

/** Zwraca wartość z cache lub undefined gdy wygasła / nie istnieje. */
export function cacheGet<T>(key: string): T | undefined {
  const entry = store.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) return undefined;
  return entry.value as T;
}

/** Zwraca ostatnią wartość z cache nawet po wygaśnięciu TTL (fallback przy błędach API). */
export function cacheGetStale<T>(key: string): T | undefined {
  const entry = store.get(key);
  return entry ? (entry.value as T) : undefined;
}

/** Zapisuje wartość z czasem życia (ttlMs). */
export function cacheSet<T>(key: string, value: T, ttlMs: number): void {
  store.set(key, { value, expiresAt: Date.now() + ttlMs });
}

/**
 * Zwraca wartość z cache albo wykonuje `loader`, zapisuje wynik i go zwraca.
 * Deduplikuje równoległe wywołania dla tego samego klucza.
 */
const inflight = new Map<string, Promise<unknown>>();

export async function cached<T>(
  key: string,
  ttlMs: number,
  loader: () => Promise<T>,
): Promise<T> {
  const hit = cacheGet<T>(key);
  if (hit !== undefined) return hit;

  const existing = inflight.get(key) as Promise<T> | undefined;
  if (existing) return existing;

  const promise = (async () => {
    try {
      const value = await loader();
      cacheSet(key, value, ttlMs);
      return value;
    } catch (e) {
      const stale = cacheGetStale<T>(key);
      if (stale !== undefined) return stale;
      throw e;
    } finally {
      inflight.delete(key);
    }
  })();

  inflight.set(key, promise);
  return promise;
}
