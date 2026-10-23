import { t } from '@nonu/app/i18n';
import {
  Button,
  ContextMenu,
  type ContextMenuItem,
  ProgressBar,
  Splitter,
  ViewHeader,
} from '@nonu/components';
import { TextInput } from '@nonu/components/ui/TextInput';
import { useResize } from '@nonu/hooks';
import {
  type DiffFiles,
  type DiffHeaders,
  DiffPanel,
  type DiffPanelHandle,
  FileChangeIndicator,
  type FileChangeKind,
  type RevisionInfo,
} from '@nonu/modules/changes';
import type { SvnLogEntry, SvnLogPath } from '@nonu/svn';
import React, { useEffect, useMemo, useRef, useState } from 'react';

import { RevisionList, svnLogEntryToRevision } from './RevisionList.js';

import './LogView.css';

type Query = {
  limit?: number;
  from?: string;
  to?: string;
  before?: string;
  revision?: string;
  verbose?: boolean;
};
type Props = {
  diffMode: 'inline' | 'split';
  onDiffModeChange: (mode: 'inline' | 'split') => void;
  load: (query: Query) => Promise<SvnLogEntry[]>;
  loadRevisionFiles: (
    revision: string,
    path: string,
    action: string,
  ) => Promise<DiffFiles & { previous?: SvnLogEntry }>;
  onOpenFile?: (path: string) => void | Promise<void>;
  onLogFile: (
    path: string,
    revision: string,
    action: string,
  ) => void | Promise<void>;
  onBlameFile: (
    path: string,
    revision: string,
    action: string,
  ) => void | Promise<void>;
  onShowInExplorer?: (path: string) => void | Promise<void>;
};
const actions: Record<string, { kind: FileChangeKind; label: () => string }> = {
  A: { kind: 'added', label: () => t('statusAdded') },
  D: { kind: 'deleted', label: () => t('statusDeleted') },
  M: { kind: 'modified', label: () => t('statusModified') },
  R: { kind: 'replaced', label: () => t('statusReplacedMerged') },
};
export const actionInfo = (path: { action: string; copyFromPath?: string }) => {
  if (path.copyFromPath)
    return { kind: 'merged' as const, label: t('statusMergedCopied') };
  const action = actions[path.action];
  return action
    ? { kind: action.kind, label: action.label() }
    : { kind: 'unknown' as const, label: path.action };
};
const date = (value: string) => {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
};
// Local calendar day (YYYY-MM-DD) as used by <input type="date">.
const toDateValue = (iso: string) => {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}`;
};
const revisionHeader = (
  revision: string,
  entry?: SvnLogEntry,
): RevisionInfo => ({
  revision,
  date: entry?.date ? date(entry.date) : '-',
  author: entry?.author || '-',
});

export function LogView({
  diffMode,
  onDiffModeChange,
  load,
  loadRevisionFiles,
  onOpenFile,
  onLogFile,
  onBlameFile,
  onShowInExplorer,
}: Props) {
  const [syncDiffScroll, setSyncDiffScroll] = useState(true);
  const [entries, setEntries] = useState<SvnLogEntry[]>([]);
  const [revision, setRevision] = useState<string>();
  const [path, setPath] = useState<SvnLogPath>();
  const diffIsNewFile = path?.action === 'A';
  const [query, setQuery] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [loading, setLoading] = useState(false);
  const [paging, setPaging] = useState(false);
  const [error, setError] = useState('');
  const [diff, setDiff] = useState<DiffFiles | null>(null);
  const [diffHeaders, setDiffHeaders] = useState<DiffHeaders>();
  const [diffLoading, setDiffLoading] = useState(false);
  const [diffError, setDiffError] = useState('');
  const diffRef = useRef<DiffPanelHandle>(null);
  const [width, setWidth] = useState(34);
  const [detailWidth, setDetailWidth] = useState(30);
  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    items: ContextMenuItem[];
  }>();
  const generation = useRef(0);
  const diffGeneration = useRef(0);
  const refresh = async (
    next: Query = { limit: 100, from, to, verbose: true },
  ) => {
    const id = ++generation.current;
    // A new refresh cancels any paging still in flight (see fetchOlder).
    setPaging(false);
    setLoading(true);
    setError('');
    try {
      const result = await load(next);
      if (id !== generation.current) return;
      setEntries(result);
      setRevision((current) =>
        result.some((item) => item.revision === current)
          ? current
          : result[0]?.revision,
      );
    } catch (reason) {
      if (id === generation.current)
        setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (id === generation.current) setLoading(false);
    }
  };
  useEffect(() => {
    void refresh({ limit: 100, verbose: true });
  }, []);
  // Prefill the range with the days covered by the first visible revisions.
  const rangeDefaulted = useRef(false);
  const fromInput = useRef<HTMLInputElement>(null);
  const toInput = useRef<HTMLInputElement>(null);
  // Sets the date fields to the first and last day of the given revisions.
  const coverDays = (list: SvnLogEntry[]) => {
    const days = list
      .map((item) => toDateValue(item.date))
      .filter(Boolean)
      .sort();
    if (days.length === 0) return;
    setFrom(days[0]);
    setTo(days[days.length - 1]);
  };
  useEffect(() => {
    if (rangeDefaulted.current || entries.length === 0) return;
    rangeDefaulted.current = true;
    coverDays(entries);
  }, [entries]);
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return needle
      ? entries.filter((item) =>
          [
            item.revision,
            item.author,
            item.message,
            ...(item.paths ?? []).map((itemPath) => itemPath.path),
          ].some((value) => value.toLocaleLowerCase().includes(needle)),
        )
      : entries;
  }, [entries, query]);
  const revisionEntries = useMemo(
    () => filtered.map(svnLogEntryToRevision),
    [filtered],
  );
  const active =
    entries.find((item) => item.revision === revision) ?? filtered[0];
  useEffect(() => {
    ++diffGeneration.current;
    setPath(undefined);
    setDiff(null);
    setDiffHeaders(undefined);
    setDiffError('');
    setDiffLoading(false);
  }, [revision]);
  useEffect(
    () => () => {
      ++diffGeneration.current;
    },
    [],
  );
  const showDiff = async (itemPath: SvnLogPath) => {
    if (!active) return;
    const id = ++diffGeneration.current;
    setPath(itemPath);
    setDiff(null);
    setDiffHeaders(undefined);
    setDiffLoading(true);
    setDiffError('');
    try {
      const result = await loadRevisionFiles(
        active.revision,
        itemPath.path,
        itemPath.action,
      );
      const { previous: oldEntry, ...files } = result;
      if (id === diffGeneration.current) {
        setDiff(files);
        setDiffHeaders({
          old:
            itemPath.action === 'A'
              ? undefined
              : revisionHeader(
                  oldEntry?.revision ??
                    String(Math.max(0, Number(active.revision) - 1)),
                  oldEntry,
                ),
          new: revisionHeader(active.revision, active),
        });
      }
    } catch (reason) {
      if (id === diffGeneration.current)
        setDiffError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (id === diffGeneration.current) setDiffLoading(false);
    }
  };
  const runAction = async (action: () => void | Promise<void>) => {
    setError('');
    try {
      await action();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };
  const openMenu = (event: React.MouseEvent, itemPath: SvnLogPath) => {
    event.preventDefault();
    setMenu({
      x: event.clientX,
      y: event.clientY,
      items: [
        ...(onOpenFile
          ? [
              {
                label: t('ctxOpenFile') as string,
                icon: 'description',
                onClick: () => void runAction(() => onOpenFile(itemPath.path)),
              },
            ]
          : []),
        {
          label: t('ctxShowDiff') as string,
          icon: 'visibility',
          onClick: () => showDiff(itemPath),
        },
        { separator: true },
        {
          label: t('ctxLogForFile') as string,
          icon: 'history',
          onClick: () =>
            void runAction(() =>
              onLogFile(itemPath.path, active!.revision, itemPath.action),
            ),
        },
        {
          label: t('ctxBlame') as string,
          icon: 'person_search',
          onClick: () =>
            void runAction(() =>
              onBlameFile(itemPath.path, active!.revision, itemPath.action),
            ),
        },
        { separator: true },
        {
          label: t('ctxCopyRelPath') as string,
          icon: 'content_copy',
          onClick: () =>
            void runAction(() => navigator.clipboard.writeText(itemPath.path)),
        },
        { separator: true },
        ...(onShowInExplorer
          ? [
              {
                label: t('ctxShowInExplorer') as string,
                icon: 'folder_open',
                onClick: () =>
                  void runAction(() => onShowInExplorer(itemPath.path)),
              },
            ]
          : []),
      ],
    });
  };
  const resize = useResize({
    start: (event) => {
      const bounds = event.currentTarget.parentElement?.getBoundingClientRect();
      return bounds?.width
        ? {
            value: (next) =>
              ((next.clientX - bounds.left) / bounds.width) * 100,
            min: 20,
            max: () => 100 - detailWidth - 20,
          }
        : null;
    },
    onChange: setWidth,
  });
  const resizeDetail = useResize({
    start: (event) => {
      const bounds = event.currentTarget.parentElement?.getBoundingClientRect();
      return bounds?.width
        ? {
            value: (next) =>
              ((next.clientX - bounds.left) / bounds.width) * 100 - width,
            min: 15,
            max: () => 100 - width - 20,
          }
        : null;
    },
    onChange: setDetailWidth,
  });
  // Loads older revisions in pages of 100 (`all` keeps going until history ends). Paging ignores the date range.
  const fetchOlder = async (all: boolean) => {
    const id = ++generation.current;
    setPaging(true);
    setError('');
    try {
      let current = entries;
      for (;;) {
        const before = current.at(-1)?.revision;
        if (!before) break;
        const next = await load({ limit: 100, before, verbose: true });
        if (id !== generation.current) return;
        const fresh = next.filter(
          (item) => !current.some((old) => old.revision === item.revision),
        );
        current = [...current, ...fresh];
        if (!all || next.length < 100 || fresh.length === 0) break;
      }
      setEntries(current);
      coverDays(current);
    } catch (reason) {
      if (id === generation.current)
        setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (id === generation.current) setPaging(false);
    }
  };
  return (
    <section className="svn-log-view">
      <ViewHeader title={t('viewLogs') as string}>
        <Button
          icon
          title={t('refresh') as string}
          onClick={() => void refresh()}
          disabled={loading}
        >
          <span className="material-symbols-outlined">refresh</span>
        </Button>
      </ViewHeader>
      {error && (
        <div className="svn-log-state svn-log-state--error">{error}</div>
      )}
      <div
        className="svn-log-layout"
        style={
          {
            '--svn-log-list-width': `${width}%`,
            '--svn-log-detail-width': `${detailWidth}%`,
          } as React.CSSProperties
        }
      >
        <div className="svn-log-left-pane">
          <div className="svn-log-list-pane">
            <div className="svn-log-range">
              <label>
                <span>{t('logDateFrom') as string}</span>
                <div className="svn-log-range-field">
                  <TextInput
                    ref={fromInput}
                    type="date"
                    size="sm"
                    mono
                    value={from}
                    onChange={setFrom}
                    onBlur={() =>
                      void refresh({ limit: 100, from, to, verbose: true })
                    }
                  />
                  <button
                    type="button"
                    className="svn-log-range-calendar"
                    title={t('logDateFrom') as string}
                    onClick={() => fromInput.current?.showPicker()}
                  >
                    <span className="material-symbols-outlined">
                      calendar_month
                    </span>
                  </button>
                </div>
              </label>
              <label>
                <span>{t('logDateTo') as string}</span>
                <div className="svn-log-range-field">
                  <TextInput
                    ref={toInput}
                    type="date"
                    size="sm"
                    mono
                    value={to}
                    onChange={setTo}
                    onBlur={() =>
                      void refresh({ limit: 100, from, to, verbose: true })
                    }
                  />
                  <button
                    type="button"
                    className="svn-log-range-calendar"
                    title={t('logDateTo') as string}
                    onClick={() => toInput.current?.showPicker()}
                  >
                    <span className="material-symbols-outlined">
                      calendar_month
                    </span>
                  </button>
                </div>
              </label>
              {(from || to) && (
                <Button
                  variant="ghost"
                  icon
                  className="svn-log-range-clear"
                  onClick={() => {
                    setFrom('');
                    setTo('');
                    void refresh({ limit: 100, verbose: true });
                  }}
                >
                  <span className="material-symbols-outlined">close</span>
                </Button>
              )}
            </div>
            <RevisionList
              entries={revisionEntries}
              activeRevision={active?.revision}
              onSelect={setRevision}
              filter={query}
              onFilterChange={setQuery}
              loading={loading && entries.length === 0}
            />
            <div className="svn-log-pagination">
              <span>
                {(t('logEntriesShown') as (n: number) => string)(
                  entries.length,
                )}
              </span>
              <Button
                onClick={() => void fetchOlder(true)}
                disabled={loading || paging || entries.length === 0}
              >
                {t('logShowAll') as string}
              </Button>
              <Button
                onClick={() => void fetchOlder(false)}
                disabled={loading || paging || entries.length === 0}
              >
                {t('logNext100') as string}
              </Button>
            </div>
            <ProgressBar active={loading || paging} />
          </div>
        </div>
        <Splitter direction="h" onMouseDown={resize} />
        <article className="svn-log-detail">
          {active ? (
            <>
              <div className="svn-log-detail-meta">
                <strong>r{active.revision}</strong>
                <span>{active.author || '-'}</span>
                <time>{date(active.date)}</time>
              </div>
              <h3>{t('logCommitMessage') as string}</h3>
              <div className="svn-log-detail-message">
                {active.message || '-'}
              </div>
              <h3>
                {(t('logChangedFiles') as (count: number) => string)(
                  active.paths?.length ?? 0,
                )}
              </h3>
              <div className="svn-log-files">
                {(active.paths ?? []).map((itemPath, index) => {
                  const info = actionInfo(itemPath);
                  return (
                    <button
                      className={`svn-log-file${path === itemPath ? ' svn-log-file--active' : ''}`}
                      key={`${itemPath.path}-${index}`}
                      onClick={() => void showDiff(itemPath)}
                      onContextMenu={(event) => openMenu(event, itemPath)}
                    >
                      <FileChangeIndicator
                        kind={info.kind}
                        label={info.label}
                      />
                      {/* RTL box: a leading "/" would render at the end */}
                      <span title={itemPath.path}>
                        {itemPath.path.replace(/^\/+/, '')}
                      </span>
                      {itemPath.copyFromPath && (
                        <small>
                          &larr; {itemPath.copyFromPath}@{itemPath.copyFromRev}
                        </small>
                      )}
                    </button>
                  );
                })}
              </div>
            </>
          ) : (
            <div className="svn-log-state">{t('noLogEntries') as string}</div>
          )}
        </article>
        <Splitter direction="h" onMouseDown={resizeDetail} />
        <section className="svn-log-diff">
          <DiffPanel
            ref={diffRef}
            path={path?.path ?? null}
            readOnly
            mode={diffMode}
            onModeChange={onDiffModeChange}
            newFile={diffIsNewFile}
            headers={diffHeaders}
            source={
              diff && path && !diffError && !diffLoading
                ? { kind: 'fixed', files: diff }
                : undefined
            }
            placeholder={
              diffError ? (
                <div className="svn-log-state svn-log-state--error">
                  {diffError}
                </div>
              ) : diffLoading ? (
                <div className="svn-log-state">{t('refreshing') as string}</div>
              ) : null
            }
          />
        </section>
      </div>
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={menu.items}
          onClose={() => setMenu(undefined)}
        />
      )}
    </section>
  );
}
