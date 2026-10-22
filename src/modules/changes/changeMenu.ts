import { t } from '@nonu/app/i18n';
import type { ContextMenuItem } from '@nonu/components';
import type { SvnChange } from '@nonu/svn';
import type { Dispatch, RefObject, SetStateAction } from 'react';

import type { useFileActions } from './useFileActions.js';

type Actions = Pick<
  ReturnType<typeof useFileActions>,
  | 'onAdd'
  | 'onRevert'
  | 'onDeleteSmart'
  | 'onUndoDelete'
  | 'hasUndoDelete'
  | 'onLock'
  | 'onUnlock'
  | 'onBreakLock'
  | 'onIgnore'
  | 'onIgnoreMultiple'
  | 'onResolveAny'
> & {
  onLog: (path: string) => void;
  onBlame: (path: string) => void;
  copyPath: (path: string) => Promise<void>;
  absolutePath: (path: string) => string;
  openLocalFile: (path: string) => Promise<void>;
  showInExplorer: (path: string) => void;
  setActive: (path: string) => void;
  setHighlighted: Dispatch<SetStateAction<Set<string>>>;
  setSelected: Dispatch<SetStateAction<Set<string>>>;
  selectionAnchorRef: RefObject<string | null>;
};
const addSeparator = (items: ContextMenuItem[]) => {
  if (items.length && !items.at(-1)?.separator) items.push({ separator: true });
};
export function buildChangeMenu(
  change: SvnChange,
  changes: SvnChange[],
  highlighted: Set<string>,
  {
    onAdd,
    onRevert,
    onDeleteSmart,
    onUndoDelete,
    hasUndoDelete,
    onLock,
    onUnlock,
    onBreakLock,
    onIgnore,
    onIgnoreMultiple,
    onResolveAny,
    onLog,
    onBlame,
    copyPath,
    absolutePath,
    openLocalFile,
    showInExplorer,
    setActive,
    setHighlighted,
    setSelected,
    selectionAnchorRef,
  }: Actions,
  selectionPaths: string[] = [change.path],
): ContextMenuItem[] {
  const contextSet =
    highlighted.size > 1 && highlighted.has(change.path) ? highlighted : null;
  const isMulti = contextSet !== null;
  const items: ContextMenuItem[] = [];

  if (isMulti) {
    const multiChanges = changes.filter((c) => contextSet!.has(c.path));
    const multiUnversioned = multiChanges.filter(
      (c) => c.status === 'unversioned',
    );
    const multiRevertable = multiChanges.filter(
      (c) => c.status !== 'unversioned',
    );
    const multiVersioned = multiChanges.filter(
      (c) => c.status !== 'unversioned',
    );

    // Selection group
    items.push({
      label: (t('ctxDeselectAll') as (n: number) => string)(contextSet!.size),
      icon: 'deselect',
      onClick: () => setHighlighted(new Set()),
    });
    items.push({
      label: t('ctxSelectAll') as string,
      icon: 'select_all',
      onClick: () => setHighlighted(new Set(changes.map((c) => c.path))),
    });

    // Version Control Actions group
    addSeparator(items);
    if (multiUnversioned.length > 0) {
      items.push({
        label: (t('ctxAdd_n') as (n: number) => string)(
          multiUnversioned.length,
        ),
        icon: 'add',
        onClick: () => onAdd(multiUnversioned.map((c) => c.path)),
      });
    }
    if (multiRevertable.length > 0) {
      items.push({
        label: (t('ctxRevert_n') as (n: number) => string)(
          multiRevertable.length,
        ),
        icon: 'undo',
        onClick: () => onRevert(multiRevertable.map((c) => c.path)),
      });
    }
    {
      const deletable = [...multiVersioned, ...multiUnversioned].filter(
        (c) => !['deleted', 'missing'].includes(c.status),
      );
      if (deletable.length > 0) {
        items.push({
          label: (t('ctxDelete_n') as (n: number) => string)(deletable.length),
          icon: 'delete',
          onClick: () => onDeleteSmart(deletable.map((c) => c.path)),
        });
      }
    }

    // Lock group
    {
      const lockable = multiVersioned.filter(
        (c) =>
          !c.lockedByMe && !['deleted', 'missing', 'added'].includes(c.status),
      );
      const unlockable = multiVersioned.filter((c) => c.lockedByMe);
      if (lockable.length > 0 || unlockable.length > 0) addSeparator(items);
      if (lockable.length > 0) {
        items.push({
          label: t('ctxLock') as string,
          icon: 'lock',
          onClick: () => onLock(lockable.map((c) => c.path)),
        });
      }
      if (unlockable.length > 0) {
        items.push({
          label: t('ctxUnlock') as string,
          icon: 'lock_open',
          onClick: () => onUnlock(unlockable.map((c) => c.path)),
        });
      }
    }

    // Ignore group
    if (multiUnversioned.length > 0) {
      addSeparator(items);
      items.push({
        label: (t('ctxIgnore_n') as (n: number) => string)(
          multiUnversioned.length,
        ),
        icon: 'visibility_off',
        onClick: () => onIgnoreMultiple(multiUnversioned.map((c) => c.path)),
      });
    }

    // Copy group
    addSeparator(items);
    items.push({
      label: t('ctxCopyPaths') as string,
      icon: 'content_copy',
      onClick: () =>
        void navigator.clipboard.writeText(Array.from(contextSet!).join('\n')),
    });
  } else {
    // File Operations group
    if (!['deleted', 'missing'].includes(change.status)) {
      items.push({
        label: t('ctxOpenFile') as string,
        icon: 'description',
        onClick: () =>
          void openLocalFile(absolutePath(change.path)).catch(() => {}),
      });
    }
    if (!['deleted', 'missing'].includes(change.status)) {
      items.push({
        label:
          change.status === 'unversioned'
            ? (t('ctxPreviewFile') as string)
            : (t('ctxShowDiff') as string),
        icon: 'visibility',
        onClick: () => setActive(change.path),
      });
    }

    // Version Control Actions group
    addSeparator(items);
    if (change.status === 'unversioned') {
      items.push({
        label: t('ctxAdd') as string,
        icon: 'add',
        onClick: () => onAdd([change.path]),
      });
    }
    if (change.status === 'deleted' && hasUndoDelete(change.path)) {
      items.push({
        label: t('ctxUndoDelete') as string,
        icon: 'restore',
        onClick: () => onUndoDelete([change.path]),
      });
    }
    if (change.status !== 'unversioned') {
      items.push({
        label: t('ctxRevert') as string,
        icon: 'undo',
        onClick: () => onRevert([change.path]),
      });
    }
    if (!['deleted', 'missing'].includes(change.status)) {
      items.push({
        label: t('ctxDelete') as string,
        icon: 'delete',
        onClick: () => onDeleteSmart([change.path]),
      });
    }
    if (change.status === 'conflicted') {
      items.push({
        label: t('ctxResolve') as string,
        icon: 'check_circle',
        onClick: () => onResolveAny(change),
      });
    }
    if (
      change.status !== 'unversioned' &&
      !['deleted', 'missing', 'added'].includes(change.status)
    ) {
      if (change.lockedByMe) {
        items.push({
          label: t('ctxUnlock') as string,
          icon: 'lock_open',
          onClick: () => onUnlock([change.path]),
        });
      } else {
        items.push({
          label: t('ctxLock') as string,
          icon: 'lock',
          onClick: () => onLock([change.path]),
        });
      }
    }
    if (change.status !== 'unversioned' && !change.lockedByMe) {
      items.push({
        label: t('ctxBreakLock') as string,
        icon: 'lock_reset',
        onClick: () => onBreakLock(change.path),
      });
    }

    // History & Analysis group
    addSeparator(items);
    if (change.status !== 'unversioned') {
      items.push({
        label: t('ctxLogForFile') as string,
        icon: 'history',
        onClick: () => onLog(change.path),
      });
    }
    if (change.status !== 'unversioned' && change.status !== 'added') {
      items.push({
        label: t('ctxBlame') as string,
        icon: 'person_search',
        onClick: () => onBlame(change.path),
      });
    }

    // Ignore group
    if (change.status === 'unversioned') {
      addSeparator(items);
      const isFolder = change.code === 'D';
      if (isFolder) {
        items.push({
          label: t('ctxIgnoreFolder') as string,
          icon: 'visibility_off',
          onClick: () => onIgnore(change.path, false),
        });
        items.push({
          label: t('ctxIgnoreFolderRecursive') as string,
          icon: 'visibility_off',
          onClick: () => onIgnore(change.path, true),
        });
      } else {
        items.push({
          label: t('ctxIgnore') as string,
          icon: 'visibility_off',
          onClick: () => onIgnore(change.path, false),
        });
      }
    }

    // Selection group
    addSeparator(items);
    items.push({
      label: t('ctxSelectOnly') as string,
      icon: 'check_box',
      onClick: () => {
        setSelected(new Set(selectionPaths));
        selectionAnchorRef.current = selectionPaths[0] ?? null;
      },
    });
    items.push({
      label: t('ctxSelectAll') as string,
      icon: 'select_all',
      onClick: () => setSelected(new Set(changes.map((c) => c.path))),
    });

    // Copy group
    addSeparator(items);
    items.push({
      label: t('ctxCopyRelPath') as string,
      icon: 'content_copy',
      onClick: () => void copyPath(change.path),
    });
    items.push({
      label: t('ctxCopyAbsPath') as string,
      icon: 'content_copy',
      onClick: () => void copyPath(absolutePath(change.path)),
    });

    // System group
    addSeparator(items);
    items.push({
      label: t('ctxShowInExplorer') as string,
      icon: 'folder_open',
      onClick: () => showInExplorer(change.path),
    });
  }

  return items;
}

const normalizedPath = (path: string) =>
  path
    .replace(/[\\/]+$/, '')
    .replace(/\\/g, '/')
    .toLowerCase();

/** Gives a grouping header the metadata of a folder row: versioned by default, its own status when one exists. */
export function folderGroupChange(
  path: string,
  changes: SvnChange[],
): SvnChange {
  const key = normalizedPath(path);
  const existing = changes.find(
    (change) => normalizedPath(change.path) === key,
  );
  return existing
    ? { ...existing, code: 'D' }
    : { path, status: 'modified', code: 'D', committable: true };
}
