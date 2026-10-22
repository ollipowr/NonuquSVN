import type { SvnChange } from '@nonu/svn';
import { useMemo } from 'react';

export type FilterStatus = 'all' | 'modified' | 'unversioned' | 'conflicted';
export type SortBy = 'name' | 'mtime' | 'status';
export function useChangesModel({
  changes,
  filterStatus,
  showIgnored,
  sortBy,
  mtimes,
  query,
  groupByFolder,
  collapsedFolders,
  selected,
}: {
  changes: SvnChange[];
  filterStatus: FilterStatus;
  showIgnored: boolean;
  sortBy: SortBy;
  mtimes: Map<string, number>;
  query: string;
  groupByFolder: boolean;
  collapsedFolders: Set<string>;
  selected: Set<string>;
}) {
  const filteredAndSorted = useMemo(() => {
    const needle = query.trim().toLowerCase().replace(/\\/g, '/');
    let list = changes.filter((c) => {
      if (!showIgnored && c.status === 'ignored') return false;
      if (needle && !c.path.toLowerCase().replace(/\\/g, '/').includes(needle))
        return false;
      if (filterStatus === 'all') return true;
      return c.status === filterStatus;
    });
    if (sortBy === 'name') {
      list = [...list].sort((a, b) => a.path.localeCompare(b.path));
    } else if (sortBy === 'mtime') {
      const norm = (p: string) => p.replace(/\\/g, '/');
      list = [...list].sort(
        (a, b) =>
          (mtimes.get(norm(b.path)) ?? 0) - (mtimes.get(norm(a.path)) ?? 0),
      );
    } else if (sortBy === 'status') {
      const order: Record<string, number> = {
        conflicted: 0,
        modified: 1,
        added: 2,
        deleted: 3,
        unversioned: 4,
        ignored: 5,
      };
      list = [...list].sort(
        (a, b) =>
          (order[a.status] ?? 9) - (order[b.status] ?? 9) ||
          a.path.localeCompare(b.path),
      );
    }
    return list;
  }, [changes, filterStatus, showIgnored, sortBy, mtimes, query]);

  const folderGroups = useMemo(() => {
    const groups = new Map<string, typeof filteredAndSorted>();
    if (!groupByFolder) {
      groups.set('.', filteredAndSorted);
      return groups;
    }
    for (const c of filteredAndSorted) {
      const slash = Math.max(c.path.lastIndexOf('/'), c.path.lastIndexOf('\\'));
      const dir = slash === -1 ? '.' : c.path.slice(0, slash);
      if (!groups.has(dir)) groups.set(dir, []);
      groups.get(dir)!.push(c);
    }
    return groups;
  }, [filteredAndSorted, groupByFolder]);

  // Paths in the exact order they are rendered (filtered, sorted, grouped, expanded only).
  // Range selections must use this, not `changes`, or they pick up rows that aren't adjacent on screen.
  const visiblePaths = useMemo(() => {
    const out: string[] = [];
    for (const [dir, items] of folderGroups) {
      if (collapsedFolders.has(dir) && folderGroups.size > 1) continue;
      for (const c of items) out.push(c.path);
    }
    return out;
  }, [folderGroups, collapsedFolders]);

  // Same set the header counts, collapsed folders included.
  const filteredPaths = useMemo(
    () => filteredAndSorted.map((c) => c.path),
    [filteredAndSorted],
  );
  const allSelected =
    filteredPaths.length > 0 && filteredPaths.every((p) => selected.has(p));

  // Bulk actions and commit act only on selected files the active filter shows.
  // Selected-but-filtered-out files stay selected and are never committed or reverted silently.
  const visibleSelectedPaths = useMemo(() => {
    const shown = new Set(filteredAndSorted.map((c) => c.path));
    return changes.filter((c) => selected.has(c.path) && shown.has(c.path));
  }, [changes, selected, filteredAndSorted]);
  const hiddenSelectedCount = selected.size - visibleSelectedPaths.length;

  return {
    filteredAndSorted,
    filteredPaths,
    folderGroups,
    visiblePaths,
    allSelected,
    visibleSelectedPaths,
    hiddenSelectedCount,
  };
}
