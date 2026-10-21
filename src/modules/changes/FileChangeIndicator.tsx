import { t } from '@nonu/app/i18n';
import './FileChangeIndicator.css';

export type FileChangeKind =
  | 'added'
  | 'deleted'
  | 'modified'
  | 'merged'
  | 'replaced'
  | 'conflicted'
  | 'unversioned'
  | 'missing'
  | 'ignored'
  | 'external'
  | 'unknown';

const PRESENTATION: Record<
  FileChangeKind,
  { code: string; label: () => string; tone: string }
> = {
  added: { code: 'A', label: () => t('statusAdded'), tone: 'added' },
  deleted: { code: 'D', label: () => t('statusDeleted'), tone: 'deleted' },
  modified: { code: 'M', label: () => t('statusModified'), tone: 'modified' },
  merged: { code: 'C', label: () => t('statusMergedCopied'), tone: 'merged' },
  replaced: { code: 'R', label: () => t('statusReplaced'), tone: 'merged' },
  conflicted: {
    code: '!',
    label: () => t('statusConflicted'),
    tone: 'conflicted',
  },
  unversioned: {
    code: '?',
    label: () => t('statusUnversioned'),
    tone: 'muted',
  },
  missing: { code: '!', label: () => t('statusMissing'), tone: 'deleted' },
  ignored: { code: 'I', label: () => t('statusIgnored'), tone: 'muted' },
  external: { code: 'X', label: () => t('statusExternal'), tone: 'external' },
  unknown: { code: '?', label: () => t('statusChanged'), tone: 'muted' },
};

/** Compact, Git-style file status shared by working-copy and history lists. */
export function FileChangeIndicator({
  kind,
  label,
  title,
}: {
  kind: FileChangeKind;
  label?: string;
  title?: string;
}) {
  const presentation = PRESENTATION[kind] ?? PRESENTATION.unknown;
  const accessibleLabel = label ?? presentation.label();
  return (
    <span
      className={`svn-file-change-indicator svn-file-change-indicator--${presentation.tone}`}
      title={title ?? accessibleLabel}
      aria-label={accessibleLabel}
    >
      {presentation.code}
    </span>
  );
}
