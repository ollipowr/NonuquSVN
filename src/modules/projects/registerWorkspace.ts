import type { HostStorage } from '@nonu/host/types';
import { detectSvnRepo, type SvnRepoInfo } from '@nonu/svn';
import { attachWorkspace } from './attach.js';
import {
  loadProjectStore,
  PROJECTS_CHANGED,
  saveProjectStore,
} from './projects.js';

export type DetectFn = (path: string) => Promise<SvnRepoInfo>;

/** Files an opened working copy under its project. Never throws. */
export async function registerWorkspace(
  storage: HostStorage,
  path: string,
  detect?: DetectFn,
): Promise<void> {
  try {
    const info = await (detect ?? detectSvnRepo)(path);
    if (!info.isWorkingCopy) return;
    const store = loadProjectStore(storage);
    const next = attachWorkspace(store, path, info);
    if (next === store) return;
    await saveProjectStore(storage, next);
    window.dispatchEvent(new Event(PROJECTS_CHANGED));
  } catch {
    // Bookkeeping must never prevent opening a working copy.
  }
}
