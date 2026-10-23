import { t } from '@nonu/app/i18n';
import type { useConfirmation } from '@nonu/hooks';
import type { HostAdapter } from '@nonu/host/types';
import { invalidateWorkspace } from '@nonu/modules/workspace';
import { type OperationNotice, toOperationNotice } from '@nonu/svn';

type Show = ReturnType<typeof useConfirmation>['show'];

/** Runs `proceed` directly, or after asking which way to handle files that changed since the snapshot. */
export function confirmRestore(
  show: Show,
  conflicts: string[],
  proceed: (keepCopies: boolean) => void,
): void {
  if (conflicts.length === 0) return proceed(false);
  show({
    title: t('restoreConflictTitle') as string,
    message: (t('restoreConflictMsg') as (n: number) => string)(
      conflicts.length,
    ),
    confirmLabel: t('restoreConflictOverwrite') as string,
    extraLabel: t('restoreConflictCopy') as string,
    cancelLabel: t('authCancel') as string,
    danger: true,
    icon: 'warning',
    onConfirm: () => proceed(false),
    onExtra: () => proceed(true),
  });
}

export function restoreSnapshotFiles({
  host,
  cwd,
  snapshotId,
  paths,
  show,
  setPill,
}: {
  host: HostAdapter;
  cwd: string;
  snapshotId: string;
  paths: string[];
  show: Show;
  setPill: (notice: OperationNotice) => void;
}): void {
  void (async () => {
    const check = await host.restoreSnapshot?.(snapshotId, paths, 'check');
    confirmRestore(show, check?.conflicts ?? [], (keepCopies) => {
      void (async () => {
        const result = await host.restoreSnapshot?.(
          snapshotId,
          paths,
          keepCopies ? 'copy' : 'overwrite',
        );
        invalidateWorkspace(cwd);
        if (result?.failed.length)
          setPill({
            kind: 'error',
            text: (t('restoreFailed') as (p: string) => string)(
              result.failed.join(', '),
            ),
          });
        else
          setPill({
            kind: 'success',
            text: (t('restoreDone') as (n: number) => string)(
              result?.restored.length ?? 0,
            ),
          });
      })().catch((err) => setPill(toOperationNotice(err)));
    });
  })().catch((err) => setPill(toOperationNotice(err)));
}

/** Restores every stored file of an operation's snapshot, the undo for svn commands. */
export async function undoOperation({
  host,
  cwd,
  snapshotId,
  show,
  setPill,
}: {
  host: HostAdapter;
  cwd: string;
  snapshotId: string;
  show: Show;
  setPill: (notice: OperationNotice) => void;
}): Promise<void> {
  try {
    const record = (await host.listSnapshots?.(cwd))?.find(
      (r) => r.id === snapshotId,
    );
    const paths =
      record?.files.filter((f) => f.hash !== null).map((f) => f.path) ?? [];
    if (paths.length === 0) return;
    restoreSnapshotFiles({ host, cwd, snapshotId, paths, show, setPill });
  } catch (err) {
    setPill(toOperationNotice(err));
  }
}
