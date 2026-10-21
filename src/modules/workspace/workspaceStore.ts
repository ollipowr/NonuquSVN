import {
  detectSvnRepo,
  hasRemoteChanges,
  parseExternalsProperty,
  parseSvnStatus,
  runSvn,
  type SvnChange,
  type SvnCredentials,
  type SvnRepoInfo,
} from '@nonu/svn';
import { useSyncExternalStore } from 'react';

/** A removed entry can finish for its caller, but can never repopulate the cache. */
export class RequestCache<T> {
  private entries = new Map<string, { value?: T; pending?: Promise<T> }>();
  peek(key: string): T | undefined {
    return this.entries.get(key)?.value;
  }
  load(key: string, loader: () => Promise<T>, force = false): Promise<T> {
    const hit = this.entries.get(key);
    if (hit?.pending) return hit.pending;
    if (!force && hit?.value !== undefined) return Promise.resolve(hit.value);
    const entry: { value?: T; pending?: Promise<T> } = {};
    this.entries.set(key, entry);
    entry.pending = Promise.resolve()
      .then(loader)
      .then(
        (value) => {
          entry.value = value;
          entry.pending = undefined;
          return value;
        },
        (error) => {
          if (this.entries.get(key) === entry) this.entries.delete(key);
          throw error;
        },
      );
    return entry.pending;
  }
  invalidate(matches: (key: string) => boolean) {
    for (const key of this.entries.keys())
      if (matches(key)) this.entries.delete(key);
  }
}

export interface WorkspaceStatus {
  repo: SvnRepoInfo;
  changes: SvnChange[];
  revision?: string;
  updateAvailable?: boolean;
  fetchedAt: number;
}
export const workspaceKey = (path: string) =>
  path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
const snapshots = new Map<string, WorkspaceStatus>();
const knownUrls = new Map<string, string>();
const listeners = new Set<() => void>();
const statuses = new RequestCache<WorkspaceStatus>();
const remote = new RequestCache<boolean | undefined>();
export const remoteBranchStatuses = new RequestCache<
  import('@nonu/modules/branches').BranchStatus
>();
export const mergeinfo = new RequestCache<number[]>();
const generations = new Map<string, number>();
let version = 0;
const emit = () => {
  version++;
  listeners.forEach((listener) => listener());
};
const subscribe = (callback: () => void) => {
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
  };
};
export function getWorkspaceStatus(cwd: string | null | undefined) {
  return cwd ? snapshots.get(workspaceKey(cwd)) : undefined;
}
export function useWorkspaceStatus(cwd: string | null | undefined) {
  return useSyncExternalStore(subscribe, () => getWorkspaceStatus(cwd));
}
/** Re-renders on every status change; for lists that read many working copies. */
export function useWorkspaceStatusVersion() {
  return useSyncExternalStore(subscribe, () => version);
}

/** Fills in `externalTarget` for external changes: the property lives on the parent folder, so one propget per parent. Failures are swallowed. */
async function resolveExternalTargets(
  changes: SvnChange[],
  cwd: string,
  credentials?: SvnCredentials,
): Promise<void> {
  const externals = changes.filter((c) => c.status === 'external');
  if (externals.length === 0) return;
  const byParent = new Map<string, { change: SvnChange; name: string }[]>();
  for (const change of externals) {
    const slash = Math.max(
      change.path.lastIndexOf('/'),
      change.path.lastIndexOf('\\'),
    );
    const parent = slash === -1 ? '.' : change.path.slice(0, slash);
    const name = slash === -1 ? change.path : change.path.slice(slash + 1);
    if (!byParent.has(parent)) byParent.set(parent, []);
    byParent.get(parent)!.push({ change, name });
  }
  await Promise.all(
    [...byParent.entries()].map(async ([parent, entries]) => {
      try {
        const { stdout } = await runSvn(
          ['propget', 'svn:externals', parent],
          cwd,
          credentials,
        );
        for (const { change, name } of entries) {
          const target = parseExternalsProperty(stdout, name);
          if (target) change.externalTarget = target;
        }
      } catch {
        // No svn:externals property found, or propget failed — leave externalTarget undefined.
      }
    }),
  );
}

export function loadWorkspaceStatus(
  cwd: string,
  force = false,
  credentials?: SvnCredentials,
): Promise<WorkspaceStatus> {
  const key = workspaceKey(cwd);
  const generation = generations.get(key);
  return statuses
    .load(
      key,
      async () => {
        const [repo, result] = await Promise.all([
          detectSvnRepo(cwd, credentials),
          runSvn(
            ['status', '--no-ignore', '--ignore-externals'],
            cwd,
            credentials,
          ).then(
            (result) => ({ result }),
            (error) => ({ error }),
          ),
        ]);
        if (repo.isWorkingCopy && 'error' in result) throw result.error;
        const changes =
          repo.isWorkingCopy && 'result' in result
            ? parseSvnStatus(result.result.stdout, true)
            : [];
        await resolveExternalTargets(changes, cwd, credentials);
        const value: WorkspaceStatus = {
          repo,
          revision: repo.revision,
          changes,
          updateAvailable: snapshots.get(key)?.updateAvailable,
          fetchedAt: Date.now(),
        };
        if (generations.get(key) === generation) {
          snapshots.set(key, value);
          if (repo.url) knownUrls.set(key, repo.url);
          emit();
        }
        return value;
      },
      force,
    )
    .then((value) => snapshots.get(key) ?? value);
}

export async function checkWorkspaceRemote(
  cwd: string,
  repo: SvnRepoInfo,
  force = false,
  credentials?: SvnCredentials,
) {
  const key = workspaceKey(cwd);
  const generation = generations.get(key);
  const result = await remote.load(
    JSON.stringify([key, repo.revision]),
    () => hasRemoteChanges(cwd, repo, credentials),
    force,
  );
  const snapshot = snapshots.get(key);
  if (
    snapshot &&
    generation === generations.get(key) &&
    snapshot.revision === repo.revision
  ) {
    snapshots.set(key, {
      ...snapshot,
      repo,
      revision: repo.revision,
      updateAvailable: result,
    });
    emit();
  }
  return result;
}

/** A commit advances the displayed revision before svn info's WC base catches up. */
export function publishWorkspaceRevision(cwd: string, revision: string) {
  const key = workspaceKey(cwd);
  const snapshot = snapshots.get(key);
  if (!snapshot) return;
  snapshots.set(key, {
    ...snapshot,
    repo: { ...snapshot.repo, revision },
    revision,
    updateAvailable: false,
  });
  emit();
}

export function invalidateMergeinfo(urls: string[]) {
  const normalized = urls.map((url) => url.replace(/\/+$/, ''));
  mergeinfo.invalidate((key) => {
    const [source, target] = JSON.parse(key) as string[];
    return normalized.includes(source) || normalized.includes(target);
  });
  remoteBranchStatuses.invalidate((key) => normalized.includes(key));
}

/** Invalidate only this working copy and pairs involving its old/new URL. */
export function invalidateWorkspace(cwd: string, urls: string[] = []) {
  const key = workspaceKey(cwd);
  const oldUrl = knownUrls.get(key);
  generations.set(key, (generations.get(key) ?? 0) + 1);
  statuses.invalidate((candidate) => candidate === key);
  remote.invalidate(
    (candidate) => (JSON.parse(candidate) as string[])[0] === key,
  );
  snapshots.delete(key);
  invalidateMergeinfo([...urls, ...(oldUrl ? [oldUrl] : [])]);
  emit();
}
