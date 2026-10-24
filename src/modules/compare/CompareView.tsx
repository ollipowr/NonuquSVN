import { t } from '@nonu/app/i18n';
import { Button, Select, ViewHeader } from '@nonu/components';
import {
  DiffView,
  type DiffViewHandle,
  useChangeJumpShortcut,
} from '@nonu/modules/changes';
import { invalidateMergeinfo } from '@nonu/modules/workspace';
import type { SvnCredentials } from '@nonu/svn';
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import './CompareView.css';
import {
  type BranchRegistry,
  diffBranches,
  fetchEligible,
  fetchRevisionLog,
  type LogRevision,
} from '@nonu/modules/branches';

export interface CompareViewProps {
  registry: BranchRegistry;
  cwd: string;
  run: (
    label: string,
    fn: (credentials?: SvnCredentials) => Promise<string>,
  ) => Promise<void>;
  /** Opens the merge view pre-seeded with this source. */
  onMerge: (sourceId: string) => void;
}

/** Eligible revisions in one direction, with their log entries. */
interface Side {
  revs: number[];
  log: LogRevision[];
}

export function CompareView({ registry, cwd, run, onMerge }: CompareViewProps) {
  const diffRef = useRef<DiffViewHandle>(null);
  const jumpDiff = useCallback(
    (dir: 'prev' | 'next') => diffRef.current?.jump(dir) ?? false,
    [],
  );
  useChangeJumpShortcut(jumpDiff);
  const [leftId, setLeftId] = useState(
    () =>
      registry.entries.find((e) => e.kind === 'trunk')?.id ??
      registry.entries[0]?.id ??
      '',
  );
  const [rightId, setRightId] = useState(() => {
    const trunk = registry.entries.find((e) => e.kind === 'trunk');
    const left = trunk ?? registry.entries[0];
    return (
      registry.entries.find((e) => e.id !== left?.id)?.id ??
      registry.entries[1]?.id ??
      ''
    );
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [aToB, setAToB] = useState<Side | null>(null);
  const [bToA, setBToA] = useState<Side | null>(null);
  const [diff, setDiff] = useState<{ text: string; loading: boolean } | null>(
    null,
  );

  const left = registry.entries.find((e) => e.id === leftId);
  const right = registry.entries.find((e) => e.id === rightId);
  const same = !left || !right || left.id === right.id;

  const load = useCallback(
    async (force = false) => {
      if (!left || !right || same) return;
      if (force) invalidateMergeinfo([left.url, right.url]);
      setLoading(true);
      setError(null);
      setDiff(null);
      try {
        // Both directions, so the user sees ahead and behind at once.
        const [outRevs, inRevs] = await Promise.all([
          fetchEligible(left.url, right.url, cwd),
          fetchEligible(right.url, left.url, cwd),
        ]);
        const [outLog, inLog] = await Promise.all([
          fetchRevisionLog(left.url, outRevs, cwd),
          fetchRevisionLog(right.url, inRevs, cwd),
        ]);
        setAToB({ revs: outRevs, log: outLog });
        setBToA({ revs: inRevs, log: inLog });
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    },
    [left, right, same, cwd],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const showDiff = useCallback(() => {
    if (!left || !right) return;
    setDiff({ text: '', loading: true });
    void run(t('compareDiffLoading') as string, async (credentials) => {
      const text = await diffBranches(left.url, right.url, cwd, credentials);
      setDiff({ text, loading: false });
      return text.trim()
        ? (t('compareDiff') as string)
        : (t('compareDiffEmpty') as string);
    }).catch((err: unknown) => {
      setDiff(null);
      setError(err instanceof Error ? err.message : String(err));
    });
  }, [left, right, cwd, run]);

  const options = useMemo(() => registry.entries, [registry.entries]);

  return (
    <div className="svn-compare">
      <div className="svn-compare-bar">
        <label className="svn-compare-pick">
          {t('compareLeft') as string}
          <Select
            value={leftId}
            options={options.map((o) => ({ value: o.id, label: o.name }))}
            onChange={setLeftId}
          />
        </label>
        <span className="material-symbols-outlined">sync_alt</span>
        <label className="svn-compare-pick">
          {t('compareRight') as string}
          <Select
            value={rightId}
            options={options.map((o) => ({ value: o.id, label: o.name }))}
            onChange={setRightId}
          />
        </label>
        <span className="svn-branches-toolbar-spacer" />
        <Button onClick={showDiff} disabled={same || loading}>
          {t('compareDiff') as string}
        </Button>
      </div>

      {same ? (
        <div className="svn-empty">
          <div className="svn-empty-hint">{t('compareSame') as string}</div>
        </div>
      ) : error ? (
        <div className="svn-merge-error">{error}</div>
      ) : loading ? (
        <div className="svn-empty">
          <div className="svn-empty-hint">{t('compareLoading') as string}</div>
        </div>
      ) : (
        <>
          <ViewHeader title={t('compareTitle') as string}>
            <Button
              icon
              title={t('refresh') as string}
              onClick={() => void load(true)}
              disabled={loading}
            >
              <span className="material-symbols-outlined">refresh</span>
            </Button>
          </ViewHeader>
          <div className="svn-compare-cols">
            <CompareColumn
              heading={(
                t('compareIncoming') as (a: string, b: string) => string
              )(left!.name, right!.name)}
              side={aToB}
              onMerge={() => onMerge(left!.id)}
            />
            <CompareColumn
              heading={(
                t('compareIncoming') as (a: string, b: string) => string
              )(right!.name, left!.name)}
              side={bToA}
              onMerge={() => onMerge(right!.id)}
            />
          </div>
        </>
      )}

      {diff && (
        <div className="svn-compare-diff">
          {diff.loading ? (
            <div className="svn-empty-hint">
              {t('compareDiffLoading') as string}
            </div>
          ) : diff.text.trim() ? (
            <DiffView ref={diffRef} text={diff.text} path={null} />
          ) : (
            <div className="svn-empty-hint">
              {t('compareDiffEmpty') as string}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function CompareColumn({
  heading,
  side,
  onMerge,
}: {
  heading: string;
  side: Side | null;
  onMerge: () => void;
}) {
  return (
    <div className="svn-compare-col">
      <div className="svn-compare-colhead">
        <span>{heading}</span>
        <span className="svn-compare-count">{side?.revs.length ?? 0}</span>
      </div>
      {!side || side.revs.length === 0 ? (
        <div className="svn-empty-hint">{t('compareNone') as string}</div>
      ) : (
        <>
          <div className="svn-compare-revs">
            {[...side.revs]
              .sort((a, b) => b - a)
              .map((rev) => {
                const entry = side.log.find((l) => l.rev === rev);
                return (
                  <div key={rev} className="svn-compare-rev">
                    <span className="svn-merge-rev-no">r{rev}</span>
                    <span className="svn-merge-rev-author">
                      {entry?.author ?? ''}
                    </span>
                    <span
                      className="svn-merge-rev-msg"
                      title={entry?.message ?? ''}
                    >
                      {entry?.message?.split('\n')[0] ?? ''}
                    </span>
                  </div>
                );
              })}
          </div>
          <Button onClick={onMerge}>{t('compareMergeThis') as string}</Button>
        </>
      )}
    </div>
  );
}
