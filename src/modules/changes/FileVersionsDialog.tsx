import { t } from '@nonu/app/i18n';
import { Button, Dialog, StructuredListRow } from '@nonu/components';
import type { HostAdapter } from '@nonu/host/types';
import type { OperationNotice } from '@nonu/svn';
import { restoreSnapshotFiles } from './restoreFlow.js';
import { useSnapshotRecords } from './snapshotData.js';

export function FileVersionsDialog({
  host,
  cwd,
  path,
  refreshTick,
  show,
  setPill,
  onClose,
}: {
  host: HostAdapter;
  cwd: string;
  path: string;
  refreshTick: number;
  show: Parameters<typeof restoreSnapshotFiles>[0]['show'];
  setPill: (notice: OperationNotice) => void;
  onClose: () => void;
}) {
  const records = useSnapshotRecords(host, cwd, refreshTick);
  const versions = records.filter((r) =>
    r.files.some((f) => f.path === path && f.hash !== null),
  );

  return (
    <Dialog
      title={`${t('reflogVersions') as string}: ${path}`}
      onClose={onClose}
      wide
    >
      {versions.length === 0 ? (
        <p className="reflog-empty">{t('reflogVersionsEmpty') as string}</p>
      ) : (
        versions.map((r) => (
          <StructuredListRow key={r.id} columns="minmax(0, 1fr) auto">
            <span className="reflog-command">
              <span>{new Date(r.time).toLocaleString()}</span>
              <span className="reflog-muted">{r.command}</span>
            </span>
            <Button
              size="sm"
              onClick={() => {
                onClose();
                void restoreSnapshotFiles({
                  host,
                  cwd,
                  snapshotId: r.id,
                  paths: [path],
                  show,
                  setPill,
                });
              }}
            >
              {t('reflogRestoreFile') as string}
            </Button>
          </StructuredListRow>
        ))
      )}
    </Dialog>
  );
}
