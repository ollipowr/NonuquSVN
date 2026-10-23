import { t } from '@nonu/app/i18n';
import type { HostAdapter, SnapshotFileInput } from '@nonu/host/types';
import { invalidateWorkspace } from '@nonu/modules/workspace';
import { execSvn, getPanelHost } from '@nonu/stores';

export class SvnError extends Error {
  constructor(
    message: string,
    public readonly stderr: string,
    public readonly code: number,
    /** The command as actually run, with --password already masked. */
    public readonly command?: string,
  ) {
    super(message);
    this.name = 'SvnError';
  }
}

/** Windows caps command lines at ~32k characters: for long path lists, commit the whole working copy instead. */
export const MAX_COMMAND_LENGTH = 30000;

export function commandTooLong(args: string[]): boolean {
  return args.reduce((n, a) => n + a.length + 3, 4) > MAX_COMMAND_LENGTH;
}

/** Always injected so a missing credential fails fast instead of blocking on a password prompt (no TTY). */
const GLOBAL_FLAGS = ['--non-interactive'];

export interface SvnCredentials {
  username: string;
  password: string;
  /** Accept the server certificate for this and future calls when untrusted. */
  trustServerCert?: boolean;
}

export function credentialArgs(credentials?: SvnCredentials): string[] {
  if (!credentials) return [];
  const args = [
    '--username',
    credentials.username,
    '--password',
    credentials.password,
  ];
  // Per-call user decision from the auth dialog, never global.
  if (credentials.trustServerCert)
    args.push('--trust-server-cert-failures=unknown-ca');
  return args;
}

/** Masks a `--password <value>` pair so secrets never reach logs, pills, or copy buttons. */
function maskCommand(args: string[]): string {
  const masked = [...args];
  const i = masked.indexOf('--password');
  if (i !== -1 && i + 1 < masked.length) masked[i + 1] = '***';
  return ['svn', ...masked].join(' ');
}

const SNAPSHOT_COMMANDS = [
  'update',
  'switch',
  'merge',
  'revert',
  'delete',
  'resolve',
];
const SNAPSHOT_CODES = new Set(['M', 'A', 'C', '?', '!']);
const TARGETED_COMMANDS = ['revert', 'delete', 'resolve'];
const VALUE_FLAGS = new Set(['--depth', '--accept', '-r', '--revision']);

/** Paths a command acts on; update, switch and merge snapshot the whole working copy instead. */
function snapshotTargets(args: string[]): string[] {
  if (!TARGETED_COMMANDS.includes(args[0])) return [];
  const targets: string[] = [];
  for (let i = 1; i < args.length; i++) {
    if (VALUE_FLAGS.has(args[i])) i++;
    else if (!args[i].startsWith('-')) targets.push(args[i]);
  }
  return targets;
}

type SnapshotGate = (unreadable: string[]) => Promise<boolean>;

/** Asks the user before a command runs without backing up locked files; the workspace view installs it. */
let snapshotGate: SnapshotGate = async () => false;

export function setSnapshotGate(gate: SnapshotGate) {
  snapshotGate = gate;
}

/** Locked files can be left out only when each one is a named target and another target stays. */
function canSkip(args: string[], unreadable: string[]): boolean {
  const targets = snapshotTargets(args);
  return (
    unreadable.every((p) => targets.includes(p)) &&
    unreadable.length < targets.length
  );
}

/** Stores changed files before a command runs; returns the args to run and the snapshot id. */
async function backUpBeforeCommand(
  host: HostAdapter,
  args: string[],
  cwd: string,
  credentials?: SvnCredentials,
): Promise<{ args: string[]; snapshotId?: string }> {
  const { stdout } = await runSvn(
    ['status', '--depth', 'infinity', ...snapshotTargets(args)],
    cwd,
  );
  const changes = parseSvnStatus(stdout).filter(
    (c) => SNAPSHOT_CODES.has(c.code) && !c.propsOnly,
  );
  const dirs = await findDirectories(
    changes.map((c) => c.path),
    cwd,
    (script, opts) => host.exec(script, opts),
  );
  const files: SnapshotFileInput[] = [];
  const unreadable: string[] = [];
  for (const c of changes) {
    if (dirs.has(c.path)) continue;
    const content =
      c.code === '!'
        ? null
        : await host.readFileBase64(`${cwd}/${c.path}`).catch(() => undefined);
    if (content === undefined) {
      unreadable.push(c.path);
      continue;
    }
    files.push({ path: c.path, statusBefore: c.code, content });
  }
  let runArgs = args;
  if (unreadable.length > 0) {
    if (!canSkip(args, unreadable) || !(await snapshotGate(unreadable)))
      throw new Error(
        (t('snapshotUnreadable') as (p: string) => string)(
          unreadable.join(', '),
        ),
      );
    runArgs = args.filter((a) => !unreadable.includes(a));
  }
  const command = maskCommand([
    ...runArgs,
    ...credentialArgs(credentials),
    ...GLOBAL_FLAGS,
  ]);
  const record = await host.snapshot?.({ command, workingCopy: cwd }, files);
  return { args: runArgs, snapshotId: record?.id };
}

export async function runSvn(
  args: string[],
  cwd: string,
  credentials?: SvnCredentials,
): Promise<{ stdout: string; stderr: string; snapshotId?: string }> {
  let displayCommand = maskCommand([
    ...args,
    ...credentialArgs(credentials),
    ...GLOBAL_FLAGS,
  ]);
  try {
    const host = getPanelHost();
    const backup =
      host?.snapshot &&
      SNAPSHOT_COMMANDS.includes(args[0]) &&
      !args.includes('--dry-run')
        ? await backUpBeforeCommand(host, args, cwd, credentials)
        : undefined;
    const runArgs = backup?.args ?? args;
    const fullArgs = [
      ...runArgs,
      ...credentialArgs(credentials),
      ...GLOBAL_FLAGS,
    ];
    displayCommand = maskCommand(fullArgs);
    const result = host?.execSvnArgs
      ? await host.execSvnArgs(fullArgs, { cwd, timeout: 60000 })
      : await execSvn(fullArgs, cwd);
    if (result.exitCode !== 0) {
      throw new SvnError(
        result.stderr.trim() ||
          `svn ${args[0]} failed (exit ${result.exitCode})`,
        result.stderr,
        result.exitCode,
        displayCommand,
      );
    }
    return {
      stdout: result.stdout,
      stderr: result.stderr,
      snapshotId: backup?.snapshotId,
    };
  } catch (err) {
    if (err instanceof SvnError) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    throw new SvnError(msg, '', 1, displayCommand);
  } finally {
    // Even a failed mutation can have changed part of the working copy.
    if (
      [
        'update',
        'merge',
        'commit',
        'switch',
        'add',
        'revert',
        'delete',
        'resolve',
        'propset',
        'lock',
        'unlock',
      ].includes(args[0]) &&
      !args.includes('--dry-run')
    ) {
      invalidateWorkspace(
        cwd,
        args.filter((arg) => /^(https?:\/\/|svn(?:\+ssh)?:|file:)/.test(arg)),
      );
    }
  }
}

/** Returns a file's BASE content, what `svn diff` compares the working copy against. */
export async function svnCat(
  path: string,
  cwd: string,
  credentials?: SvnCredentials,
): Promise<string> {
  const { stdout } = await runSvn(
    ['cat', '-r', 'BASE', path],
    cwd,
    credentials,
  );
  return stdout;
}

/** Locks paths (`svn lock`). `force: true` adds `--force` to break a lock held by someone else. */
export async function lockFiles(
  paths: string[],
  cwd: string,
  credentials?: SvnCredentials,
  options?: { force?: boolean },
): Promise<string> {
  const { stdout } = await runSvn(
    ['lock', ...(options?.force ? ['--force'] : []), ...paths],
    cwd,
    credentials,
  );
  return stdout;
}

/** Releases locks held by the current user on the given paths (`svn unlock`). */
export async function unlockFiles(
  paths: string[],
  cwd: string,
  credentials?: SvnCredentials,
): Promise<string> {
  const { stdout } = await runSvn(['unlock', ...paths], cwd, credentials);
  return stdout;
}

export interface SvnLockInfo {
  owner: string;
  created?: string;
  comment?: string;
}

/** Lock info for `path` via `svn info`. A server round trip, so call on demand only. Undefined when unlocked. */
export async function getLockInfo(
  path: string,
  cwd: string,
  credentials?: SvnCredentials,
): Promise<SvnLockInfo | undefined> {
  const { stdout } = await runSvn(['info', path], cwd, credentials);
  const owner = matchInfo(stdout, 'Lock Owner');
  if (!owner) return undefined;
  return {
    owner,
    created: matchInfo(stdout, 'Lock Created'),
    comment: matchInfo(stdout, 'Lock Comment'),
  };
}

// E170013 is ambiguous (bad credentials or network): treated as an auth candidate, and the dialog copy must mention network issues too.
const AUTH_REQUIRED =
  /E170013|E215004|E170001|authorization failed|authentication failed|Could not authenticate/i;

// Real connectivity failures; these win over the ambiguous auth match above.
const CONNECTION_FAILED =
  /E730061|Connection refused|Could not resolve host|Network is unreachable|Connection timed out|Operation timed out/i;

export function isConnectionError(err: SvnError): boolean {
  return CONNECTION_FAILED.test(`${err.message}\n${err.stderr}`);
}

export function isAuthError(err: SvnError): boolean {
  if (isConnectionError(err)) return false;
  return AUTH_REQUIRED.test(`${err.message}\n${err.stderr}`);
}

export interface SvnRepoInfo {
  isWorkingCopy: boolean;
  url?: string;
  root?: string;
  /** Repository URL represented by `root` (which can differ from `url` when cwd is a subfolder). */
  workingCopyUrl?: string;
  repositoryRoot?: string;
  revision?: string;
  lastChangedRev?: string;
  /** Set when svn itself is missing, as opposed to "not a working copy". */
  svnMissing?: boolean;
  reason?: string;
}

const NOT_A_WC = /is not a working copy|was not found|E155007|E155010/i;
const SVN_MISSING =
  /not recognized as an internal or external command|command not found|ENOENT|No such file or directory/i;

/** Whether `cwd` is inside a working copy. `svn info` works anywhere in a checkout and fails distinctly when svn is missing. */
export async function detectSvnRepo(
  cwd: string,
  credentials?: SvnCredentials,
): Promise<SvnRepoInfo> {
  try {
    const { stdout } = await runSvn(['info'], cwd, credentials);
    const url = matchInfo(stdout, 'URL');
    const root = matchInfo(stdout, 'Working Copy Root Path');
    let workingCopyUrl = url;
    if (
      root &&
      root.replace(/[\\/]+$/, '').toLocaleLowerCase() !==
        cwd.replace(/[\\/]+$/, '').toLocaleLowerCase()
    ) {
      const rootInfo = await runSvn(['info', root], cwd, credentials);
      workingCopyUrl = matchInfo(rootInfo.stdout, 'URL') ?? url;
    }
    return {
      isWorkingCopy: true,
      url,
      root,
      workingCopyUrl,
      repositoryRoot: matchInfo(stdout, 'Repository Root'),
      revision: matchInfo(stdout, 'Revision'),
      lastChangedRev: matchInfo(stdout, 'Last Changed Rev'),
    };
  } catch (err) {
    const e = err as SvnError;
    const haystack = `${e.message}\n${e.stderr}`;
    if (SVN_MISSING.test(haystack)) {
      // ENOENT is also raised when the cwd itself does not exist. Check that
      // first so a bad folder is not reported as a missing svn installation.
      if ((await cwdExists(cwd)) === false) {
        return {
          isWorkingCopy: false,
          reason: t('cwdMissing')(cwd),
        };
      }
      return {
        isWorkingCopy: false,
        svnMissing: true,
        reason: t('svnNotFoundReason'),
      };
    }
    if (NOT_A_WC.test(haystack)) {
      return {
        isWorkingCopy: false,
        reason: t('notWorkingCopyReason'),
      };
    }
    return { isWorkingCopy: false, reason: e.message };
  }
}

/** Whether the working copy is behind HEAD. Compares against HEAD, not Last Changed Rev (false positives on trunk). Undefined when unknown. */
export async function hasRemoteChanges(
  cwd: string,
  local: SvnRepoInfo,
  credentials?: SvnCredentials,
): Promise<boolean | undefined> {
  if (!local.revision) return undefined;
  try {
    const { stdout } = await runSvn(['info', '-r', 'HEAD'], cwd, credentials);
    const remoteRev = matchInfo(stdout, 'Revision');
    if (!remoteRev) return undefined;
    return Number(remoteRev) > Number(local.revision);
  } catch {
    return undefined;
  }
}

/** Probes whether `cwd` exists via the host. Undefined when the probe cannot run. */
async function cwdExists(cwd: string): Promise<boolean | undefined> {
  const host = getPanelHost();
  if (!host) return undefined;
  try {
    const probe = await host.exec(
      `powershell -NoProfile -Command "Test-Path -LiteralPath ${JSON.stringify(cwd)} -PathType Container"`,
      { cwd: host.workspacePath, timeout: 5000 },
    );
    return probe.stdout.trim().toLowerCase() === 'true';
  } catch {
    return undefined;
  }
}

function matchInfo(stdout: string, field: string): string | undefined {
  const m = stdout.match(new RegExp(`^${field}:\\s*(.+)$`, 'm'));
  return m ? m[1].trim() : undefined;
}

/** Throws with a friendly message when `cwd` cannot be used for SVN commands. */
export async function checkSvnAvailable(cwd: string): Promise<void> {
  const info = await detectSvnRepo(cwd);
  if (!info.isWorkingCopy) {
    throw new SvnError(info.reason ?? t('notWorkingCopyReason'), '', 1);
  }
}

export type SvnChangeStatus =
  | 'modified'
  | 'added'
  | 'deleted'
  | 'unversioned'
  | 'missing'
  | 'conflicted'
  | 'replaced'
  | 'ignored'
  | 'external'
  | 'unknown';

export interface SvnChange {
  path: string;
  status: SvnChangeStatus;
  /** Raw single-letter code from `svn status`. */
  code: string;
  committable: boolean;
  /** True when `svn status` reports a tree conflict (column 7 is `C`). */
  treeConflict?: boolean;
  /** Locked by the current user (column 6 is `K`). Locks held by others need a server round trip and are not surfaced. */
  lockedByMe?: boolean;
  /** Only properties changed (column 2 `M`); there is no file content to edit. */
  propsOnly?: boolean;
  /** Resolved URL of an `svn:externals` entry; undefined when not an external or the lookup failed. */
  externalTarget?: string;
}

const CODE_MAP: Record<string, SvnChangeStatus> = {
  M: 'modified',
  A: 'added',
  D: 'deleted',
  '?': 'unversioned',
  '!': 'missing',
  C: 'conflicted',
  R: 'replaced',
  I: 'ignored',
  X: 'external',
};

/** Status letter for the column. Expanded folders carry the internal code 'D', which must not show as SVN "deleted". */
export function displayCode(c: SvnChange): string {
  if (c.code !== 'D' || c.status === 'deleted') return c.code;
  return Object.keys(CODE_MAP).find((k) => CODE_MAP[k] === c.status) ?? c.code;
}

/** Parses `svn status` lines. Tree conflicts (column 7 `C`) become `conflicted`; externals (`X`) are dropped; ignored entries only with `includeIgnored`. */
export function parseSvnStatus(
  stdout: string,
  includeIgnored = false,
): SvnChange[] {
  const changes: SvnChange[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) continue;
    // Skip header/info lines that are not file status entries.
    if (line.startsWith('---') || line.startsWith('Status against revision'))
      continue;
    if (line.startsWith('Performing status on external item')) continue;
    // Column 2 `M` alone is a property change (e.g. svn:mergeinfo on a merged folder); it must commit with its folder.
    const propsOnly = line[0] === ' ' && line[1] === 'M';
    const code = propsOnly ? 'M' : line[0];
    const treeConflict = line[6] === 'C';
    // Column 6 is the lock marker: `K` means locked by the current user.
    const lockedByMe = line[5] === 'K';
    const status: SvnChangeStatus = treeConflict
      ? 'conflicted'
      : (CODE_MAP[code] ?? 'unknown');
    // Anything without a known status code (info text, externals notices) is not a file entry.
    if (status === 'unknown') continue;
    if (status === 'ignored' && !includeIgnored) continue;
    if (status === 'external') continue;
    const path = line.slice(8).trim();
    if (!path) continue;
    changes.push({
      path,
      status,
      code,
      committable:
        status !== 'unversioned' &&
        status !== 'missing' &&
        status !== 'conflicted' &&
        status !== 'ignored',
      ...(treeConflict ? { treeConflict: true } : {}),
      ...(lockedByMe ? { lockedByMe: true } : {}),
      ...(propsOnly ? { propsOnly: true } : {}),
    });
  }
  return changes;
}

/** Does this token look like a URL (as opposed to a local target name)? */
function looksLikeUrl(token: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(token) || /^\^\//.test(token);
}

/** URL for the external `localName` in an svn:externals value. Handles both the new (`local URL`) and old (`URL local`) syntax. */
export function parseExternalsProperty(
  propertyValue: string,
  localName: string,
): string | undefined {
  for (const rawLine of propertyValue.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const tokens = line.split(/\s+/).filter(Boolean);
    if (tokens.length < 2) continue;

    if (looksLikeUrl(tokens[tokens.length - 1])) {
      // Old syntax: URL local-name
      const name = tokens[tokens.length - 1];
      const url = tokens[0];
      if (name === localName) return url;
    } else {
      // New syntax: local-name [-r REV] URL  (URL is whichever token looks like one)
      const urlToken = tokens.find((t) => looksLikeUrl(t));
      if (!urlToken) continue;
      // The local name is the first token that is neither the URL nor a peg-revision flag.
      let name: string | undefined;
      for (let i = 0; i < tokens.length; i++) {
        const tok = tokens[i];
        if (tok === urlToken) continue;
        if (tok === '-r' || /^-r\d+$/.test(tok)) {
          if (tok === '-r') i++;
          continue;
        }
        name = tok;
        break;
      }
      if (name === localName) return urlToken;
    }
  }
  return undefined;
}

/** Resolves the URL of external `localName` from the svn:externals property of `parentDir`. Never throws; undefined when missing. */
export async function getSvnExternalsTarget(
  parentDir: string,
  localName: string,
  cwd: string,
  credentials?: SvnCredentials,
): Promise<string | undefined> {
  try {
    const { stdout } = await runSvn(
      ['propget', 'svn:externals', parentDir],
      cwd,
      credentials,
    );
    return parseExternalsProperty(stdout, localName);
  } catch {
    return undefined;
  }
}

type ExecFn = (
  command: string,
  options: { cwd: string; timeout: number },
) => Promise<{ stdout: string; stderr: string; exitCode: number }>;

/** Wraps a script as -EncodedCommand (UTF-16LE base64) so no quoting can break it. */
function powershellCommand(script: string): string {
  let bin = '';
  for (let i = 0; i < script.length; i++) {
    const c = script.charCodeAt(i);
    bin += String.fromCharCode(c & 0xff, c >> 8);
  }
  return `powershell -NoProfile -NonInteractive -EncodedCommand ${btoa(bin)}`;
}

const psq = (s: string) => `'${s.replace(/'/g, "''")}'`;
/** Paths per PowerShell process: keeps the encoded command line well under the Windows limit. */
const BATCH = 40;

/** Returns which of `paths` (relative to `cwd`) are directories, using a single PowerShell process per batch. */
export async function findDirectories(
  paths: string[],
  cwd: string,
  exec: ExecFn,
): Promise<Set<string>> {
  const dirs = new Set<string>();
  const batches: string[][] = [];
  for (let i = 0; i < paths.length; i += BATCH)
    batches.push(paths.slice(i, i + BATCH));
  await Promise.all(
    batches.map(async (b) => {
      const script = `foreach($p in @(${b.map(psq).join(',')})){ if(Test-Path -LiteralPath $p -PathType Container){ $p } }`;
      try {
        const r = await exec(powershellCommand(script), {
          cwd,
          timeout: 20000,
        });
        if (r.exitCode === 0)
          for (const l of r.stdout.split(/\r?\n/))
            if (l.trim()) dirs.add(l.trim());
      } catch {
        // Treat a failed batch as "no directories".
      }
    }),
  );
  return dirs;
}

export interface SvnLogEntry {
  revision: string;
  author: string;
  date: string;
  message: string;
  paths?: SvnLogPath[];
}

export interface SvnLogPath {
  action: string;
  path: string;
  copyFromPath?: string;
  copyFromRev?: string;
}

/** Parses `svn log --xml` output into structured entries. */
export function parseSvnLog(xml: string): SvnLogEntry[] {
  const entries: SvnLogEntry[] = [];
  const re = /<logentry\s+revision="(\d+)"[^>]*>([\s\S]*?)<\/logentry>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const body = m[2];
    const paths: SvnLogPath[] = [];
    const pathRe = /<path\b([^>]*)>([\s\S]*?)<\/path>/g;
    let pathMatch: RegExpExecArray | null;
    while ((pathMatch = pathRe.exec(body))) {
      const attrs = pathMatch[1];
      paths.push({
        action: /action="([^"]*)"/.exec(attrs)?.[1] ?? 'M',
        path: xmlUnescape(pathMatch[2].trim()),
        copyFromPath: /copyfrom-path="([^"]*)"/.exec(attrs)?.[1],
        copyFromRev: /copyfrom-rev="([^"]*)"/.exec(attrs)?.[1],
      });
    }
    entries.push({
      revision: m[1],
      author: xmlTag(body, 'author') ?? '',
      date: xmlTag(body, 'date') ?? '',
      message: xmlTag(body, 'msg') ?? '',
      paths,
    });
  }
  return entries;
}

export interface SvnBlameLine {
  line: number;
  revision: string;
  author: string;
  date: string;
  text: string;
}

/** Parses `svn blame --xml` and joins it with the file's text from `svn cat`. */
export function parseSvnBlame(xml: string, fileText: string): SvnBlameLine[] {
  const entries: {
    line: number;
    revision: string;
    author: string;
    date: string;
  }[] = [];
  const re = /<entry\s+line-number="(\d+)">([\s\S]*?)<\/entry>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const body = m[2];
    const commit = /<commit\s+revision="(\d+)">([\s\S]*?)<\/commit>/.exec(body);
    entries.push({
      line: Number(m[1]),
      revision: commit?.[1] ?? '',
      author: (commit && xmlTag(commit[2], 'author')) ?? '',
      date: (commit && xmlTag(commit[2], 'date')) ?? '',
    });
  }
  const textLines = fileText.split(/\r?\n/);
  return entries.map((e) => ({ ...e, text: textLines[e.line - 1] ?? '' }));
}

export interface SvnProperty {
  name: string;
  value: string;
}

/** Parses `svn proplist --verbose --xml` into name/value pairs. */
export function parseSvnProplist(xml: string): SvnProperty[] {
  const target = /<target\b[^>]*>([\s\S]*?)<\/target>/.exec(xml);
  const body = target ? target[1] : xml;
  const props: SvnProperty[] = [];
  const re = /<property\s+name="([^"]*)"\s*(?:\/>|>([\s\S]*?)<\/property>)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    props.push({
      name: xmlUnescape(m[1]),
      value: m[2] !== undefined ? xmlUnescape(m[2]) : '',
    });
  }
  return props;
}

function xmlTag(xml: string, tag: string): string | undefined {
  const m = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`).exec(xml);
  return m ? xmlUnescape(m[1]) : undefined;
}

function xmlUnescape(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}
