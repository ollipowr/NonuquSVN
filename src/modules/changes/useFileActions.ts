import { t } from '@nonu/app/i18n';
import type { useConfirmation } from '@nonu/hooks';
import type { HostAdapter } from '@nonu/host/types';
import { readFileRaw, svnSetIgnoreProperty } from '@nonu/stores';
import {
  credentialArgs,
  getLockInfo,
  lockFiles,
  type OperationNotice,
  runSvn,
  type SvnChange,
  type SvnCredentials,
  toOperationNotice as toPill,
  unlockFiles,
} from '@nonu/svn';
import { useState } from 'react';

import { hasConflictMarkers } from './conflicts.js';

export function useFileActions({
  cwd,
  changes,
  host,
  run,
  showConfirm,
  removeFromList,
  setPill,
}: {
  cwd: string;
  changes: SvnChange[];
  host: HostAdapter;
  run: (
    label: string,
    operation: (credentials?: SvnCredentials) => Promise<string>,
  ) => Promise<void>;
  showConfirm: ReturnType<typeof useConfirmation>['show'];
  removeFromList: (paths: string[]) => void;
  setPill: (notice: OperationNotice) => void;
}) {
  const onAdd = (paths: string[]) => {
    if (!cwd || paths.length === 0) return;
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
          const { stdout } = await runSvn(
            ['revert', '--depth', 'infinity', ...paths],
            cwd!,
            credentials,
          );
          return (
            stdout.trim() ||
            (t('opRevertDone') as (n: number) => string)(paths.length)
          );
        });
      },
    });
  };

  const onDelete = (paths: string[]) => {
    if (!cwd || paths.length === 0) return;
    void showConfirm({
      title: t('svnDelete') as string,
      message: (t('confirmDelete') as (n: number) => string)(paths.length),
      confirmLabel: t('svnDelete') as string,
      cancelLabel: t('authCancel') as string,
      danger: true,
      icon: 'delete',
      onConfirm: () => {
        removeFromList(paths);
        void run(t('opDelete') as string, async (credentials) => {
          const { stdout } = await runSvn(
            ['delete', '--depth', 'infinity', ...paths],
            cwd!,
            credentials,
          );
          return (
            stdout.trim() ||
            (t('opDeleteDone') as (n: number) => string)(paths.length)
          );
        });
      },
    });
  };

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
          return (t('opDeleteLocalDone') as (n: number) => string)(
            paths.length,
          );
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
      if (versioned.length > 0) onDelete(versioned);
      if (unversioned.length > 0) onDeleteLocal(unversioned);
    };
    if (modified.length > 0) {
      void showConfirm({
        title: t('delete') as string,
        message: (t('confirmDeleteModified') as (n: number) => string)(
          modified.length,
        ),
        confirmLabel: t('delete') as string,
        cancelLabel: t('authCancel') as string,
        danger: true,
        icon: 'warning',
        onConfirm: proceed,
      });
      return;
    }
    proceed();
  };

  const onResolve = (paths: string[]) => {
    if (!cwd || paths.length === 0) return;
    void run(t('opResolve') as string, async (credentials) => {
      // `svn resolve` only clears the conflict state; it does not touch the file content.
      // Refuse while conflict markers are still in the file, otherwise they get committed.
      for (const p of paths) {
        if (hasConflictMarkers(await readFileRaw(p, cwd))) {
          throw new Error((t('resolveHasMarkers') as (p: string) => string)(p));
        }
      }
      const { stdout } = await runSvn(
        ['resolve', '--accept', 'working', ...paths],
        cwd,
        credentials,
      );
      return (
        stdout.trim() ||
        (t('opResolveDone') as (n: number) => string)(paths.length)
      );
    });
  };

  // Tree conflicts have no in-file markers: offer keep-local or follow-incoming-delete instead.
  const [treeConflictChoice, setTreeConflictChoice] = useState<{
    path: string;
  } | null>(null);

  const onResolveTreeConflictKeepMine = (path: string) => {
    if (!cwd) return;
    setTreeConflictChoice(null);
    void run(t('opResolve') as string, async (credentials) => {
      const { stdout } = await runSvn(
        ['resolve', '--accept', 'working', path],
        cwd,
        credentials,
      );
      return stdout.trim() || (t('opResolveDone') as (n: number) => string)(1);
    });
  };

  const onResolveTreeConflictAcceptDelete = (path: string) => {
    if (!cwd) return;
    setTreeConflictChoice(null);
    removeFromList([path]);
    void run(t('opResolve') as string, async (credentials) => {
      await runSvn(['delete', '--force', path], cwd, credentials);
      const { stdout } = await runSvn(
        ['resolve', '--accept', 'working', path],
        cwd,
        credentials,
      );
      return stdout.trim() || (t('opResolveDone') as (n: number) => string)(1);
    });
  };

  const onResolveAny = (change: SvnChange) => {
    if (change.treeConflict) setTreeConflictChoice({ path: change.path });
    else onResolve([change.path]);
  };

  const onLock = (paths: string[]) => {
    if (!cwd || paths.length === 0) return;
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
