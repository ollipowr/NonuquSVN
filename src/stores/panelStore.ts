import { t } from '@nonu/app/i18n';
import type { HostAdapter } from '@nonu/host/types';

/** Keeps the last host adapter after unmount so `exec` keeps working while the panel is closed. */
let _host: HostAdapter | null = null;

export function setPanelHost(host: HostAdapter) {
  _host = host;
}

export function clearPanelHost() {
  // Intentionally a no-op for the exec path: see note above. The panel calls
  // this on unmount, but dropping the host here would break exec.
}

export function getPanelHost(): HostAdapter | null {
  return _host;
}

/**
 * Quotes one argument for cmd.exe: CreateProcess quoting, then `^` escapes for cmd's own specials.
 * Not JSON.stringify: cmd.exe misreads its backslash-escaped quotes, so a `"` in a password could inject `&` commands.
 */
function quoteCmdArg(arg: string): string {
  // CreateProcessW-style quoting: double trailing/pre-quote backslashes, escape quotes.
  let result = '"';
  let backslashes = 0;
  for (const ch of arg) {
    if (ch === '\\') {
      backslashes++;
      result += ch;
    } else if (ch === '"') {
      // Escape all pending backslashes plus the quote itself.
      result += '\\'.repeat(backslashes) + '\\"';
      backslashes = 0;
    } else {
      backslashes = 0;
      result += ch;
    }
  }
  // Trailing backslashes right before the closing quote must be doubled too.
  result += '\\'.repeat(backslashes) + '"';

  // cmd.exe-special characters inside the quotes still need neutralizing with `^`.
  return result.replace(/[&|<>^%\r\n]/g, (c) => '^' + c);
}

export async function execSvn(
  args: string[],
  cwd: string,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  if (!_host) {
    throw new Error(t('svnNotReady'));
  }
  const command = ['svn', ...args.map(quoteCmdArg)].join(' ');
  return _host.exec(command, { cwd, timeout: 60000 });
}

export { quoteCmdArg };

/** Reads a file's raw content for unversioned files, which `svn diff` and `svn cat` reject. */
export async function readFileRaw(path: string, cwd: string): Promise<string> {
  if (!_host) {
    throw new Error(t('svnNotReady'));
  }
  // Check if it's a directory first (fail gracefully for folders)
  const checkCmd = `powershell -NoProfile -Command "Test-Path -LiteralPath ${JSON.stringify(path)} -PathType Container"`;
  const checkResult = await _host.exec(checkCmd, { cwd, timeout: 5000 });
  if (
    checkResult.exitCode === 0 &&
    checkResult.stdout.trim().toLowerCase() === 'true'
  ) {
    return '(This is a directory, not a file)';
  }

  const command = `powershell -NoProfile -Command "Get-Content -LiteralPath ${JSON.stringify(path)} -Raw -Encoding utf8"`;
  const result = await _host.exec(command, { cwd, timeout: 20000 });
  if (result.exitCode !== 0) {
    throw new Error(result.stderr.trim() || `Could not read ${path}.`);
  }
  return result.stdout;
}

/** Writes a workspace-relative file via the host adapter. */
export async function writeFileRaw(
  path: string,
  cwd: string,
  content: string,
): Promise<void> {
  if (!_host) throw new Error(t('extensionUnavailable'));
  const absolute = `${cwd.replace(/[\\/]+$/, '')}/${path.replace(/\\/g, '/')}`;
  await _host.writeFile(absolute, content);
}

/** Sends a prompt to the host provider and returns its reply (used by the commit-message button). */
export async function runAgentPrompt(
  prompt: string,
  sessionName: string,
  model?: string,
  provider: 'claude-code' | 'claude' | 'openai' = 'claude-code',
): Promise<string> {
  const ai = _host?.ai;
  if (!ai) throw new Error(t('aiUnavailable'));
  const { response } = await ai.sendPrompt({
    prompt,
    sessionName,
    provider,
    ...(model ? { model } : {}),
  });
  return response;
}

export async function listAiModels(): Promise<
  { id: string; name: string; provider: string }[]
> {
  const ai = _host?.ai;
  return ai ? ai.listModels() : [];
}

/** Toast outside the panel, used when a background job finishes while the panel is closed. */
export function notifyUser(kind: 'info' | 'error', message: string) {
  _host?.notify(kind, message);
}

/** How a file's bytes were decoded, so a save can restore the original encoding. */
export interface DecodedFile {
  text: string;
  encoding: 'utf8' | 'cp1252';
  bom: boolean;
}

function decodeBase64Bytes(b64: string): DecodedFile {
  const bin = atob(b64.replace(/\s+/g, ''));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  const bom =
    bytes.length >= 3 &&
    bytes[0] === 0xef &&
    bytes[1] === 0xbb &&
    bytes[2] === 0xbf;
  try {
    return {
      text: new TextDecoder('utf-8', { fatal: true }).decode(bytes),
      encoding: 'utf8',
      bom,
    };
  } catch {
    // Not valid UTF-8: legacy ANSI file (e.g. umlauts as single bytes).
    return {
      text: new TextDecoder('windows-1252').decode(bytes),
      encoding: 'cp1252',
      bom: false,
    };
  }
}

const editableBaseCache = new Map<string, DecodedFile>();
const editableWorkCache = new Map<
  string,
  { version: string; work: DecodedFile }
>();
// Vite HMR can leave an older Electron main process running that rejects new IPC channels: fall back to PowerShell.
let directFileApiAvailable: boolean | null = null;
// Only a missing handler disables the direct API; svn or file errors must not slow every later read.
const isMissingIpcHandler = (err: unknown) =>
  err instanceof Error && err.message.includes('No handler registered');

const editableFileCacheKey = (path: string, cwd: string) =>
  `${cwd}\u0000${path}`;

/** Drops cached BASE and working-copy content after an SVN update changes the pristine revision. */
export function clearEditableFileCache(): void {
  editableBaseCache.clear();
  editableWorkCache.clear();
}

/** Loads BASE and working-copy content for the editor; the diff text acts as a cheap version key. */
export async function readEditableFile(
  path: string,
  cwd: string,
  version: string,
  unversioned = false,
): Promise<{ base: DecodedFile; work: DecodedFile }> {
  if (!_host) throw new Error(t('svnNotReady'));
  const key = editableFileCacheKey(path, cwd);
  const baseHit = editableBaseCache.get(key);
  const workHit = editableWorkCache.get(key);
  if (baseHit && workHit?.version === version)
    return { base: baseHit, work: workHit.work };
  const [base, work] = await Promise.all([
    // Unversioned files have no BASE, so skip the `svn cat` round trip entirely.
    // A missing BASE (for example a newly added file) is a valid empty side.
    baseHit
      ? Promise.resolve(baseHit)
      : unversioned
        ? Promise.resolve(decodeBase64Bytes(''))
        : svnCatDecoded(path, cwd).catch(() => decodeBase64Bytes('')),
    readFileDecoded(path, cwd).catch(
      (): DecodedFile => ({ text: '', encoding: 'utf8', bom: false }),
    ),
  ]);
  editableBaseCache.set(key, base);
  editableWorkCache.set(key, { version, work });
  return { base, work };
}

/** Runs a PowerShell script (passed as -EncodedCommand to dodge all quoting) and returns stdout. */
async function runPowerShell(script: string, cwd: string): Promise<string> {
  if (!_host) throw new Error(t('svnNotReady'));
  const bytes = new Uint8Array(script.length * 2);
  for (let i = 0; i < script.length; i++) {
    bytes[i * 2] = script.charCodeAt(i) & 0xff;
    bytes[i * 2 + 1] = script.charCodeAt(i) >> 8;
  }
  let bin = '';
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  const result = await _host.exec(
    `powershell -NoProfile -NonInteractive -EncodedCommand ${btoa(bin)}`,
    { cwd, timeout: 30000 },
  );
  if (result.exitCode !== 0)
    throw new Error(result.stderr.trim() || 'PowerShell command failed.');
  return result.stdout;
}

const psq = (s: string) => `'${s.replace(/'/g, "''")}'`;

/** Sets svn:ignore from `patterns` via a temp file, so real newlines reach SVN. */
export async function svnSetIgnoreProperty(
  dir: string,
  patterns: string[],
  cwd: string,
  credArgs: string[],
): Promise<string> {
  const patternLiteral = psq(patterns.join('\n') + '\n');
  // credArgs as quoted PS array elements (may be empty)
  const credPart = credArgs.length
    ? ',' + credArgs.map((a) => psq(a)).join(',')
    : '';
  const dirQ = psq(dir);
  const script = `
$tmp = [IO.Path]::GetTempFileName()
$outTmp = [IO.Path]::GetTempFileName()
$errTmp = [IO.Path]::GetTempFileName()
try {
  [IO.File]::WriteAllText($tmp, ${patternLiteral}, (New-Object Text.UTF8Encoding($false)))
  $args = @('propset','svn:ignore','--file',$tmp,${dirQ},'--non-interactive'${credPart})
  $p = Start-Process svn -ArgumentList $args -Wait -NoNewWindow -PassThru -RedirectStandardOutput $outTmp -RedirectStandardError $errTmp
  $errText = [IO.File]::ReadAllText($errTmp).Trim()
  if ($p.ExitCode -ne 0) { throw "svn propset failed (exit $($p.ExitCode)): $errText" }
  Write-Output "property 'svn:ignore' set on ${dirQ}"
} finally {
  Remove-Item -LiteralPath $tmp,$outTmp,$errTmp -Force -ErrorAction SilentlyContinue
}`.trim();
  return runPowerShell(script, cwd);
}

/** Reads the working-copy file as raw bytes and decodes it (UTF-8, falling back to Windows-1252). */
export async function readFileDecoded(
  path: string,
  cwd: string,
): Promise<DecodedFile> {
  if (_host && directFileApiAvailable !== false) {
    const absolute = `${cwd.replace(/[\\/]+$/, '')}/${path.replace(/\\/g, '/')}`;
    try {
      const result = await _host.readFileBase64(absolute);
      directFileApiAvailable = true;
      return decodeBase64Bytes(result);
    } catch (err) {
      if (!isMissingIpcHandler(err)) throw err;
      directFileApiAvailable = false;
    }
  }
  const out = await runPowerShell(
    `[Convert]::ToBase64String([IO.File]::ReadAllBytes((Resolve-Path -LiteralPath ${psq(path)}).ProviderPath))`,
    cwd,
  );
  return decodeBase64Bytes(out);
}

/** `svn cat -r BASE` as raw bytes (the host's stdout capture would mangle non-UTF-8 text). */
export async function svnCatDecoded(
  path: string,
  cwd: string,
): Promise<DecodedFile> {
  if (_host && directFileApiAvailable !== false) {
    try {
      const result = await _host.svnCatBase64(path, cwd);
      directFileApiAvailable = true;
      return decodeBase64Bytes(result);
    } catch (err) {
      if (!isMissingIpcHandler(err)) throw err;
      directFileApiAvailable = false;
    }
  }
  const out = await runPowerShell(
    `$t = [IO.Path]::GetTempFileName(); try { Start-Process svn -ArgumentList 'cat','-r','BASE','--non-interactive',${psq(`"${path}"`)} -RedirectStandardOutput $t -Wait -NoNewWindow; [Convert]::ToBase64String([IO.File]::ReadAllBytes($t)) } finally { Remove-Item -LiteralPath $t -Force }`,
    cwd,
  );
  return decodeBase64Bytes(out);
}

/** Writes text back in the encoding it was read with. */
export async function writeFileEncoded(
  path: string,
  cwd: string,
  text: string,
  enc: DecodedFile,
): Promise<void> {
  if (enc.encoding === 'utf8') {
    await writeFileRaw(path, cwd, enc.bom ? `﻿${text}` : text);
    return;
  }
  // Stage as UTF-8 next to the target, then transcode to Windows-1252 in place.
  const tmp = `${path}.svn-ext-tmp`;
  await writeFileRaw(tmp, cwd, text);
  await runPowerShell(
    `$tmp = (Resolve-Path -LiteralPath ${psq(tmp)}).ProviderPath; try { $s = [IO.File]::ReadAllText($tmp, (New-Object Text.UTF8Encoding($false))); [IO.File]::WriteAllBytes((Resolve-Path -LiteralPath ${psq(path)}).ProviderPath, [Text.Encoding]::GetEncoding(1252).GetBytes($s)) } finally { Remove-Item -LiteralPath $tmp -Force }`,
    cwd,
  );
}
