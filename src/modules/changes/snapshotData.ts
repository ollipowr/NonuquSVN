import type { HostAdapter, SnapshotRecord } from '@nonu/host/types';
import { useEffect, useState } from 'react';
import type { DiffFiles } from './DiffEditor.js';

/** `binarySize` is set instead of text when either side holds binary content. */
export interface SnapshotDiff {
  files: DiffFiles;
  binarySize?: number;
}

const BINARY_PROBE_BYTES = 8000;

export function useSnapshotRecords(
  host: HostAdapter,
  cwd: string,
  refreshTick: number,
): SnapshotRecord[] {
  const [records, setRecords] = useState<SnapshotRecord[]>([]);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const list = (await host.listSnapshots?.(cwd)) ?? [];
      if (!cancelled) setRecords(list);
    })().catch(() => {
      if (!cancelled) setRecords([]);
    });
    return () => {
      cancelled = true;
    };
  }, [host, cwd, refreshTick]);
  return records;
}

function bytesOf(base64: string | null): Uint8Array {
  if (base64 === null) return new Uint8Array();
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}

/** Snapshot content against the working copy's current file; a missing side counts as empty. */
export async function loadSnapshotDiff(
  host: HostAdapter,
  snapshotId: string,
  cwd: string,
  path: string,
): Promise<SnapshotDiff> {
  const base = bytesOf(
    (await host.readSnapshotFile?.(snapshotId, path)) ?? null,
  );
  const work = bytesOf(
    await host.readFileBase64(`${cwd}/${path}`).catch(() => null),
  );
  const binary = [base, work].some((bytes) =>
    bytes.subarray(0, BINARY_PROBE_BYTES).includes(0),
  );
  if (binary)
    return {
      files: { base: '', work: '' },
      binarySize: Math.max(base.length, work.length),
    };
  const decoder = new TextDecoder();
  return { files: { base: decoder.decode(base), work: decoder.decode(work) } };
}
