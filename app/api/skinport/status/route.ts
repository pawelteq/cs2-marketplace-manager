import { NextResponse } from "next/server";
import {
  ensureSkinportSyncWorkerStarted,
  getSkinportSyncStatus,
  syncSkinportCatalog,
} from "@/lib/skinport/sync-worker";

export const dynamic = "force-dynamic";

export async function GET() {
  ensureSkinportSyncWorkerStarted();
  const status = await getSkinportSyncStatus();
  return NextResponse.json(status);
}

export async function POST() {
  ensureSkinportSyncWorkerStarted();
  const ok = await syncSkinportCatalog(undefined, true);
  const status = await getSkinportSyncStatus();
  return NextResponse.json({ ok, ...status });
}
