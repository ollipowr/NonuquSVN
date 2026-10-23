import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type {
  RestoreMode,
  RestoreResult,
  SnapshotEntryInput,
  SnapshotFileInput,
  SnapshotRecord,
} from '../src/host/types';

const PASSWORD_ARG = /(--(?:password|passwd)(?:=|\s+))("[^"]*"|'[^']*'|\S+)/gi;

export function maskCommand(command: string): string {
  return command.replace(PASSWORD_ARG, '$1***');
}

function projectDir(root: string, workingCopy: string): string {
  const key = createHash('sha256').update(path.resolve(workingCopy)).digest('hex').slice(0, 16);
  return path.join(root, key);
}

function readIndex(dir: string): SnapshotRecord[] {
  const file = path.join(dir, 'index.json');
  if (!fs.existsSync(file)) return [];
  return JSON.parse(fs.readFileSync(file, 'utf8')) as SnapshotRecord[];
}

function writeIndex(dir: string, records: SnapshotRecord[]) {
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, 'index.json.tmp');
  fs.writeFileSync(tmp, JSON.stringify(records, null, 2), 'utf8');
  fs.renameSync(tmp, path.join(dir, 'index.json'));
}

function storeBlob(blobsDir: string, base64: string): string {
  const bytes = Buffer.from(base64, 'base64');
  const hash = createHash('sha256').update(bytes).digest('hex');
  const file = path.join(blobsDir, hash);
  if (!fs.existsSync(file)) fs.writeFileSync(file, bytes);
  return hash;
}

function isInside(root: string, target: string): boolean {
  const rel = path.relative(root, target);
  return rel !== '' && rel.split(path.sep)[0] !== '..' && !path.isAbsolute(rel);
}

export function saveSnapshot(
  root: string,
  entry: SnapshotEntryInput,
  files: SnapshotFileInput[],
): SnapshotRecord {
  const dir = projectDir(root, entry.workingCopy);
  const blobsDir = path.join(dir, 'blobs');
  fs.mkdirSync(blobsDir, { recursive: true });
  const record: SnapshotRecord = {
    id: randomUUID(),
    time: new Date().toISOString(),
    command: maskCommand(entry.command),
    workingCopy: path.resolve(entry.workingCopy),
    files: files.map(file => ({
      path: file.path,
      statusBefore: file.statusBefore,
      hash: file.content === null ? null : storeBlob(blobsDir, file.content),
    })),
  };
  writeIndex(dir, [record, ...readIndex(dir)]);
  return record;
}

export function listSnapshots(root: string, workspace: string): SnapshotRecord[] {
  return readIndex(projectDir(root, workspace));
}

export interface SnapshotLimits {
  maxDays: number;
  maxMB: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function blobBytes(blobsDir: string, hash: string): number {
  try {
    return fs.statSync(path.join(blobsDir, hash)).size;
  } catch {
    return 0;
  }
}

function referencedHashes(records: SnapshotRecord[]): Set<string> {
  return new Set(records.flatMap(r => r.files.flatMap(f => (f.hash === null ? [] : [f.hash]))));
}

export function pruneSnapshots(root: string, workspace: string, limits: SnapshotLimits): void {
  pruneDir(projectDir(root, workspace), limits);
}

export function pruneAllSnapshots(root: string, limits: SnapshotLimits): void {
  if (!fs.existsSync(root)) return;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.isDirectory()) pruneDir(path.join(root, entry.name), limits);
  }
}

// Index is newest first, so popping drops the oldest snapshot.
function pruneDir(dir: string, limits: SnapshotLimits): void {
  if (!fs.existsSync(dir)) return;
  const blobsDir = path.join(dir, 'blobs');
  const cutoff = Date.now() - limits.maxDays * DAY_MS;
  const maxBytes = limits.maxMB * 1024 * 1024;
  const all = readIndex(dir);
  const records = all.filter(r => Date.parse(r.time) >= cutoff);
  const bytesOf = (list: SnapshotRecord[]) =>
    [...referencedHashes(list)].reduce((sum, hash) => sum + blobBytes(blobsDir, hash), 0);
  while (records.length > 0 && bytesOf(records) > maxBytes) records.pop();
  if (records.length !== all.length) writeIndex(dir, records);
  const live = referencedHashes(records);
  for (const name of fs.readdirSync(blobsDir)) {
    if (!live.has(name)) fs.rmSync(path.join(blobsDir, name), { force: true });
  }
}

function findSnapshot(root: string, id: string): { dir: string; record: SnapshotRecord } {
  if (fs.existsSync(root)) {
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const dir = path.join(root, entry.name);
      const record = readIndex(dir).find(r => r.id === id);
      if (record) return { dir, record };
    }
  }
  throw new Error(`Snapshot not found: ${id}`);
}

function besideName(target: string): string {
  const { dir, name, ext } = path.parse(target);
  let candidate = path.join(dir, `${name} (restored)${ext}`);
  for (let n = 2; fs.existsSync(candidate); n++) {
    candidate = path.join(dir, `${name} (restored ${n})${ext}`);
  }
  return candidate;
}

export function readSnapshotFile(root: string, id: string, file: string): string | null {
  const { dir, record } = findSnapshot(root, id);
  const entry = record.files.find(f => f.path === file);
  if (!entry || entry.hash === null) return null;
  return fs.readFileSync(path.join(dir, 'blobs', entry.hash)).toString('base64');
}

export function restoreSnapshot(
  root: string,
  id: string,
  paths: string[],
  mode: RestoreMode,
): RestoreResult {
  const { dir, record } = findSnapshot(root, id);
  const result: RestoreResult = { restored: [], conflicts: [], skipped: [], failed: [] };
  for (const requested of paths) {
    const file = record.files.find(f => f.path === requested);
    const target = file ? path.resolve(record.workingCopy, file.path) : null;
    if (!file || file.hash === null || !target || !isInside(record.workingCopy, target)) {
      result.skipped.push(requested);
      continue;
    }
    try {
      const source = path.join(dir, 'blobs', file.hash);
      const exists = fs.existsSync(target);
      const differs = exists && !fs.readFileSync(target).equals(fs.readFileSync(source));
      if (mode === 'check') {
        (differs ? result.conflicts : result.skipped).push(requested);
        continue;
      }
      if (mode === 'missing-only' && exists) {
        result.skipped.push(requested);
        continue;
      }
      const dest = mode === 'copy' && differs ? besideName(target) : target;
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(source, dest);
      result.restored.push(requested);
    } catch {
      result.failed.push(requested);
    }
  }
  return result;
}
