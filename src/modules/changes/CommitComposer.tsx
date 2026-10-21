import { t } from '@nonu/app/i18n';
import { Button, Splitter } from '@nonu/components';
import { TextArea } from '@nonu/components/ui/TextInput';
import type { SvnChange } from '@nonu/svn';
import type { MouseEventHandler } from 'react';

import './CommitComposer.css';

export function CommitComposer({
  message,
  setMessage,
  generating,
  busy,
  committable,
  conflictedSelected,
  commitHeight,
  startCommitSplitterDrag,
  onGenerateMessage,
  onCommit,
}: {
  message: string;
  setMessage: (value: string) => void;
  generating: boolean;
  busy: boolean;
  committable: SvnChange[];
  conflictedSelected: SvnChange[];
  commitHeight: number;
  startCommitSplitterDrag: MouseEventHandler;
  onGenerateMessage: () => void;
  onCommit: () => void;
}) {
  return (
    <>
      <Splitter
        direction="v"
        onMouseDown={startCommitSplitterDrag}
        variant="ghost"
      />
      <div className="svn-commit" style={{ height: commitHeight }}>
        <TextArea
          size="sm"
          value={message}
          onChange={setMessage}
          readOnly={generating}
          className={generating ? 'svn-commit-generating' : undefined}
          placeholder={
            generating
              ? (t('commitGenerating') as string)
              : committable.length > 0
                ? (t('commitPlaceholder') as (n: number) => string)(
                    committable.length,
                  )
                : (t('commitNoFiles') as string)
          }
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) onCommit();
          }}
        />
        <div className="svn-commit-actions">
          <Button
            onClick={onGenerateMessage}
            disabled={busy || generating || committable.length === 0}
            title={t('generateMessage') as string}
          >
            <span className={generating ? 'svn-magic-spin' : undefined}>
              ✨
            </span>
          </Button>
          <Button
            variant="primary"
            onClick={onCommit}
            disabled={busy || !message.trim() || committable.length === 0}
            title={
              committable.length === 0 && conflictedSelected.length > 0
                ? (t('commitBlockedByConflict') as (files: string) => string)(
                    conflictedSelected
                      .map((c) => c.path.split(/[\\/]/).pop())
                      .join(', '),
                  )
                : `${t('opCommit') as string} (Ctrl+Enter)`
            }
          >
            {(t('commitButton') as (n: number) => string)(committable.length)}
          </Button>
        </div>
      </div>
    </>
  );
}
