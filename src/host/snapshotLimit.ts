import { t } from '../app/i18n';
import type { useConfirmation } from '../hooks/useConfirmation';
import type { SnapshotFileInput } from './types';

const SNAPSHOT_LIMIT_BYTES = 200 * 1024 * 1024;

type Show = ReturnType<typeof useConfirmation>['show'];

// Base64 stores 3 bytes in 4 characters.
export function snapshotBytes(files: SnapshotFileInput[]): number {
  return files.reduce(
    (sum, file) => sum + (file.content ? (file.content.length * 3) / 4 : 0),
    0,
  );
}

export function confirmSnapshotSize(
  files: SnapshotFileInput[],
  show: Show,
  proceed: () => void,
  limitBytes = SNAPSHOT_LIMIT_BYTES,
): void {
  const bytes = snapshotBytes(files);
  if (bytes <= limitBytes) return proceed();
  show({
    title: t('snapshotLimitTitle') as string,
    message: (t('snapshotLimitMsg') as (mb: number) => string)(
      Math.round(bytes / 1024 / 1024),
    ),
    confirmLabel: t('snapshotLimitConfirm') as string,
    danger: true,
    onConfirm: proceed,
  });
}
