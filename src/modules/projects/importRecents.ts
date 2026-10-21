import type { HostStorage } from '@nonu/host/types';
import { detectSvnRepo } from '@nonu/svn';
import { mapLimit } from '@nonu/utils/mapLimit';
import { attachWorkspace } from './attach.js';
import {
  loadProjectStore,
  PROJECTS_CHANGED,
  saveProjectStore,
} from './projects.js';
import type { DetectFn } from './registerWorkspace.js';

/** One-time, background filing of recently opened folders under projects. */
export async function importRecentFolders(
  storage: HostStorage,
  folders: string[],
  detect?: DetectFn,
  limit = 3,
  now = Date.now(),
): Promise<void> {
  try {
    if (loadProjectStore(storage).recentsImported) return;
    const probe = detect ?? detectSvnRepo;
    const infos = await mapLimit(folders, limit, async (path) => {
      try {
        return await probe(path);
      } catch {
        return undefined;
      }
    });
    if (infos.some((info) => info?.svnMissing)) return;
    const start = loadProjectStore(storage);
    let store = start;
    folders.forEach((path, index) => {
      const info = infos[index];
      if (info?.isWorkingCopy)
        store = attachWorkspace(store, path, info, now - index * 1000);
    });
    await saveProjectStore(storage, {
      ...store,
      activeProjectId: start.activeProjectId,
      recentsImported: true,
    });
    window.dispatchEvent(new Event(PROJECTS_CHANGED));
  } catch {
    // Bookkeeping only.
  }
}
