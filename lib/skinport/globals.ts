// Singleton worker/websocket w dev (HMR resetuje moduły, nie globalThis).

import type { Socket } from "socket.io-client";

type SkinportGlobals = {
  workerStarted?: boolean;
  syncTimer?: ReturnType<typeof setInterval>;
  retryTimer?: ReturnType<typeof setTimeout>;
  saleFeedStarted?: boolean;
  saleFeedSocket?: Socket;
  onSaleFeedUpdate?: () => void;
  /** Stan syncu w globalThis — przetrwa HMR w dev. */
  skinportRetryAfter?: number;
  syncInflight?: boolean;
  lastSkinportWarning?: string | null;
  metaLoaded?: boolean;
};

export function skinportGlobals(): SkinportGlobals {
  const g = globalThis as typeof globalThis & { __skinport?: SkinportGlobals };
  if (!g.__skinport) g.__skinport = {};
  return g.__skinport;
}
