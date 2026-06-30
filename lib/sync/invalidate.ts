// Mostek do unieważniania snapshotu bez cyklicznych importów.

type InvalidateListener = () => void;

const listeners = new Set<InvalidateListener>();

export function onArbitrageSnapshotInvalidate(listener: InvalidateListener): void {
  listeners.add(listener);
}

export function invalidateArbitrageSnapshot(): void {
  for (const listener of listeners) listener();
}
