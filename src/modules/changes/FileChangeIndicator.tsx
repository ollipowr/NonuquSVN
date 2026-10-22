import { t } from '@nonu/app/i18n';
import type { ReactNode } from 'react';
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
  { glyph: ReactNode; label: () => string; tone: string }
> = {
  added: {
    glyph: <path d="M48 27V69M69 48H27" />,
    label: () => t('statusAdded'),
    tone: 'added',
  },
  deleted: {
    glyph: <path d="M27 48H69" />,
    label: () => t('statusDeleted'),
    tone: 'deleted',
  },
  modified: {
    glyph: (
      <circle cx="48" cy="48" r="15.8" fill="currentColor" stroke="none" />
    ),
    label: () => t('statusModified'),
    tone: 'modified',
  },
  merged: {
    glyph: <path d="M28 48H66M54 36L66 48L54 60" />,
    label: () => t('statusMergedCopied'),
    tone: 'merged',
  },
  replaced: {
    glyph: <path d="M30 40H66M54 30L66 40L54 50M66 56H30M42 46L30 56L42 66" />,
    label: () => t('statusReplaced'),
    tone: 'merged',
  },
  conflicted: {
    glyph: (
      <>
        <path d="M48 28V56" />
        <circle cx="48" cy="68" r="6" fill="currentColor" stroke="none" />
      </>
    ),
    label: () => t('statusConflicted'),
    tone: 'conflicted',
  },
  unversioned: {
    glyph: (
      <>
        <path d="M38 40C38 33 42 29 48 29C54 29 58 33 58 39C58 45 48 46 48 54" />
        <circle cx="48" cy="67" r="6" fill="currentColor" stroke="none" />
      </>
    ),
    label: () => t('statusUnversioned'),
    tone: 'muted',
  },
  missing: {
    glyph: <circle cx="48" cy="48" r="12" />,
    label: () => t('statusMissing'),
    tone: 'deleted',
  },
  ignored: {
    glyph: <path d="M34 34L62 62" />,
    label: () => t('statusIgnored'),
    tone: 'muted',
  },
  external: {
    glyph: <path d="M36 60L62 34M46 34H62V50" />,
    label: () => t('statusExternal'),
    tone: 'external',
  },
  unknown: {
    glyph: (
      <>
        <path d="M38 40C38 33 42 29 48 29C54 29 58 33 58 39C58 45 48 46 48 54" />
        <circle cx="48" cy="67" r="6" fill="currentColor" stroke="none" />
      </>
    ),
    label: () => t('statusChanged'),
    tone: 'muted',
  },
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
      <svg
        className="svn-file-change-glyph"
        viewBox="0 0 96 96"
        aria-hidden="true"
      >
        <rect
          x="10"
          y="10"
          width="76"
          height="76"
          rx="11"
          fill="none"
          stroke="currentColor"
          strokeWidth="10"
        />
        <g
          fill="none"
          stroke="currentColor"
          strokeWidth="10"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {presentation.glyph}
        </g>
      </svg>
    </span>
  );
}
