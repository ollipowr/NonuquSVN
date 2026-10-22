import type { LogEntry } from '@nonu/components/layout/OutputPanel';
import { useSyncExternalStore } from 'react';

const MAX_ENTRIES = 200;

type OutputState = {
  entries: LogEntry[];
  busy: boolean;
  collapsed: boolean;
  visible: boolean;
  height: number;
};

let state: OutputState = {
  entries: [],
  busy: false,
  collapsed: false,
  visible: true,
  height: 140,
};
const listeners = new Set<() => void>();

const update = (patch: Partial<OutputState>) => {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener());
};
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const appendOutput = (...items: LogEntry[]) =>
  update({ entries: [...state.entries, ...items].slice(-MAX_ENTRIES) });
export const clearOutput = () => update({ entries: [] });
export const setOutputBusy = (busy: boolean) => update({ busy });
export const setOutputCollapsed = (collapsed: boolean) => update({ collapsed });
export const setOutputVisible = (visible: boolean) => update({ visible });
export const setOutputHeight = (height: number) => update({ height });

export const useOutput = () =>
  useSyncExternalStore(subscribe, () => state);
