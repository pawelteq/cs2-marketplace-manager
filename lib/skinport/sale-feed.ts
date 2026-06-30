// Skinport Live Sale Feed (WebSocket).
// Dokumentacja: https://docs.skinport.com/websocket/sale-feed

import { io, type Socket } from "socket.io-client";
import { CS2_APP_ID, DEFAULT_CURRENCY } from "@/lib/config";
import {
  applyListedSale,
  applySoldSale,
  type SaleFeedSale,
} from "@/lib/skinport/catalog-store";

import { skinportGlobals } from "@/lib/skinport/globals";
import msgpackParser from "socket.io-msgpack-parser";

interface RawSale {
  marketHashName?: string;
  salePrice?: number;
  url?: string;
  currency?: string;
}

interface RawFeedEvent {
  eventType?: string;
  sales?: RawSale[];
}

function mapSale(raw: RawSale): SaleFeedSale | null {
  if (!raw.marketHashName || typeof raw.salePrice !== "number") return null;
  return {
    marketHashName: raw.marketHashName,
    salePrice: raw.salePrice,
    url: raw.url,
    currency: raw.currency,
  };
}

function handleFeedEvent(result: RawFeedEvent, currency: string): boolean {
  const eventType = result.eventType;
  const sales = result.sales ?? [];
  if (!eventType || sales.length === 0) return false;

  let changed = false;
  for (const raw of sales) {
    const sale = mapSale(raw);
    if (!sale) continue;

    if (eventType === "listed") {
      changed = applyListedSale(sale, currency) || changed;
    } else if (eventType === "sold") {
      changed = applySoldSale(sale, currency) || changed;
    }
  }

  return changed;
}

export function startSkinportSaleFeed(
  currency: string = DEFAULT_CURRENCY,
  onCatalogUpdate: () => void,
): void {
  const g = skinportGlobals();
  if (g.saleFeedStarted && g.saleFeedSocket?.connected) return;
  g.saleFeedStarted = true;
  g.onSaleFeedUpdate = onCatalogUpdate;

  if (g.saleFeedSocket) {
    g.saleFeedSocket.disconnect();
  }

  g.saleFeedSocket = io("https://skinport.com", {
    transports: ["websocket"],
    // msgpack parser — typy socket.io-client nie obejmują custom parsera Skinport
    parser: msgpackParser as NonNullable<Parameters<typeof io>[1]>["parser"],
    reconnection: true,
    reconnectionDelay: 5000,
  });

  g.saleFeedSocket.on("connect", () => {
    g.saleFeedSocket?.emit("saleFeedJoin", {
      appid: CS2_APP_ID,
      currency,
      locale: "en",
    });
  });

  g.saleFeedSocket.on("saleFeed", (result: RawFeedEvent) => {
    if (handleFeedEvent(result, currency) && g.onSaleFeedUpdate) {
      g.onSaleFeedUpdate();
    }
  });

  g.saleFeedSocket.on("connect_error", (err: Error) => {
    console.warn("[skinport sale-feed]", err.message);
  });
}

export function stopSkinportSaleFeed(): void {
  const g = skinportGlobals();
  g.saleFeedSocket?.disconnect();
  g.saleFeedSocket = undefined;
  g.saleFeedStarted = false;
  g.onSaleFeedUpdate = undefined;
}
