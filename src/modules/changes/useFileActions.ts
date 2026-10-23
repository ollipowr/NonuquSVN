import { t } from '@nonu/app/i18n';
import type { useConfirmation } from '@nonu/hooks';
import type { HostAdapter } from '@nonu/host/types';
import { readFileRaw, svnSetIgnoreProperty } from '@nonu/stores';
import {
  credentialArgs,
  getLockInfo,
  lockFiles,
  type OperationNotice,
  type OperationResult,
  runSvn,
  type SvnChange,
  type SvnCredentials,
  toOperationNotice as toPill,
  unlockFiles,
} from '@nonu/svn';
import { useState } from 'react';

import { hasConflictMarkers } from './conflicts.js';
import { confirmRestore } from './restoreFlow.js';
import { snapshotLocalDelete } from './snapshotLocalDelete.js';

/** Snapshot ids of deletes, keyed by working copy and path; kept until the app restarts. */
const undoableDeletes = new Map<string, { snapshotId: string }>();
const undoKey = (cwd: string, path: string) => `${cwd}|${path}`;

export function useFileActions({
  cwd,
  changes,
  host,
  run,
  showConfirm,
  removeFromList,
  patchList,
  setPill,
}: {
  cwd: string;
  changes: SvnChange[];
  host: HostAdapter;
  run: (
    label: string,
    operation: (credentials?: SvnCredentials) => Promise<OperationResult>,
  ) => Promise<void>;
  showConfirm: ReturnType<typeof useConfirmation>['show'];
  removeFromList: (paths: string[]) => void;
  patchList: (paths: string[], patch: Partial<SvnChange>) => void;
  setPill: (notice: OperationNotice) => void;
}) {
  // Optimistic updates: the list changes at once; the status refresh in `run` corrects it on failure.
  const onAdd = (paths: string[]) => {
    if (!cwd || paths.length === 0) return;
    patchList(paths, { status: 'added', code: 'A', committable: true });
    void run(t('opAdd') as string, async (credentials) => {
      const { stdout } = await runSvn(
        ['add', '--depth', 'infinity', ...paths],
        cwd,
        credentials,
      );
      return (
        stdout.trim() || (t('opAddDone') as (n: number) => string)(paths.length)
      );
    });
  };

  const onRevert = (paths: string[]) => {
    if (!cwd || paths.length === 0) return;
    void showConfirm({
      title: t('revert') as string,
      message: (t('confirmRevert') as (n: number) => string)(paths.length),
      confirmLabel: t('revert') as string,
      cancelLabel: t('authCancel') as string,
      danger: true,
      icon: 'undo',
      onConfirm: () => {
        removeFromList(paths);
        void run(t('opRevert') as string, async (credentials) => {
          const { stdout, snapshotId } = await runSvn(
            ['revert', '--depth', 'infinity', ...paths],
            cwd!,
            credentials,
          );
          return {
            text:
              stdout.trim() ||
              (t('opRevertDone') as (n: number) => string)(paths.length),
            snapshotId,
          };
        });
      },
    });
  };

  const onDelete = async (paths: string[]) => {
    if (!cwd || paths.length === 0) return;
    removeFromList(paths);
    let snapshotId = '';
    let summary = '';
    await run(t('opDelete') as string, async (credentials) => {
      const result = await runSvn(
        ['delete', '--force', ...paths],
        cwd!,
        credentials,
      );
      snapshotId = result.snapshotId ?? '';
      summary =
        result.stdout.trim() ||
        (t('opDeleteDone') as (n: number) => string)(paths.length);
      return summary;
    });
    if (!summary || !snapshotId) return;
    paths.forEach((p) => undoableDeletes.set(undoKey(cwd!, p), { snapshotId }));
    setPill({
      kind: 'success',
      text: summary,
      action: {
        label: t('undoDelete') as string,
        onClick: () => onUndoDelete(paths),
      },
    });
  };

  const onUndoDelete = (paths: string[]) => {
    if (!cwd || paths.length === 0) return;
    const bySnapshot = new Map<string, string[]>();
    for (const p of paths) {
      const entry = undoableDeletes.get(undoKey(cwd, p));
      if (entry)
        bySnapshot.set(entry.snapshotId, [
          ...(bySnapshot.get(entry.snapshotId) ?? []),
          p,
        ]);
    }
    if (bySnapshot.size === 0) return;

    const conflicts = new Set<string>();
    const undo = (keepCopies: boolean) =>
      void run(t('opUndoDelete') as string, async (credentials) => {
        const failed: string[] = [];
        for (const [snapshotId, files] of bySnapshot) {
          const kept = keepCopies ? files.filter((p) => conflicts.has(p)) : [];
          const reverting = files.filter((p) => !kept.includes(p));
          if (reverting.length > 0)
            await runSvn(['revert', ...reverting], cwd!, credentials);
          const result = await host.restoreSnapshot?.(
            snapshotId,
            files,
            keepCopies ? 'copy' : 'overwrite',
          );
          for (const p of files) {
            if (result?.failed.includes(p)) failed.push(p);
            else undoableDeletes.delete(undoKey(cwd!, p));
          }
        }
        if (failed.length > 0)
          throw new Error(
            (t('restoreFailed') as (p: string) => string)(failed.join(', ')),
          );
        return (t('opUndoDeleteDone') as (n: number) => string)(paths.length);
      });

    void (async () => {
      for (const [snapshotId, files] of bySnapshot) {
        const check = await host.restoreSnapshot?.(snapshotId, files, 'check');
        check?.conflicts.forEach((p) => conflicts.add(p));
      }
      confirmRestore(showConfirm, [...conflicts], undo);
    })().catch((err) => setPill(toPill(err)));
  };

  const hasUndoDelete = (path: string) =>
    !!cwd && undoableDeletes.has(undoKey(cwd, path));

  const onDeleteLocal = (paths: string[]) => {
    if (!cwd || paths.length === 0) return;
    void showConfirm({
      title: t('deleteLocal') as string,
      message: (t('confirmDeleteLocal') as (n: number) => string)(paths.length),
      confirmLabel: t('deleteLocal') as string,
      cancelLabel: t('authCancel') as string,
      danger: true,
      icon: 'delete_forever',
      onConfirm: () => {
        removeFromList(paths);
        void run(t('opDeleteLocal') as string, async () => {
          const snapshotId = await snapshotLocalDelete(host, cwd!, paths);
          for (const p of paths) {
            const abs = `${cwd!.replace(/[\\/]+$/, '')}\\${p.replace(/\//g, '\\')}`;
            const result = await host.exec(
              `powershell -Command "Remove-Item -LiteralPath '${abs.replace(/'/g, "''")}' -Force -Recurse"`,
              { cwd: cwd! },
            );
            if (result.exitCode !== 0) {
              throw new Error(result.stderr.trim() || `Could not delete ${p}.`);
            }
          }
          return {
            text: (t('opDeleteLocalDone') as (n: number) => string)(
              paths.length,
            ),
            snapshotId,
          };
        });
      },
    });
  };

  const onDeleteSmart = (paths: string[]) => {
    if (!cwd || paths.length === 0) return;
    const pathChanges = paths
      .map((p) => changes.find((c) => c.path === p))
      .filter(Boolean) as SvnChange[];
    const unversioned = pathChanges
      .filter((c) => c.status === 'unversioned')
      .map((c) => c.path);
    const versioned = pathChanges
      .filter((c) => c.status !== 'unversioned')
      .map((c) => c.path);
    const modified = pathChanges.filter((c) =>
      ['modified', 'conflicted', 'replaced'].includes(c.status),
    );
    const proceed = () => {
      if (versioned.length > 0) void onDelete(versioned);
      if (unversioned.length > 0) onDeleteLocal(unversioned);
    };
    if (versioned.length === 0) {
      proceed();
      return;
    }
    void showConfirm({
      title: t('delete') as string,
      message:
        modified.length > 0
          ? (t('confirmDeleteModified') as (n: number) => string)(
              modified.length,
            )
          : (t('confirmDelete') as (n: number) => string)(versioned.length),
      confirmLabel: t('delete') as string,
      cancelLabel: t('authCancel') as string,
      danger: true,
      icon: modified.length > 0 ? 'warning' : 'delete',
      onConfirm: proceed,
    });
  };

  const onResolve = (paths: string[]) => {
    if (!cwd || paths.length === 0) return;
    patchList(paths, { status: 'modified', code: 'M', committable: true });
    void run(t('opResolve') as string, async (credentials) => {
      // `svn resolve` only clears the conflict state; it does not touch the file content.
      // Refuse while conflict markers are still in the file, otherwise they get committed.
      for (const p of paths) {
        if (hasConflictMarkers(await readFileRaw(p, cwd))) {
          throw new Error((t('resolveHasMarkers') as (p: string) => string)(p));
        }
      }
      const { stdout, snapshotId } = await runSvn(
        ['resolve', '--accept', 'working', ...paths],
        cwd,
        credentials,
      );
      return {
        text:
          stdout.trim() ||
          (t('opResolveDone') as (n: number) => string)(paths.length),
        snapshotId,
      };
    });
  };

  // Tree conflicts have no in-file markers: offer keep-local or follow-incoming-delete instead.
  const [treeConflictChoice, setTreeConflictChoice] = useState<{
    path: string;
  } | null>(null);

  const onResolveTreeConflictKeepMine = (path: string) => {
    if (!cwd) return;
    setTreeConflictChoice(null);
    patchList([path], { status: 'modified', code: 'M', treeConflict: false });
    void run(t('opResolve') as string, async (credentials) => {
      const { stdout, snapshotId } = await runSvn(
        ['resolve', '--accept', 'working', path],
        cwd,
        credentials,
      );
      return {
        text: stdout.trim() || (t('opResolveDone') as (n: number) => string)(1),
        snapshotId,
      };
    });
  };

  const onResolveTreeConflictAcceptDelete = (path: string) => {
    if (!cwd) return;
    setTreeConflictChoice(null);
    removeFromList([path]);
    void run(t('opResolve') as string, async (credentials) => {
      const deleted = await runSvn(
        ['delete', '--force', path],
        cwd,
        credentials,
      );
      const { stdout } = await runSvn(
        ['resolve', '--accept', 'working', path],
        cwd,
        credentials,
      );
      return {
        text: stdout.trim() || (t('opResolveDone') as (n: number) => string)(1),
        snapshotId: deleted.snapshotId,
      };
    });
  };

  const onResolveAny = (change: SvnChange) => {
    if (change.treeConflict) setTreeConflictChoice({ path: change.path });
    else onResolve([change.path]);
  };

  const onLock = (paths: string[]) => {
    if (!cwd || paths.length === 0) return;
    patchList(paths, { lockedByMe: true });
    void run(t('opLock') as string, async (credentials) => {
      const stdout = await lockFiles(paths, cwd, credentials);
      return (
        stdout.trim() ||
        (t('opLockDone') as (n: number) => string)(paths.length)
      );
    });
  };

  const onUnlock = (paths: string[]) => {
    if (!cwd || paths.length === 0) return;
    patchList(paths, { lockedByMe: false });
    void run(t('opUnlock') as string, async (credentials) => {
      const stdout = await unlockFiles(paths, cwd, credentials);
      return (
        stdout.trim() ||
        (t('opUnlockDone') as (n: number) => string)(paths.length)
      );
    });
  };

  const onBreakLock = (path: string) => {
    if (!cwd) return;
    void (async () => {
      try {
        const lockInfo = await getLockInfo(path, cwd);
        if (!lockInfo) {
          setPill({ kind: 'info', text: t('noLockFound') as string });
          return;
        }
        void showConfirm({
          title: t('ctxBreakLock') as string,
          message: (t('confirmBreakLock') as (owner: string) => string)(
            lockInfo.owner,
          ),
          confirmLabel: t('ctxBreakLock') as string,
          cancelLabel: t('authCancel') as string,
          danger: true,
          icon: 'lock_reset',
          onConfirm: () => {
            void run(t('opUnlock') as string, async (credentials) => {
              const stdout = await lockFiles([path], cwd, credentials, {
                force: true,
              });
              return (
                stdout.trim() || (t('opUnlockDone') as (n: number) => string)(1)
              );
            });
          },
        });
      } catch (err) {
        setPill(toPill(err));
      }
    })();
  };

  const onIgnore = (path: string, recursive = false) => {
    if (!cwd) return;
    const change = changes.find((c) => c.path === path);
    const isFolder = change?.code === 'D';
    const slash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
    const parent = slash === -1 ? '.' : path.slice(0, slash);
    const name = slash === -1 ? path : path.slice(slash + 1);
    const pattern = isFolder && recursive ? `${name}/*` : name;
    removeFromList([path]);
    void run(t('opAddToIgnore') as string, async (credentials) => {
      const { stdout: existing } = await runSvn(
        ['propget', 'svn:ignore', parent],
        cwd,
        credentials,
      ).catch(() => ({ stdout: '' }));
      const lines = existing
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);
      if (!lines.includes(pattern)) lines.push(pattern);
      const out = await svnSetIgnoreProperty(
        parent,
        lines,
        cwd,
        credentialArgs(credentials),
      );
      return out.trim() || `Added "${pattern}" to svn:ignore on ${parent}.`;
    });
  };

  const onIgnoreMultiple = (paths: string[]) => {
    if (!cwd || paths.length === 0) return;
    const parentMap = new Map<string, Set<string>>();

    // Group patterns by parent directory
    for (const path of paths) {
      const change = changes.find((c) => c.path === path);
      const isFolder = change?.code === 'D';
      const slash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
      const parent = slash === -1 ? '.' : path.slice(0, slash);
      const name = slash === -1 ? path : path.slice(slash + 1);
      const pattern = isFolder ? `${name}/*` : name;

      if (!parentMap.has(parent)) {
        parentMap.set(parent, new Set());
      }
      parentMap.get(parent)!.add(pattern);
    }

    removeFromList(paths);
    void run(
      (t('opAddToIgnore') as string) + ` (${paths.length})`,
      async (credentials) => {
        const results: string[] = [];
        for (const [parent, patterns] of parentMap) {
          const { stdout: existing } = await runSvn(
            ['propget', 'svn:ignore', parent],
            cwd,
            credentials,
          ).catch(() => ({ stdout: '' }));
          const lines = existing
            .split(/\r?\n/)
            .map((l) => l.trim())
            .filter(Boolean);
          for (const pattern of patterns) {
            if (!lines.includes(pattern)) lines.push(pattern);
          }
          const out = await svnSetIgnoreProperty(
            parent,
            lines,
            cwd,
            credentialArgs(credentials),
          );
          results.push(out.trim() || t('ignoreUpdated')(parent));
        }
        return results.join('\n');
      },
    );
  };

  return {
    onAdd,
    onRevert,
    onDeleteSmart,
    onUndoDelete,
    hasUndoDelete,
    onResolveAny,
    onLock,
    onUnlock,
    onBreakLock,
    onIgnore,
    onIgnoreMultiple,
    treeConflictChoice,
    setTreeConflictChoice,
    onResolveTreeConflictKeepMine,
    onResolveTreeConflictAcceptDelete,
  };
}
