import type { HostStorage } from '@nonu/host/types';

const VIEW_KEY = 'svn.view';

export interface SavedView {
  filterStatus: string;
  showIgnored: boolean;
  sortBy: string;
  groupByFolder: boolean;
}

export function loadView(storage: HostStorage): SavedView | undefined {
  return storage.get<SavedView>(VIEW_KEY);
}

export function saveView(storage: HostStorage, view: SavedView): Promise<void> {
  return storage.set(VIEW_KEY, view);
}
