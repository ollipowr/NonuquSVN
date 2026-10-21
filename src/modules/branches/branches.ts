import type { HostStorage } from '@nonu/host/types';
import {
  checkWorkspaceRemote,
  loadWorkspaceStatus,
  mergeinfo,
  remoteBranchStatuses,
} from '@nonu/modules/workspace';

export type BranchKind = 'trunk' | 'branch' | 'tag' | 'other';

export interface BranchEntry {
  id: string;
  name: string;
  /** Repository URL of the branch (required). */
  url: string;
  /** Own folder; empty means the branch is only known remotely. */
  localPath?: string;
  /** Seeds the default merge direction. */
  kind: BranchKind;
  /** Stable project prefix, e.g. https://host/svn/app for app/trunk. */
  group?: string;
}

export interface BranchRegistry {
  entries: BranchEntry[];
  /** Optional search roots for auto-detection. */
  roots: string[];
}

// Registry v2 starts clean: the old global registry mixed unrelated projects and is no longer read.
const REGISTRY_KEY = 'svn.branches.v2';

export const EMPTY_REGISTRY: BranchRegistry = { entries: [], roots: [] };

export function branchGroupKey(url: string): string {
  const clean = url.replace(/\\/g, '/').replace(/\/+$/, '');
  const parts = clean.split('/');
  const marker = parts.findIndex((part) =>
    ['trunk', 'branches', 'tags'].includes(part.toLowerCase()),
  );
  return marker >= 0
    ? parts.slice(0, marker).join('/').toLowerCase()
    : clean.toLowerCase();
}

function legacyRegistryKey(cwd: string): string {
  return `${REGISTRY_KEY}:${cwd.replace(/\\/g, '/')}`;
}

export function loadRegistry(storage: HostStorage, cwd = ''): BranchRegistry {
  // Branches belong to a repository family, not the open working copy: one shared registry.
  const shared = storage.getGlobal<Partial<BranchRegistry>>(REGISTRY_KEY);
  const legacy = storage.get<Partial<BranchRegistry>>(legacyRegistryKey(cwd));
  const raw = shared ?? legacy;
  if (!raw) return { ...EMPTY_REGISTRY };
  const entries = [
    ...(Array.isArray(shared?.entries) ? shared.entries : []),
    ...(Array.isArray(legacy?.entries) ? legacy.entries : []),
  ];
  const deduped = new Map<string, BranchEntry>();
  for (const entry of entries) {
    if (entry && entry.url) {
      const normalizedUrl = entry.url.replace(/\/+$/, '').toLowerCase();
      deduped.set(normalizedUrl, {
        ...entry,
        group: entry.group ?? branchGroupKey(entry.url),
      });
    }
  }
  return {
    entries: [...deduped.values()],
    roots: Array.isArray(raw.roots) ? raw.roots : [],
  };
}

export function saveRegistry(
  storage: HostStorage,
  cwd: string,
  registry: BranchRegistry,
): Promise<void> {
  void cwd;
  return storage.setGlobal(REGISTRY_KEY, registry);
}

export function newBranchId(): string {
  return `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

/** Several entries sharing a `localPath` mean one working copy with `svn switch`; only then does "Switch" make sense. */
export function isSwitchModel(
  registry: BranchRegistry,
  entry: BranchEntry,
): boolean {
  if (!entry.localPath) return false;
  const target = normalizePath(entry.localPath);
  return (
    registry.entries.filter(
      (e) => e.localPath && normalizePath(e.localPath) === target,
    ).length > 1
  );
}

export function normalizePath(p: string): string {
  return p
    .replace(/[\\/]+$/, '')
    .replace(/\\/g, '/')
    .toLowerCase();
}

/** `svn --version --quiet` prints just `1.14.3`; the long form starts `svn, version 1.14.3 (r…)`. */
export function parseSvnVersion(
  stdout: string,
): { version: string; major: number; minor: number } | null {
  const m = stdout.match(/(\d+)\.(\d+)\.(\d+)/);
  if (!m) return null;
  return { version: m[0], major: Number(m[1]), minor: Number(m[2]) };
}

/** Merge tracking and `svn mergeinfo --show-revs` need 1.8 or newer. */
export function supportsMergeTracking(
  v: { major: number; minor: number } | null,
): boolean {
  if (!v) return false;
  return v.major > 1 || (v.major === 1 && v.minor >= 8);
}

/** Parses `svn mergeinfo --show-revs=eligible`: one revision per line (`r5`), ranges like `r5-7` expanded. */
export function parseEligibleRevs(stdout: string): number[] {
  const revs = new Set<number>();
  for (const line of stdout.split(/\r?\n/)) {
    const s = line.trim();
    if (!s) continue;
    const range = s.match(/^r?(\d+)\s*-\s*r?(\d+)$/);
    if (range) {
      const from = Number(range[1]);
      const to = Number(range[2]);
      for (let r = Math.min(from, to); r <= Math.max(from, to); r++)
        revs.add(r);
      continue;
    }
    const single = s.match(/^r?(\d+)$/);
    if (single) revs.add(Number(single[1]));
  }
  return [...revs].sort((a, b) => a - b);
}

export interface LogRevisionPath {
  action: string;
  path: string;
  copyFromPath?: string;
}

export interface LogRevision {
  rev: number;
  author: string;
  /** Raw ISO-8601 from svn, e.g. `2026-10-06T21:58:44.400260Z`. */
  date: string;
  message: string;
  paths?: LogRevisionPath[];
}

/** Parses `svn log --xml`: the plain-text form renders dates in the OS locale and cannot be parsed reliably. */
export function parseLogXml(xml: string): LogRevision[] {
  const out: LogRevision[] = [];
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  for (const el of Array.from(doc.getElementsByTagName('logentry'))) {
    const rev = Number(el.getAttribute('revision'));
    if (!Number.isFinite(rev) || rev <= 0) continue;
    const pathEls = Array.from(el.getElementsByTagName('path'));
    const paths: LogRevisionPath[] = pathEls.map((p) => ({
      action: p.getAttribute('action') ?? 'M',
      path: p.textContent?.trim() ?? '',
      copyFromPath: p.getAttribute('copyfrom-path') ?? undefined,
    }));
    out.push({
      rev,
      author: el.getElementsByTagName('author')[0]?.textContent?.trim() ?? '',
      date: el.getElementsByTagName('date')[0]?.textContent?.trim() ?? '',
      message: el.getElementsByTagName('msg')[0]?.textContent?.trim() ?? '',
      paths: paths.length > 0 ? paths : undefined,
    });
  }
  return out.sort((a, b) => b.rev - a.rev);
}

export interface MergeResult {
  /** Paths touched, with the SVN action letter (`U`, `A`, `D`, `C`, `G`, …). */
  files: { path: string; action: string }[];
  /** Total conflicts reported in the `Summary of conflicts:` block. */
  conflicts: number;
  /** Revisions SVN said it merged, from the `--- Merging rN into` headers. */
  mergedRevs: number[];
}

/** Compacts sorted merge revisions into SVN-style comma-separated ranges. */
export function formatRevisionRanges(revisions: number[]): string {
  const sorted = [...new Set(revisions)].sort((a, b) => a - b);
  const ranges: string[] = [];
  for (let index = 0; index < sorted.length; ) {
    const start = sorted[index];
    let end = start;
    while (index + 1 < sorted.length && sorted[index + 1] === end + 1) {
      end = sorted[++index];
    }
    ranges.push(start === end ? String(start) : `${start}-${end}`);
    index++;
  }
  return ranges.join(', ');
}

/** Builds the commit text placed into the Changes view after a successful merge. */
export function formatMergeCommitMessage(
  revisions: number[],
  sourceName: string,
  entries: LogRevision[],
): string {
  const messagesByRevision = new Map(
    entries.map((entry) => [entry.rev, entry.message.trim()]),
  );
  const messages = [...new Set(revisions)]
    .sort((a, b) => a - b)
    .map((revision) => messagesByRevision.get(revision))
    .filter((message): message is string => !!message);
  const header = `Merged revision(s) ${formatRevisionRanges(revisions)} from ${sourceName}:`;
  return messages.length
    ? `${header}\n${messages.map((message) => `${message}\n........`).join('\n')}`
    : header;
}

/** Never infer success from the exit code: a merge with conflicts exits 0. Mergeinfo bookkeeping lines are dropped. */
export function parseMergeResult(stdout: string): MergeResult {
  const files: { path: string; action: string }[] = [];
  const mergedRevs: number[] = [];
  let conflicts = 0;
  let inRecording = false;

  for (const line of stdout.split(/\r?\n/)) {
    const header = line.match(
      /^---\s+(Merging|Recording mergeinfo for merge of)\s+r?(\d+)/,
    );
    if (header) {
      inRecording = header[1] !== 'Merging';
      if (!inRecording) mergedRevs.push(Number(header[2]));
      continue;
    }
    if (line.startsWith('---')) {
      inRecording = /Recording mergeinfo/.test(line);
      continue;
    }
    const summary = line.match(
      /^\s+(?:Text|Tree|Property)\s+conflicts:\s*(\d+)/,
    );
    if (summary) {
      conflicts += Number(summary[1]);
      continue;
    }
    if (/^Summary of conflicts:/.test(line)) continue;
    // Status lines are `<action><4 spaces><path>`, e.g. `C    a.txt`.
    const entry = line.match(/^([ ADUCGER])\s{2,}(\S.*)$/);
    if (entry && !inRecording) {
      const action = entry[1].trim();
      if (action) files.push({ action, path: entry[2].trim() });
    }
  }
  return { files, conflicts, mergedRevs };
}

/** `svn ls <url>` prints one entry per line; directories end with `/`. */
export function parseLsEntries(stdout: string): string[] {
  return stdout
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.endsWith('/'))
    .map((l) => l.replace(/\/$/, ''));
}

/** Seeds the merge direction from a name. Anything unrecognised becomes 'other' so the user can change it. */
export function guessKind(name: string): BranchKind {
  const n = name.toLowerCase();
  if (n === 'trunk' || n === 'master' || n === 'main') return 'trunk';
  if (n === 'tags' || n.startsWith('tags/')) return 'tag';
  if (n === 'branches' || n.startsWith('branches/')) return 'branch';
  return 'other';
}

/** Seeds the kind from a URL, matching `branches/x` and `tags/x` on the last two segments. Undefined for an empty URL. */
export function guessKindFromUrl(url: string): BranchKind | undefined {
  const parts = url.trim().replace(/\/+$/, '').split('/');
  const last = parts[parts.length - 1] ?? '';
  if (!last) return undefined;
  const pair = guessKind(parts.slice(-2).join('/'));
  if (pair === 'branch' || pair === 'tag') return pair;
  return guessKind(last);
}

import { runSvn, type SvnCredentials } from '@nonu/svn';

export interface BranchStatus {
  /** Working-copy revision, or the repository revision for remote-only entries. */
  revision?: string;
  /** Local modifications in this branch's working copy. */
  localChanges: number;
  /** Eligible revisions waiting to come in from the comparison branch. */
  behind?: number;
  /** Eligible revisions waiting to go out to the comparison branch. */
  ahead?: number;
  /** Whether the repository has a newer revision for this working copy. */
  updateAvailable?: boolean;
  error?: string;
  fetchedAt: number;
}

export async function readSvnVersion(cwd: string) {
  const { stdout } = await runSvn(['--version', '--quiet'], cwd);
  return parseSvnVersion(stdout);
}

/** One overview row: revision and local change count. */
export async function fetchBranchStatus(
  entry: BranchEntry,
  cwd: string,
  credentials?: SvnCredentials,
  force = false,
): Promise<BranchStatus> {
  if (!entry.localPath) {
    return remoteBranchStatuses.load(
      entry.url.replace(/\/+$/, ''),
      async () => {
        const { stdout } = await runSvn(['info', entry.url], cwd, credentials);
        return {
          localChanges: 0,
          fetchedAt: Date.now(),
          revision: stdout.match(/^Revision:\s*(\d+)$/m)?.[1],
        };
      },
      force,
    );
  }
  const status = await loadWorkspaceStatus(entry.localPath, force, credentials);
  if (!status.repo.isWorkingCopy)
    throw new Error(status.repo.reason ?? 'Not a working copy');
  const updateAvailable = await checkWorkspaceRemote(
    entry.localPath,
    status.repo,
    force,
    credentials,
  );
  return {
    revision: status.revision,
    localChanges: status.changes.filter(
      (change) =>
        change.status !== 'unversioned' &&
        change.status !== 'ignored' &&
        change.status !== 'external',
    ).length,
    fetchedAt: status.fetchedAt,
    updateAvailable,
  };
}

/** Revisions on `sourceUrl` not yet merged into `targetUrl`. */
export async function fetchEligible(
  sourceUrl: string,
  targetUrl: string,
  cwd: string,
  credentials?: SvnCredentials,
): Promise<number[]> {
  // `=` is mandatory here; `--show-revs eligible` is rejected by the CLI.
  return mergeinfo.load(
    JSON.stringify([
      sourceUrl.replace(/\/+$/, ''),
      targetUrl.replace(/\/+$/, ''),
      'eligible',
    ]),
    async () => {
      const { stdout } = await runSvn(
        ['mergeinfo', '--show-revs=eligible', sourceUrl, targetUrl],
        cwd,
        credentials,
      );
      return parseEligibleRevs(stdout);
    },
  );
}

/** Revisions on `sourceUrl` already recorded as merged into `targetUrl`. */
export async function fetchMerged(
  sourceUrl: string,
  targetUrl: string,
  cwd: string,
  credentials?: SvnCredentials,
): Promise<number[]> {
  return mergeinfo.load(
    JSON.stringify([
      sourceUrl.replace(/\/+$/, ''),
      targetUrl.replace(/\/+$/, ''),
      'merged',
    ]),
    async () => {
      const { stdout } = await runSvn(
        ['mergeinfo', '--show-revs=merged', sourceUrl, targetUrl],
        cwd,
        credentials,
      );
      return parseEligibleRevs(stdout);
    },
  );
}

/** Log entries for exactly `revs`, so the picker can show author, date and message. */
export async function fetchRevisionLog(
  sourceUrl: string,
  revs: number[],
  cwd: string,
  credentials?: SvnCredentials,
): Promise<LogRevision[]> {
  if (revs.length === 0) return [];
  const lo = Math.min(...revs);
  const hi = Math.max(...revs);
  const wanted = new Set(revs);
  try {
    const { stdout } = await runSvn(
      ['log', '--xml', '--verbose', '-r', `${lo}:${hi}`, sourceUrl],
      cwd,
      credentials,
    );
    return parseLogXml(stdout).filter((e) => wanted.has(e.rev));
  } catch (err) {
    // --verbose output can exceed the buffer on large repos; fall back without paths.
    if (err instanceof Error && err.message.includes('maxBuffer')) {
      const { stdout } = await runSvn(
        ['log', '--xml', '-r', `${lo}:${hi}`, sourceUrl],
        cwd,
        credentials,
      );
      return parseLogXml(stdout).filter((e) => wanted.has(e.rev));
    }
    throw err;
  }
}

export async function updateBranch(
  entry: BranchEntry,
  credentials?: SvnCredentials,
): Promise<string> {
  if (!entry.localPath) throw new Error(`"${entry.name}" has no local folder.`);
  const { stdout } = await runSvn(
    ['update', entry.localPath],
    entry.localPath,
    credentials,
  );
  return stdout.trim();
}

/** Merges exactly `revs` as individual changes (`-c 101,103,107`). `--dry-run` produces the preview; never committed. */
export async function mergeRevisions(opts: {
  sourceUrl: string;
  targetPath: string;
  revs: number[];
  dryRun: boolean;
  credentials?: SvnCredentials;
}): Promise<MergeResult> {
  const args = ['merge'];
  if (opts.dryRun) args.push('--dry-run');
  args.push('-c', opts.revs.join(','), opts.sourceUrl, opts.targetPath);
  const { stdout } = await runSvn(args, opts.targetPath, opts.credentials);
  return parseMergeResult(stdout);
}

export async function switchBranch(
  entry: BranchEntry,
  credentials?: SvnCredentials,
): Promise<string> {
  if (!entry.localPath) throw new Error(`"${entry.name}" has no local folder.`);
  const { stdout } = await runSvn(
    ['switch', entry.url, entry.localPath],
    entry.localPath,
    credentials,
  );
  return stdout.trim();
}

export async function listRepoChildren(
  url: string,
  cwd: string,
  credentials?: SvnCredentials,
): Promise<string[]> {
  const { stdout } = await runSvn(['ls', url], cwd, credentials);
  return parseLsEntries(stdout);
}

/** Read-only diff between two branch URLs, for the comparison view. */
export async function diffBranches(
  urlA: string,
  urlB: string,
  cwd: string,
  credentials?: SvnCredentials,
): Promise<string> {
  const { stdout } = await runSvn(
    ['diff', '--old', urlA, '--new', urlB],
    cwd,
    credentials,
  );
  return stdout;
}
