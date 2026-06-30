// Uruchamia worker Skinport przy starcie serwera Node (dev + prod).

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startSkinportSyncWorker } = await import("@/lib/skinport/sync-worker");
    startSkinportSyncWorker();
  }
}
