// GET /api/arbitrage/snapshot — pełny snapshot (odświeżany co ~5 min na serwerze).
// Filtry stosuj po stronie klienta — bez ponownego odpytywania Skinport/CSFloat.

import { NextResponse } from "next/server";
import { ensureSkinportSyncWorkerStarted } from "@/lib/skinport/sync-worker";
import {
  getArbitrageSnapshot,
  getSnapshotRefreshInSec,
} from "@/lib/sync/snapshot";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    ensureSkinportSyncWorkerStarted();
    const snapshot = await getArbitrageSnapshot();
    return NextResponse.json({
      ...snapshot,
      nextRefreshInSec: getSnapshotRefreshInSec(),
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Snapshot fetch failed" },
      { status: 502 },
    );
  }
}
