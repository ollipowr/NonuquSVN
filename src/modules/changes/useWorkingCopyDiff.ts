import { t } from '@nonu/app/i18n';
import { type DiffCacheEntry, readFileRaw } from '@nonu/stores';
import { runSvn, SvnError } from '@nonu/svn';
import { type RefObject, useEffect, useState } from 'react';

export const diffCacheEntryKey = (path: string, status?: string) =>
  `${status ?? ''}:${path}`;
export function useWorkingCopyDiff({
  cwd,
  active,
  activeStatus,
  refreshTick,
  hasLoaded,
  initialDiff,
  diffCacheRef,
}: {
  cwd: string;
  active: string | null;
  activeStatus?: string;
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
  }, [cwd, active, activeStatus, refreshTick, hasLoaded]);

  return { diff, setDiff, diffIsNewFile };
}
