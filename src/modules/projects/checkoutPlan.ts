import {
  type BranchKind,
  guessKindFromUrl,
} from '@nonu/modules/branches/branches';
import type { ProjectStore, RepositoryWorkspace } from './projects.js';
import type { FoundCopy } from './scanWorkingCopies.js';

export interface BranchCandidate {
  name: string;
  url: string;
  kind: BranchKind;
}

/** Directory names from `svn list` output (entries ending in "/"). */
export function parseSvnListDirs(stdout: string): string[] {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.endsWith('/'))
    .map((line) => line.slice(0, -1));
}

export function normalizeUrl(url: string): string {
  return url.replace(/\/+$/, '').toLowerCase();
}

/** Whether `url` lies inside `repoUrl`. Used when the repo root is known, since `branchGroupKey` breaks flat layouts. */
export function isInRepo(url: string, repoUrl: string): boolean {
  const root = normalizeUrl(repoUrl);
  const candidate = normalizeUrl(url);
  return candidate === root || candidate.startsWith(`${root}/`);
}

/** Standard trunk/branches layout; a URL without those folders is treated as a single branch. */
export function branchCandidates(
  repoUrl: string,
  rootDirs: string[],
  branchDirs: string[],
): BranchCandidate[] {
  const base = repoUrl.replace(/\/+$/, '');
  const hasLayout = rootDirs.includes('trunk') || rootDirs.includes('branches');
  if (!hasLayout) {
    return [{ name: leaf(base), url: base, kind: 'other' }];
  }
  const list: BranchCandidate[] = [];
  if (rootDirs.includes('trunk'))
    list.push({ name: 'trunk', url: `${base}/trunk`, kind: 'trunk' });
  for (const name of branchDirs)
    list.push({ name, url: `${base}/branches/${name}`, kind: 'branch' });
  // trunk/branches/tags is a convention: flat branch folders next to trunk count too.
  for (const name of rootDirs) {
    if (LAYOUT_DIRS.includes(name.toLowerCase())) continue;
    list.push({ name, url: `${base}/${name}`, kind: 'branch' });
  }
  return list;
}

const LAYOUT_DIRS = ['trunk', 'branches', 'tags'];

/** The working copy that already holds this branch URL, if any. */
export function existingCopy(
  store: ProjectStore,
  url: string,
): RepositoryWorkspace | undefined {
  const key = normalizeUrl(url);
  return store.workspaces.find(
    (w) => w.localPath && normalizeUrl(w.svnUrl) === key,
  );
}

function leaf(url: string): string {
  return url.split('/').filter(Boolean).pop() ?? url;
}

/** Branch names may contain slashes; a checkout target must stay one folder. */
export function targetFolderName(branchName: string): string {
  return (
    branchName
      .replace(/[\\/]+/g, '-')
      .replace(/[:*?"<>|]/g, '-')
      .replace(/^[.\s-]+|[.\s-]+$/g, '') || 'branch'
  );
}

export interface PlanRow extends BranchCandidate {
  /** Folder of a working copy that already holds this branch. */
  localPath?: string;
  /** Project already owning that working copy, if it is a different one. */
  ownedBy?: string;
  /** Where a missing copy would be checked out to. */
  target: string;
}

/** One list for branches with a working copy on disk and branches still to check out. */
export function planRows(
  candidates: BranchCandidate[],
  store: ProjectStore,
  found: FoundCopy[],
  parentFolder: string,
): PlanRow[] {
  const byUrl = new Map(found.map((f) => [normalizeUrl(f.url), f.path]));
  const parent = parentFolder.replace(/[\\/]+$/, '');
  // The folder comes from a Windows picker; keep its separator in the target
  // so the dialog does not show `C:\Work/search8`.
  const sep = parent.includes('\\') && !parent.includes('/') ? '\\' : '/';
  const used = new Set<string>();
  const row = (c: BranchCandidate): PlanRow => {
    const onDisk = byUrl.get(normalizeUrl(c.url));
    const copy = existingCopy(store, c.url);
    // Two branches with the same leaf name must not share a target folder.
    let folder = targetFolderName(c.name);
    for (let n = 2; used.has(normalizeUrl(folder)); n++)
      folder = `${targetFolderName(c.name)}-${n}`;
    used.add(normalizeUrl(folder));
    return {
      ...c,
      localPath: onDisk ?? copy?.localPath,
      ownedBy: copy?.projectId,
      target: parent ? `${parent}${sep}${folder}` : folder,
    };
  };
  const rows = candidates.map(row);
  // A working copy on disk is a fact: keep it even when `svn list` did not offer it.
  const covered = new Set(rows.map((r) => normalizeUrl(r.url)));
  for (const f of found) {
    if (covered.has(normalizeUrl(f.url))) continue;
    covered.add(normalizeUrl(f.url));
    rows.push(
      row({
        name: leaf(f.url),
        url: f.url,
        kind: guessKindFromUrl(f.url) ?? 'other',
      }),
    );
  }
  return rows;
}
