import { t } from '@nonu/app/i18n';
import { Dialog } from '@nonu/components';
import type { SvnBlameLine } from '@nonu/svn';
import React from 'react';
import './BlameDialog.css';

function formatBlameDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

interface BlameDialogProps {
  path: string;
  lines: SvnBlameLine[];
  onClose: () => void;
}

export function BlameDialog({ path, lines, onClose }: BlameDialogProps) {
  return (
    <Dialog
      title={(t('blameTitle') as (path: string) => string)(path)}
      onClose={onClose}
      wide
    >
      {lines.length === 0 && (
        <div className="svn-log-empty">{t('noBlameOutput') as string}</div>
      )}
      {lines.map((l) => (
        <div key={l.line} className="svn-blame-row">
          <span className="svn-blame-lineno">{l.line}</span>
          <span className="svn-blame-rev" title={formatBlameDate(l.date)}>
            r{l.revision}
          </span>
          <span className="svn-blame-author">{l.author || '—'}</span>
          <span className="svn-blame-text">{l.text}</span>
        </div>
      ))}
    </Dialog>
  );
}
