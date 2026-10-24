import { t } from '@nonu/app/i18n';
import { Button, ProgressBar, Select } from '@nonu/components';
import { Spinner } from '@nonu/components/ui/Spinner';
import { TextField } from '@nonu/components/ui/TextField';
import { RevisionList } from '@nonu/modules/history';
import type { OperationResult, SvnCredentials } from '@nonu/svn';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import './MergeView.css';
import {
  type BranchEntry,
  type BranchRegistry,
  type BranchStatus,
  fetchBranchStatus,
  fetchEligible,
  fetchMerged,
  fetchRevisionLog,
  formatMergeCommitMessage,
  type LogRevision,
  type MergeResult,
  mergeRevisions,
  updateBranch,
} from './branches.js';
import { defaultMergeDirection } from './mergeDirection.js';

export interface MergeViewProps {
  registry: BranchRegistry;
  cwd: string;
  /** Row the user started from; seeds the source. */
  defaultSourceId?: string;
  /** Optional target seed for a directed merge. */
  defaultTargetId?: string;
  run: (
    label: string,
    fn: (credentials?: SvnCredentials) => Promise<OperationResult>,
  ) => Promise<void>;
  onClose: () => void;
  /** Called after a real merge so the panel reloads and seeds its commit message. */
  onMerged: (message: string, targetPath: string) => void;
}

type Step = 'direction' | 'revisions' | 'preview' | 'done';

/** True when `picked` is a contiguous run starting at the oldest eligible revision. */
export function isContiguousFromOldest(
  eligible: number[],
  picked: number[],
): boolean {
  if (picked.length === 0) return true;
  const sortedEligible = [...eligible].sort((a, b) => a - b);
  const sortedPicked = [...picked].sort((a, b) => a - b);
  return sortedPicked.every((rev, i) => rev === sortedEligible[i]);
}

/** True once every working copy is checked and none has a confirmed pending update. An unknown check result is terminal, not "still checking". */
export function areWorkingCopiesChecked(
  workingCopies: { id: string }[],
  updateStatuses: Map<string, { updateAvailable?: boolean }>,
): boolean {
  return workingCopies.every((entry) => {
    const status = updateStatuses.get(entry.id);
    return status !== undefined && status.updateAvailable !== true;
  });
}

export function MergeView({
  registry,
  cwd,
  defaultSourceId,
  defaultTargetId,
  run,
  onClose,
  onMerged,
}: MergeViewProps) {
  const targets = useMemo(
    () => registry.entries.filter((e) => e.localPath),
    [registry.entries],
  );

  // Default direction comes from `kind`: trunk into a branch is the common case.
  const [initialDirection] = useState(() =>
    defaultMergeDirection(registry.entries, defaultSourceId, defaultTargetId),
  );
  const [sourceId, setSourceId] = useState(
    initialDirection.sourceId || 'custom-merge-source',
  );
  const [sourceUrl, setSourceUrl] = useState('');
  const [targetId, setTargetId] = useState(initialDirection.targetId);
  const [step, setStep] = useState<Step>('direction');
  const [eligible, setEligible] = useState<number[] | null>(null);
  const [merged, setMerged] = useState<number[] | null>(null);
  const [log, setLog] = useState<LogRevision[]>([]);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [lastClicked, setLastClicked] = useState<number | null>(null);
  const [revFilter, setRevFilter] = useState('');
  const [showMerged, setShowMerged] = useState(false);
  const [activeRevision, setActiveRevision] = useState<string | undefined>();
  const [visibleCount, setVisibleCount] = useState(100);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [guard, setGuard] = useState<{ dirty: number } | null>(null);
  const [preview, setPreview] = useState<MergeResult | null>(null);
  const [result, setResult] = useState<MergeResult | null>(null);
  const [updateStatuses, setUpdateStatuses] = useState<
    Map<string, BranchStatus>
  >(new Map());

  const source = useMemo<BranchEntry | undefined>(() => {
    if (sourceId !== 'custom-merge-source')
      return registry.entries.find((e) => e.id === sourceId);
    const url = sourceUrl.trim();
    if (!/^(https?|svn|svn\+ssh|file):\/\//i.test(url)) return undefined;
    return {
      id: 'custom-merge-source',
      name: url.replace(/\/+$/, '').split('/').pop() || 'Source',
      url,
      kind: 'other',
    };
  }, [registry.entries, sourceId, sourceUrl]);
  const target = registry.entries.find((e) => e.id === targetId);

  const workingCopies = useMemo(
    () =>
      [source, target].filter(
        (entry, index, all): entry is BranchEntry =>
          !!entry?.localPath &&
          all.findIndex((other) => other?.localPath === entry.localPath) ===
            index,
      ),
    [source, target],
  );
  const targetWorkingCopy = workingCopies.find(
    (copy) => copy.localPath === target?.localPath,
  );

  const checkWorkingCopies = useCallback(
    async (force = false) => {
      setLoading(true);
      setError(null);
      try {
        const checked = await Promise.all(
          workingCopies.map(
            async (entry) =>
              [
                entry.id,
                await fetchBranchStatus(entry, cwd, undefined, force),
              ] as const,
          ),
        );
        setUpdateStatuses(new Map(checked));
        if (
          checked.some(([, status]) => status.updateAvailable === undefined)
        ) {
          setError(t('mergeCheckFailed') as string);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    },
    [workingCopies, cwd],
  );

  useEffect(() => {
    if (!directionError) void checkWorkingCopies();
  }, [workingCopies]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const directionError =
    !source || !target
      ? (t('mergeSourceRequired') as string)
      : source.id === target.id ||
          source.url.replace(/\/+$/, '') === target.url.replace(/\/+$/, '')
        ? (t('mergeSameBranch') as string)
        : !target.localPath
          ? (t('mergeTargetNeedsLocal') as string)
          : null;

  /** Loads eligible revisions and their log; local target changes warn unless accepted. Mixed revisions still fail in svn (E195020). */
  const loadRevisions = useCallback(
    async (acceptLocal = false) => {
      if (!source || !target?.localPath) return;
      setLoading(true);
      setStep('revisions');
      setError(null);
      setGuard(null);
      try {
        const targetStatus = await fetchBranchStatus(
          target,
          cwd,
          undefined,
          true,
        );
        if (!acceptLocal && (targetStatus?.localChanges ?? 0) > 0) {
          setGuard({ dirty: targetStatus!.localChanges });
          setEligible(null);
          return;
        }
        const [revs, mergedRevs] = await Promise.all([
          fetchEligible(source.url, target.url, cwd),
          fetchMerged(source.url, target.url, cwd),
        ]);
        setEligible(revs);
        setMerged(mergedRevs);
        setLog([]);
        setVisibleCount(100);
        setPicked(new Set(revs));
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    },
    [source, target, targetWorkingCopy, updateStatuses, cwd],
  );

  const onUpdateTarget = useCallback(() => {
    if (!target) return;
    void run(t('mergeUpdateFirst') as string, async (credentials) => {
      const out = await updateBranch(target, credentials);
      return out || (t('mergeUpdateFirst') as string);
    }).then(() => void loadRevisions());
  }, [target, run, loadRevisions]);

  /** Merges are calculated against current working copies; remote-only sources need no local update. */
  const onUpdateWorkingCopies = useCallback(
    (entries: BranchEntry[]) => {
      if (entries.length === 0) return;
      setLoading(true);
      setError(null);
      void run(t('mergeUpdateBothRunning') as string, async (credentials) => {
        // A switch-model entry can point source and target at the same folder;
        // update that working copy once rather than doing duplicate work.
        for (const entry of entries) await updateBranch(entry, credentials);
        return (t('mergeUpdateBothDone') as (n: number) => string)(
          entries.length,
        );
      })
        .then(() => checkWorkingCopies())
        .catch((err: unknown) =>
          setError(err instanceof Error ? err.message : String(err)),
        )
        .finally(() => setLoading(false));
    },
    [run, checkWorkingCopies],
  );

  const pendingUpdates = workingCopies.filter(
    (entry) => updateStatuses.get(entry.id)?.updateAvailable === true,
  );
  const updatesChecked = areWorkingCopiesChecked(workingCopies, updateStatuses);

  const togglePick = useCallback(
    (revStr: string, shift: boolean) => {
      const rev = Number(revStr);
      setActiveRevision(revStr);
      setPicked((prev) => {
        const next = new Set(prev);
        if (shift && lastClicked != null && eligible) {
          const lo = Math.min(lastClicked, rev);
          const hi = Math.max(lastClicked, rev);
          const shouldSelect = !prev.has(rev);
          for (const r of eligible) {
            if (r >= lo && r <= hi) {
              if (shouldSelect) next.add(r);
              else next.delete(r);
            }
          }
        } else if (next.has(rev)) next.delete(rev);
        else next.add(rev);
        return next;
      });
      setLastClicked(rev);
    },
    [lastClicked, eligible],
  );

  const pickedSorted = useMemo(
    () => [...picked].sort((a, b) => a - b),
    [picked],
  );
  const mergedSet = useMemo(() => new Set(merged ?? []), [merged]);
  const allRevisions = useMemo(
    () =>
      [...new Set([...(eligible ?? []), ...(merged ?? [])])].sort(
        (a, b) => b - a,
      ),
    [eligible, merged],
  );
  const filteredRevisions = useMemo(
    () =>
      showMerged
        ? allRevisions
        : allRevisions.filter(
            (rev) => !mergedSet.has(rev) || eligible?.includes(rev),
          ),
    [allRevisions, showMerged, mergedSet, eligible],
  );
  const visibleRevisions = useMemo(
    () => filteredRevisions.slice(0, visibleCount),
    [filteredRevisions, visibleCount],
  );
  const hasMoreRevisions = filteredRevisions.length > visibleRevisions.length;

  // Fetch author/date/message for the visible page only: the full range can exceed svn log's output buffer.
  useEffect(() => {
    if (!source || visibleRevisions.length === 0) return;
    const missing = visibleRevisions.filter(
      (rev) => !log.some((l) => l.rev === rev),
    );
    if (missing.length === 0) return;
    let cancelled = false;
    void fetchRevisionLog(source.url, missing, cwd)
      .then((entries) => {
        if (cancelled) return;
        setLog((prev) => [
          ...prev,
          ...entries.filter((e) => !prev.some((l) => l.rev === e.rev)),
        ]);
      })
      .catch((err) =>
        setError(err instanceof Error ? err.message : String(err)),
      );
    return () => {
      cancelled = true;
    };
  }, [source, visibleRevisions, cwd]);

  // `--verbose` is fetched only for the selected revision, to stay under the svn log buffer limit.
  useEffect(() => {
    if (!source || !activeRevision) return;
    const rev = Number(activeRevision);
    const entry = log.find((l) => l.rev === rev);
    if (!entry || entry.paths !== undefined) return;
    let cancelled = false;
    void fetchRevisionLog(source.url, [rev], cwd)
      .then(([detailed]) => {
        if (cancelled || !detailed?.paths) return;
        setLog((prev) =>
          prev.map((l) =>
            l.rev === rev ? { ...l, paths: detailed.paths } : l,
          ),
        );
      })
      .catch((err) =>
        setError(err instanceof Error ? err.message : String(err)),
      );
    return () => {
      cancelled = true;
    };
  }, [source, activeRevision, log, cwd]);

  const revisionEntries = useMemo(
    () =>
      visibleRevisions.map((rev) => {
        const entry = log.find((l) => l.rev === rev);
        return {
          revision: String(rev),
          author: entry?.author ?? '',
          date: entry?.date ?? '',
          message: entry?.message ?? '',
          paths: entry?.paths,
        };
      }),
    [visibleRevisions, log],
  );
  const pickedStrings = useMemo(
    () => new Set([...picked].map(String)),
    [picked],
  );
  const disabledStrings = useMemo(
    () => new Set([...mergedSet].map(String)),
    [mergedSet],
  );
  const hasGap = eligible
    ? !isContiguousFromOldest(eligible, pickedSorted)
    : false;

  const onPreview = useCallback(() => {
    if (!source || !target?.localPath || pickedSorted.length === 0) return;
    setLoading(true);
    setError(null);
    setStep('preview');
    void run(t('mergePreviewRunning') as string, async (credentials) => {
      const r = await mergeRevisions({
        sourceUrl: source.url,
        targetPath: target.localPath!,
        revs: pickedSorted,
        dryRun: true,
        credentials,
      });
      setPreview(r);
      return (t('mergePreviewFiles') as (n: number) => string)(r.files.length);
    })
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : String(err)),
      )
      .finally(() => setLoading(false));
  }, [source, target, pickedSorted, run]);

  const onRunMerge = useCallback(() => {
    if (!source || !target?.localPath || pickedSorted.length === 0) return;
    setLoading(true);
    void run(t('mergeRunning') as string, async (credentials) => {
      const r = await mergeRevisions({
        sourceUrl: source.url,
        targetPath: target.localPath!,
        revs: pickedSorted,
        dryRun: false,
        credentials,
      });
      setResult(r);
      setStep('done');
      onMerged(
        formatMergeCommitMessage(pickedSorted, source.name, log),
        target.localPath!,
      );
      // Conflicts do NOT make svn exit non-zero, so the summary is the signal.
      return {
        text:
          r.conflicts > 0
            ? (t('mergeDoneConflicts') as (n: number) => string)(r.conflicts)
            : (t('mergeDoneClean') as (n: number) => string)(
                pickedSorted.length,
              ),
        snapshotId: r.snapshotId,
      };
    })
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : String(err)),
      )
      .finally(() => setLoading(false));
  }, [source, target, pickedSorted, log, run, onMerged]);

  return (
    <div className="svn-merge-view">
      <div className="svn-merge-body">
        <div className="svn-merge-context">
          <strong>
            {source?.name ?? '—'} → {target?.name ?? '—'}
          </strong>
          <span>
            {t('mergeTarget') as string}: {target?.localPath}
          </span>
        </div>
        <div className="svn-merge-head">
          <ol className="svn-merge-steps">
            {(['direction', 'revisions', 'preview'] as const).map((s, i) => (
              <li
                key={s}
                className={`svn-merge-step${step === s ? ' svn-merge-step--active' : ''}${
                  ['direction', 'revisions', 'preview'].indexOf(step) > i ||
                  step === 'done'
                    ? ' svn-merge-step--done'
                    : ''
                }`}
              >
                <span className="svn-merge-step-no">{i + 1}</span>
                {s === 'direction'
                  ? (t('mergeStepDirection') as string)
                  : s === 'revisions'
                    ? (t('mergeStepRevisions') as string)
                    : (t('mergeStepPreview') as string)}
              </li>
            ))}
          </ol>
        </div>

        <div className="svn-merge-status-slot" role="status">
          {error}
        </div>

        {step === 'direction' && (
          <>
            <div className="svn-merge-repos svn-merge-direction">
              {(
                [
                  {
                    label: t('mergeSource') as string,
                    value: sourceId,
                    onChange: setSourceId,
                    options: registry.entries,
                    entry: source,
                  },
                  {
                    label: t('mergeTarget') as string,
                    value: targetId,
                    onChange: setTargetId,
                    options: targets,
                    entry: target,
                  },
                ] as const
              ).map(({ label, value, onChange, options, entry }, index) => {
                const workingCopy = entry
                  ? workingCopies.find(
                      (copy) => copy.localPath === entry.localPath,
                    )
                  : undefined;
                const status = workingCopy
                  ? updateStatuses.get(workingCopy.id)
                  : undefined;
                const isRemote = !entry?.localPath;
                const isCurrent = isRemote || status?.updateAvailable === false;
                const showStatus = !directionError && !!entry;
                return (
                  <React.Fragment key={index}>
                    {index === 1 && (
                      <div className="svn-merge-arrow">
                        <span className="material-symbols-outlined">east</span>
                        <Button
                          icon
                          disabled={loading || !source?.localPath}
                          onClick={() => {
                            const s = sourceId;
                            setSourceId(targetId);
                            setTargetId(s);
                          }}
                          title={t('mergeSwap') as string}
                        >
                          <span className="material-symbols-outlined">
                            swap_horiz
                          </span>
                        </Button>
                      </div>
                    )}
                    <div
                      className={`svn-merge-update-repo${showStatus && isCurrent ? ' svn-merge-update-repo--current' : ''}`}
                    >
                      <label className="svn-auth-field">
                        <span>{label}</span>
                        <Select
                          value={value}
                          disabled={loading}
                          options={[
                            ...options
                              .filter((e) => index === 1 || e.id !== targetId)
                              .map((e) => ({ value: e.id, label: e.name })),
                            ...(index === 0
                              ? [
                                  {
                                    value: 'custom-merge-source',
                                    label: t('mergeSourceUrl') as string,
                                  },
                                ]
                              : []),
                          ]}
                          onChange={onChange}
                          variant="filled"
                          className="svn-menu--fullwidth"
                        />
                      </label>
                      {index === 0 && sourceId === 'custom-merge-source' && (
                        <TextField
                          label={t('mergeSourceUrl') as string}
                          value={sourceUrl}
                          onChange={setSourceUrl}
                          placeholder="https://svn.example.org/project/trunk"
                          spellCheck={false}
                        />
                      )}
                      {showStatus && (
                        <div className="svn-merge-repo-summary">
                          <span
                            className={
                              isCurrent ? 'svn-merge-status--current' : ''
                            }
                          >
                            {isCurrent && (
                              <span className="material-symbols-outlined">
                                check
                              </span>
                            )}
                            {isCurrent
                              ? (t('mergeUpToDate') as string)
                              : status?.updateAvailable === true
                                ? (t('mergeUpdateRequired') as string)
                                : (t('mergeChecking') as string)}
                          </span>
                        </div>
                      )}
                    </div>
                  </React.Fragment>
                );
              })}
            </div>
            <div className="svn-auth-hint">
              {t('mergeNoCommitHint') as string}
            </div>
            <div className="svn-auth-actions svn-merge-actions">
              <div
                className={`svn-merge-inline-status${loading ? ' svn-merge-inline-status--loading' : ''}`}
              >
                {directionError ??
                  (loading ? (
                    <>
                      <Spinner label={t('mergeChecking') as string} />{' '}
                      {t('mergeChecking') as string}
                    </>
                  ) : null)}
              </div>
              <div className="svn-merge-action-buttons">
                <Button onClick={onClose}>{t('mergeClose') as string}</Button>
                {pendingUpdates.length > 0 && (
                  <Button
                    disabled={loading}
                    onClick={() => onUpdateWorkingCopies(pendingUpdates)}
                  >
                    {t('mergeUpdateBoth') as string}
                  </Button>
                )}
                <Button
                  disabled={loading}
                  onClick={() => void checkWorkingCopies(true)}
                >
                  {t('mergeRecheck') as string}
                </Button>
                <Button
                  variant="primary"
                  disabled={!!directionError || loading || !updatesChecked}
                  onClick={() => void loadRevisions()}
                >
                  {t('mergeNext') as string}
                </Button>
              </div>
            </div>
          </>
        )}

        {step === 'revisions' && (
          <div className="svn-merge-revisions-step">
            {guard ? (
              <div className="svn-merge-guard">
                <span className="material-symbols-outlined">warning</span>
                <div>
                  <div>
                    {(t('mergeTargetDirty') as (n: number) => string)(
                      guard.dirty,
                    )}
                  </div>
                </div>
                <div className="svn-auth-actions svn-merge-actions">
                  <span className="svn-merge-inline-status" />
                  <div className="svn-merge-action-buttons">
                    <Button onClick={onUpdateTarget}>
                      {t('mergeUpdateFirst') as string}
                    </Button>
                    <Button onClick={() => void loadRevisions()}>
                      {t('mergeRecheck') as string}
                    </Button>
                    <Button
                      variant="primary"
                      onClick={() => void loadRevisions(true)}
                    >
                      {t('mergeProceedDirty') as string}
                    </Button>
                  </div>
                </div>
              </div>
            ) : loading ? (
              <div className="svn-auth-hint">
                {t('mergeLoadingRevs') as string}
              </div>
            ) : eligible ? (
              <>
                <div className="svn-merge-revbar">
                  <span>
                    {(t('mergeRevsFound') as (n: number) => string)(
                      eligible.length,
                    )}
                  </span>
                  <span className="svn-merge-merged-count">
                    {(t('mergeRevsMerged') as (n: number) => string)(
                      merged?.length ?? 0,
                    )}
                  </span>
                  <span className="svn-merge-revbar-spacer" />
                  <Button
                    onClick={() => {
                      setShowMerged((v) => !v);
                      setVisibleCount(100);
                    }}
                  >
                    {showMerged
                      ? (t('mergeHideMerged') as string)
                      : (t('mergeShowMerged') as string)}
                  </Button>
                  <Button onClick={() => setPicked(new Set(eligible))}>
                    {t('mergeSelectAll') as string}
                  </Button>
                  <Button onClick={() => setPicked(new Set())}>
                    {t('mergeSelectNone') as string}
                  </Button>
                </div>
                <RevisionList
                  entries={revisionEntries}
                  activeRevision={activeRevision}
                  onSelect={setActiveRevision}
                  checked={pickedStrings}
                  disabled={disabledStrings}
                  disabledLabel={t('mergeAlreadyMerged') as string}
                  onToggle={togglePick}
                  filter={revFilter}
                  onFilterChange={setRevFilter}
                  loading={loading}
                  emptyLabel={
                    eligible.length === 0
                      ? (t('mergeNoRevs') as string)
                      : undefined
                  }
                  showDetail
                />
                <div className="svn-log-pagination">
                  <span>
                    {(t('logEntriesShown') as (n: number) => string)(
                      visibleRevisions.length,
                    )}
                  </span>
                  <Button
                    onClick={() => setVisibleCount((v) => v + 100)}
                    disabled={!hasMoreRevisions}
                  >
                    {t('logNext100') as string}
                  </Button>
                </div>
                <div className="svn-merge-footbar">
                  <span>
                    {(t('mergeSelectedCount') as (n: number) => string)(
                      picked.size,
                    )}
                  </span>
                  <span className="svn-auth-hint">
                    {t('mergeShiftHint') as string}
                  </span>
                </div>
                {hasGap && (
                  <div className="svn-merge-warn">
                    <span className="material-symbols-outlined">info</span>
                    {t('mergeGapWarning') as string}
                  </div>
                )}
                <div className="svn-auth-actions svn-merge-actions">
                  <span className="svn-merge-inline-status" />
                  <div className="svn-merge-action-buttons">
                    <Button onClick={() => setStep('direction')}>
                      {t('mergeBack') as string}
                    </Button>
                    <Button
                      variant="primary"
                      disabled={picked.size === 0}
                      onClick={onPreview}
                    >
                      {t('mergePreviewRun') as string}
                    </Button>
                  </div>
                </div>
              </>
            ) : null}
          </div>
        )}

        {step === 'preview' && (
          <>
            {loading ? (
              <div className="svn-auth-hint">
                {t('mergePreviewRunning') as string}
              </div>
            ) : preview ? (
              <>
                <div className="svn-merge-previewhead">
                  <span>
                    {(t('mergePreviewFiles') as (n: number) => string)(
                      preview.files.length,
                    )}
                  </span>
                  <span
                    className={
                      preview.conflicts > 0
                        ? 'svn-merge-conflicts'
                        : 'svn-merge-clean'
                    }
                  >
                    {preview.conflicts > 0
                      ? (t('mergePreviewConflicts') as (n: number) => string)(
                          preview.conflicts,
                        )
                      : (t('mergePreviewClean') as string)}
                  </span>
                </div>
                <div className="svn-merge-filelist">
                  {preview.files.length === 0 ? (
                    <div className="svn-auth-hint">
                      {t('mergePreviewEmpty') as string}
                    </div>
                  ) : (
                    preview.files.map((f) => (
                      <div key={f.path} className="svn-merge-file">
                        <span
                          className={`svn-merge-file-action svn-merge-file-action--${f.action}`}
                        >
                          {f.action}
                        </span>
                        <span className="svn-merge-file-path">{f.path}</span>
                      </div>
                    ))
                  )}
                </div>
                <div className="svn-auth-hint">
                  {t('mergeNoCommitHint') as string}
                </div>
                <div className="svn-auth-actions svn-merge-actions">
                  <span className="svn-merge-inline-status" />
                  <div className="svn-merge-action-buttons">
                    <Button onClick={() => setStep('revisions')}>
                      {t('mergeBack') as string}
                    </Button>
                    <Button variant="primary" onClick={onRunMerge}>
                      {(t('mergeConfirm') as (n: number) => string)(
                        pickedSorted.length,
                      )}
                    </Button>
                  </div>
                </div>
              </>
            ) : null}
          </>
        )}

        {step === 'done' && result && (
          <>
            <div className="svn-merge-previewhead">
              <span>
                {(t('mergePreviewFiles') as (n: number) => string)(
                  result.files.length,
                )}
              </span>
              <span
                className={
                  result.conflicts > 0
                    ? 'svn-merge-conflicts'
                    : 'svn-merge-clean'
                }
              >
                {result.conflicts > 0
                  ? (t('mergeDoneConflicts') as (n: number) => string)(
                      result.conflicts,
                    )
                  : (t('mergeDoneClean') as (n: number) => string)(
                      pickedSorted.length,
                    )}
              </span>
            </div>
            <div className="svn-merge-filelist">
              {result.files.length === 0 ? (
                <div className="svn-auth-hint">
                  {t('mergePreviewEmpty') as string}
                </div>
              ) : (
                result.files.map((f) => (
                  <div key={f.path} className="svn-merge-file">
                    <span
                      className={`svn-merge-file-action svn-merge-file-action--${f.action}`}
                    >
                      {f.action}
                    </span>
                    <span className="svn-merge-file-path">{f.path}</span>
                  </div>
                ))
              )}
            </div>
            <div className="svn-auth-hint">
              {t('mergeNoCommitHint') as string}
            </div>
            <div className="svn-auth-actions">
              <Button variant="primary" onClick={onClose}>
                {t('mergeClose') as string}
              </Button>
            </div>
          </>
        )}
        <ProgressBar active={loading} className="svn-merge-progress" />
      </div>
    </div>
  );
}
