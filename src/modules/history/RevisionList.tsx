import { t } from '@nonu/app/i18n';
import {
  Splitter,
  StructuredListRow,
  useListSelection,
} from '@nonu/components';
import { useResize } from '@nonu/hooks';
import { FileChangeIndicator, FileFilter } from '@nonu/modules/changes';
import type { SvnLogEntry } from '@nonu/svn';
import { useMemo, useRef, useState } from 'react';

import { actionInfo } from './LogView.js';

import './LogView.css';

const DETAIL_DEFAULT_HEIGHT = 220;
const DETAIL_MIN_HEIGHT = 120;

export interface RevisionListEntry {
  revision: string;
  author: string;
  date: string;
  message: string;
  paths?: { action: string; path: string; copyFromPath?: string }[];
}

export interface RevisionListProps {
  entries: RevisionListEntry[];
  activeRevision?: string;
  onSelect: (revision: string) => void;
  /** When provided, rows get checkboxes. checked = set of selected revisions. */
  checked?: Set<string>;
  /** Revisions that are disabled (already merged etc.). */
  disabled?: Set<string>;
  disabledLabel?: string;
  onToggle?: (revision: string, shift: boolean) => void;
  filter: string;
  onFilterChange: (value: string) => void;
  loading?: boolean;
  emptyLabel?: string;
  /** Show the detail panel (commit message + file list) below the list. */
  showDetail?: boolean;
}

const formatDate = (value: string) => {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString();
};

export function RevisionList({
  entries,
  activeRevision,
  onSelect,
  checked,
  disabled,
  disabledLabel,
  onToggle,
  filter,
  onFilterChange,
  loading,
  emptyLabel,
  showDetail,
}: RevisionListProps) {
  const filtered = useMemo(() => {
    const needle = filter.trim().toLocaleLowerCase();
    if (!needle) return entries;
    return entries.filter((e) =>
      [
        `r${e.revision}`,
        e.author,
        e.message,
        ...(e.paths ?? []).map((p) => p.path),
      ].some((v) => v.toLocaleLowerCase().includes(needle)),
    );
  }, [entries, filter]);

  const hasCheckboxes = checked !== undefined;
  const active =
    entries.find((e) => e.revision === activeRevision) ?? filtered[0];
  // LogView has no batch action yet, but keeping a normal list selection makes
  // navigation and range selection consistent with the Changes list.
  const listRef = useRef<HTMLDivElement | null>(null);
  const selection = useListSelection({
    keys: filtered.map((item) => item.revision),
    listRef,
    activeKey: activeRevision,
    onNavigate: onSelect,
  });

  const [detailHeight, setDetailHeight] = useState(DETAIL_DEFAULT_HEIGHT);
  const startDetailDrag = useResize({
    start: (event) => {
      const pane = event.currentTarget.closest('.svn-log-left-pane');
      const startY = event.clientY;
      return pane
        ? {
            value: (next) => detailHeight + startY - next.clientY,
            min: DETAIL_MIN_HEIGHT,
            max: () => pane.getBoundingClientRect().height - 120,
          }
        : null;
    },
    onChange: setDetailHeight,
  });

  return (
    <div className={showDetail ? 'svn-log-left-pane' : 'svn-revision-list'}>
      <div
        className={showDetail ? 'svn-log-list-pane' : 'svn-revision-list-pane'}
      >
        <div className="svn-log-filter">
          <FileFilter
            value={filter}
            onChange={onFilterChange}
            placeholder={t('filterFiles') as string}
            clearLabel={t('clearFilter') as string}
          />
        </div>
        <div
          className="svn-log-list"
          ref={listRef}
          role="listbox"
          aria-multiselectable={!hasCheckboxes || undefined}
          tabIndex={0}
          onKeyDown={selection.onKeyDown}
        >
          {loading && entries.length === 0 && (
            <div className="svn-log-state">{t('refreshing') as string}</div>
          )}
          {!loading && filtered.length === 0 && (
            <div className="svn-log-state">
              {emptyLabel ?? (t('noLogEntries') as string)}
            </div>
          )}
          {filtered.map((item) => {
            const isDisabled = disabled?.has(item.revision) ?? false;
            const isChecked = checked?.has(item.revision) ?? false;
            const isHighlighted = selection.highlighted.has(item.revision);
            const kinds = item.paths
              ? Array.from(
                  new Set(item.paths.map((p) => actionInfo(p).kind)),
                ).slice(0, 4)
              : [];
            const columns = hasCheckboxes
              ? '20px 52px 44px minmax(60px, .4fr) 100px minmax(80px, 1fr) 80px'
              : '52px 44px minmax(56px, .45fr) 108px minmax(140px, 3fr)';
            return (
              <StructuredListRow
                key={item.revision}
                columns={columns}
                active={activeRevision === item.revision}
                className={`svn-log-row${isDisabled ? ' svn-log-row--disabled' : ''}`}
                data-list-key={item.revision}
                role="option"
                aria-selected={hasCheckboxes ? isChecked : isHighlighted}
                tabIndex={-1}
                onClick={(event) => {
                  selection.select(event, item.revision);
                  onSelect(item.revision);
                }}
              >
                {hasCheckboxes && (
                  <input
                    type="checkbox"
                    checked={isDisabled || isChecked}
                    disabled={isDisabled}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (onToggle && !isDisabled)
                        onToggle(item.revision, e.shiftKey);
                    }}
                    readOnly
                  />
                )}
                <span className="svn-log-row-revision">r{item.revision}</span>
                <span className="svn-log-row-symbols">
                  {kinds.map((kind) => (
                    <FileChangeIndicator key={kind} kind={kind} />
                  ))}
                </span>
                <span className="svn-log-row-author">{item.author || '-'}</span>
                <time className="svn-log-row-date">
                  {formatDate(item.date)}
                </time>
                <span
                  className="svn-log-row-message"
                  title={item.message || '-'}
                >
                  {item.message || '-'}
                </span>
                {hasCheckboxes && (
                  <span className="svn-log-row-badge">
                    {isDisabled ? (disabledLabel ?? '') : ''}
                  </span>
                )}
              </StructuredListRow>
            );
          })}
        </div>
      </div>

      {showDetail && (
        <>
          <Splitter
            direction="v"
            onMouseDown={startDetailDrag}
            variant="ghost"
          />
          <article className="svn-log-detail" style={{ height: detailHeight }}>
            {active ? (
              <>
                <div className="svn-log-detail-meta">
                  <strong>r{active.revision}</strong>
                  <span>{active.author || '-'}</span>
                  <time>{formatDate(active.date)}</time>
                </div>
                <h3>{t('logCommitMessage') as string}</h3>
                <div className="svn-log-detail-message">
                  {active.message || '-'}
                </div>
                {active.paths && active.paths.length > 0 && (
                  <>
                    <h3>
                      {(t('logChangedFiles') as (n: number) => string)(
                        active.paths.length,
                      )}
                    </h3>
                    <div className="svn-log-files">
                      {active.paths.map((p, i) => {
                        const info = actionInfo(p);
                        return (
                          <div className="svn-log-file" key={`${p.path}-${i}`}>
                            <FileChangeIndicator
                              kind={info.kind}
                              label={info.label}
                            />
                            <span title={p.path}>{p.path}</span>
                            {p.copyFromPath && (
                              <small>&larr; {p.copyFromPath}</small>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}
              </>
            ) : (
              <div className="svn-log-state">{t('noLogEntries') as string}</div>
            )}
          </article>
        </>
      )}
    </div>
  );
}

/** Convert a SvnLogEntry to a RevisionListEntry (for LogView usage). */
export function svnLogEntryToRevision(e: SvnLogEntry): RevisionListEntry {
  return {
    revision: e.revision,
    author: e.author,
    date: e.date,
    message: e.message,
    paths: e.paths,
  };
}
