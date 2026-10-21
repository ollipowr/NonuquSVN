import type { HostStorage } from '@nonu/host/types';
import { loadSettings } from '@nonu/modules/settings/settings';
import { loadProjectStore, pickLastWorkspace } from './projects.js';

/** Folder to open at startup when requested; `undefined` otherwise. Never throws. */
export function startupWorkspace(storage: HostStorage): string | undefined {
  try {
    if (!loadSettings(storage).openLastOnStart) return undefined;
    return pickLastWorkspace(loadProjectStore(storage))?.localPath;
  } catch {
    return undefined;
  }
}
