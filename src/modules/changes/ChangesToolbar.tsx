import { t } from '@nonu/app/i18n';
import { Button, Select } from '@nonu/components';

import { FileFilter } from './FileFilter.js';
import type { FilterStatus, SortBy } from './useChangesModel.js';

import './ChangesToolbar.css';

export function ListToolbar({
  filterStatus,
  sortBy,
  groupByFolder,
  query,
  onQuery,
  onFilterStatus,
  onSortBy,
  onToggleGroupByFolder,
}: {
  filterStatus: FilterStatus;
  sortBy: SortBy;
  groupByFolder: boolean;
  query: string;
  onQuery: (q: string) => void;
  onFilterStatus: (f: FilterStatus) => void;
  onSortBy: (s: SortBy) => void;
  onToggleGroupByFolder: () => void;
}) {
  const filters: { value: FilterStatus; label: string }[] = [
    { value: 'all', label: t('filterAll') as string },
    { value: 'modified', label: t('filterModified') as string },
    { value: 'unversioned', label: t('filterUnversioned') as string },
    { value: 'conflicted', label: t('filterConflicted') as string },
  ];
  return (
    <div className="svn-list-toolbar">
      <div className="svn-list-toolbar-filters">
        {filters.map((f) => (
          <Button
            key={f.value}
            variant="mode"
            active={filterStatus === f.value}
            onClick={() => onFilterStatus(f.value)}
          >
            {f.label}
          </Button>
        ))}
      </div>
      <Button
        variant="mode"
        active={groupByFolder}
        aria-pressed={groupByFolder}
        title={t('groupByFolder') as string}
        onClick={onToggleGroupByFolder}
      >
        <span className="material-symbols-outlined">folder</span>
      </Button>
      <Select
        className="svn-sort-select"
        value={sortBy}
        options={[
          { value: 'name', label: t('sortByName') as string },
          { value: 'mtime', label: t('sortByMtime') as string },
          { value: 'status', label: t('sortByStatus') as string },
        ]}
        onChange={(v) => onSortBy(v as SortBy)}
        variant="filled"
        size="small"
      />
      <FileFilter
        className="svn-list-toolbar-search"
        value={query}
        onChange={onQuery}
        placeholder={t('filterFiles') as string}
        clearLabel={t('clearFilter') as string}
      />
    </div>
  );
}

export function BulkToolbar({
  count,
  hiddenCount,
  busy,
  canAdd,
  canRevert,
  canDeleteLocal,
  canDeleteSvn,
  onAdd,
  onRevert,
  onDelete,
  onClear,
}: {
  count: number;
  hiddenCount: number;
  busy: boolean;
  canAdd: boolean;
  canRevert: boolean;
  canDeleteLocal: boolean;
  canDeleteSvn: boolean;
  onAdd: () => void;
  onRevert: () => void;
  onDelete: () => void;
  onClear: () => void;
}) {
  return (
    <div className="svn-bulk-toolbar">
      <span
        className="svn-bulk-toolbar-count"
        title={
          hiddenCount > 0 ? (t('selectedHiddenHint') as string) : undefined
        }
      >
        {(t('selected') as (n: number) => string)(count)}
        {hiddenCount > 0 &&
          ` ${(t('selectedHidden') as (n: number) => string)(hiddenCount)}`}
      </span>
      <Button size="sm" onClick={onAdd} disabled={busy || !canAdd}>
        <span className="material-symbols-outlined">add</span>
        {t('add') as string}
      </Button>
      <Button
        size="sm"
        variant="danger"
        onClick={onRevert}
        disabled={busy || !canRevert}
      >
        <span className="material-symbols-outlined">undo</span>
        {t('revert') as string}
      </Button>
      <Button
        size="sm"
        variant="danger"
        onClick={onDelete}
        disabled={busy || (!canDeleteLocal && !canDeleteSvn)}
      >
        <span className="material-symbols-outlined">delete</span>
        {t('delete') as string}
      </Button>
      <Button
        variant="ghost"
        className="svn-bulk-toolbar-clear"
        onClick={onClear}
      >
        {t('clearSelection') as string}
      </Button>
    </div>
  );
}
