// Singleton worker/websocket w dev (HMR resetuje moduły, nie globalThis).

import type { Socket } from "socket.io-client";

type SkinportGlobals = {
  workerStarted?: boolean;
  syncTimer?: ReturnType<typeof setInterval>;
  saleFeedStarted?: boolean;
  saleFeedSocket?: Socket;
  onSaleFeedUpdate?: () => void;
};

export function skinportGlobals(): SkinportGlobals {
  const g = globalThis as typeof globalThis & { __skinport?: SkinportGlobals };
  if (!g.__skinport) g.__skinport = {};
  return g.__skinport;
}
