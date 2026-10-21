import { t } from '@nonu/app/i18n';
import { Dialog } from '@nonu/components';
import type { SvnLogEntry } from '@nonu/svn';
import React from 'react';
import './LogDialog.css';

function formatLogDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

interface LogDialogProps {
  path: string;
  entries: SvnLogEntry[];
  onClose: () => void;
}

export function LogDialog({ path, entries, onClose }: LogDialogProps) {
  return (
    <Dialog
      title={(t('logTitle') as (path: string) => string)(path)}
      onClose={onClose}
    >
      {entries.length === 0 && (
        <div className="svn-log-empty">{t('noLogEntries') as string}</div>
      )}
      {entries.map((entry) => (
        <div key={entry.revision} className="svn-log-entry">
          <div className="svn-log-entry-head">
            <span className="svn-log-rev">r{entry.revision}</span>
            <span className="svn-log-author">
              <span className="material-symbols-outlined">person</span>
              {entry.author || '—'}
            </span>
            <span className="svn-log-date">{formatLogDate(entry.date)}</span>
          </div>
          <div className="svn-log-message">{entry.message || '—'}</div>
        </div>
      ))}
    </Dialog>
  );
}
