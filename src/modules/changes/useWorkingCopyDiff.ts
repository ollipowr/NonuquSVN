import { t } from '@nonu/app/i18n';
import { type DiffCacheEntry, readFileRaw } from '@nonu/stores';
import { runSvn, SvnError } from '@nonu/svn';
import { type RefObject, useEffect, useState } from 'react';

export const diffCacheEntryKey = (path: string, status?: string) =>
  `${status ?? ''}:${path}`;

/** One line per merge source, so changed revision lists show per path like TortoiseSVN. */
export function mergeinfoDiff(oldValue: string, newValue: string): string {
  const oldLines = oldValue.split(/\r?\n/).filter(Boolean);
  const newLines = newValue.split(/\r?\n/).filter(Boolean);
  const oldSet = new Set(oldLines);
  const newSet = new Set(newLines);
  const body = [
    ...newLines.filter((l) => oldSet.has(l)).map((l) => ` ${l}`),
    ...oldLines.filter((l) => !newSet.has(l)).map((l) => `-${l}`),
    ...newLines.filter((l) => !oldSet.has(l)).map((l) => `+${l}`),
  ];
  if (body.every((l) => l.startsWith(' '))) return '';
  return [`@@ -1,${oldLines.length} +1,${newLines.length} @@`, ...body].join(
    '\n',
  );
}

export function useWorkingCopyDiff({
  cwd,
  active,
  activeStatus,
  propsOnly,
  refreshTick,
  hasLoaded,
  initialDiff,
  diffCacheRef,
}: {
  cwd: string;
  active: string | null;
  activeStatus?: string;
  propsOnly?: boolean;
  refreshTick: number;
  hasLoaded: boolean;
  initialDiff?: DiffCacheEntry;
  diffCacheRef: RefObject<Map<string, DiffCacheEntry>>;
}) {
  const [diff, setDiff] = useState(initialDiff?.text ?? '');
  const [diffIsNewFile, setDiffIsNewFile] = useState(
    initialDiff?.isNewFile ?? false,
  );
  useEffect(() => {
    if (!cwd || !active) {
      setDiff('');
      setDiffIsNewFile(false);
      return;
    }
    const cache = diffCacheEntryKey(active, activeStatus);
    const hit = diffCacheRef.current.get(cache);
    if (hit) {
      setDiff(hit.text);
      setDiffIsNewFile(hit.isNewFile);
    }
    if (!hasLoaded) return;
    const isUnversioned = activeStatus === 'unversioned';
    let cancelled = false;
    const store = (text: string, isNewFile: boolean) => {
      if (cancelled) return;
      const m = diffCacheRef.current;
      m.delete(cache);
      m.set(cache, { text, isNewFile });
      if (m.size > 40) m.delete(m.keys().next().value as string);
      setDiff(text);
      setDiffIsNewFile(isNewFile);
    };
    (async () => {
      try {
        if (isUnversioned) {
          store((await readFileRaw(active, cwd)) || t('diffEmptyFile'), true);
          return;
        }
        if (propsOnly) {
          const [before, after] = await Promise.all([
            runSvn(['propget', 'svn:mergeinfo', '-r', 'BASE', active], cwd),
            runSvn(['propget', 'svn:mergeinfo', active], cwd),
          ]);
          const merged = mergeinfoDiff(before.stdout, after.stdout);
          if (merged) {
            store(merged, false);
            return;
          }
        }
        const { stdout } = await runSvn(['diff', active], cwd);
        store(
          stdout.trim() ||
            'No textual diff (binary file or no content change).',
          false,
        );
      } catch (err) {
        if (!cancelled) {
          setDiff(err instanceof SvnError ? err.message : String(err));
          setDiffIsNewFile(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [cwd, active, activeStatus, propsOnly, refreshTick, hasLoaded]);

  return { diff, setDiff, diffIsNewFile };
}
