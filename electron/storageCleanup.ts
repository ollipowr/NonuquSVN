import fs from 'node:fs';
import path from 'node:path';
import type { Session } from 'electron';
import type { StorageCleanupId, StorageCleanupItem, StorageCleanupResult } from '../src/host/types';

// Paths relative to userData. svn-client-storage.json (settings, workspaces) is deliberately absent.
const TARGETS: Record<StorageCleanupId, string[]> = {
  'http-cache': ['Cache'],
  'code-cache': ['Code Cache'],
  reflog: ['reflog'],
};

const IDS = Object.keys(TARGETS) as StorageCleanupId[];

function sizeOf(target: string): number {
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(target);
  } catch {
    return 0;
  }
  if (!stat.isDirectory()) return stat.size;
  return fs
    .readdirSync(target)
    .reduce((sum, name) => sum + sizeOf(path.join(target, name)), 0);
}

export function measureStorageCleanup(userData: string): StorageCleanupItem[] {
  return IDS.map((id) => ({
    id,
    bytes: TARGETS[id].reduce((sum, name) => sum + sizeOf(path.join(userData, name)), 0),
  }));
}

// Chromium-owned caches go through the session API: the running app holds their files open.
export async function runStorageCleanup(
  userData: string,
  ids: StorageCleanupId[],
  session: Session,
): Promise<StorageCleanupResult[]> {
  const results: StorageCleanupResult[] = [];
  for (const id of ids.filter((x) => IDS.includes(x))) {
    try {
      if (id === 'http-cache') await session.clearCache();
      else if (id === 'code-cache') await session.clearCodeCaches({});
      else
        for (const name of TARGETS[id])
          fs.rmSync(path.join(userData, name), { recursive: true, force: true });
      results.push({ id });
    } catch (e) {
      results.push({ id, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return results;
}

// Files Chromium still holds open are skipped; they go on the next start.
export async function wipeUserData(userData: string, session: Session): Promise<void> {
  await Promise.allSettled([
    session.clearCache(),
    session.clearCodeCaches({}),
    session.clearStorageData(),
  ]);
  for (const name of fs.readdirSync(userData)) {
    try {
      fs.rmSync(path.join(userData, name), { recursive: true, force: true });
    } catch {
      // still held open by Chromium; removed on a later start
    }
  }
}
