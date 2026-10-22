import { t } from '@nonu/app/i18n';
import { Button, Splitter } from '@nonu/components';
import React from 'react';

export type LogEntry = {
  kind: 'info' | 'success' | 'error';
  text: string;
  command?: string;
  stderr?: string;
  ts: number;
};

export interface OutputPanelProps {
  outputLog: LogEntry[];
  outputHeight: number;
  outputCollapsed: boolean;
  busy: boolean;
  toggleOutputCollapsed: () => void;
  onClear: () => void;
  startOutputSplitterDrag: (e: React.MouseEvent) => void;
  outputBodyRef: React.RefObject<HTMLDivElement | null>;
}

function maskSecrets(text: string): string {
  return text.replace(/(--password)\s+\S+/g, '$1 ***');
}

function OutputEntry({ entry }: { entry: LogEntry }) {
  const full = [
    entry.command ? `$ ${maskSecrets(entry.command)}` : null,
    entry.text ? maskSecrets(entry.text) : null,
    entry.stderr && entry.stderr !== entry.text
      ? maskSecrets(entry.stderr)
      : null,
  ]
    .filter(Boolean)
    .join('\n');

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(full);
    } catch {
      /* best-effort */
    }
  };

  return (
    <div className={`svn-output-entry svn-output-entry--${entry.kind}`}>
      <pre className="svn-output-entry-text">{full}</pre>
      <Button
        variant="ghost"
        className="svn-output-entry-copy"
        onClick={() => void copy()}
        title={t('copy')}
      >
        <span className="material-symbols-outlined">content_copy</span>
      </Button>
    </div>
  );
}

export function OutputPanel({
  outputLog,
  outputHeight,
  outputCollapsed,
  busy,
  toggleOutputCollapsed,
  onClear,
  startOutputSplitterDrag,
  outputBodyRef,
}: OutputPanelProps) {
  // Follow new output only while the user is at the bottom; scrolling up pauses it.
  const pinnedRef = React.useRef(true);
  React.useLayoutEffect(() => {
    const el = outputBodyRef.current;
    if (el && pinnedRef.current) el.scrollTop = el.scrollHeight;
  }, [outputLog, outputCollapsed, outputBodyRef]);

  return (
    <>
      <Splitter
        direction="v"
        onMouseDown={startOutputSplitterDrag}
        disabled={outputCollapsed}
        variant="ghost"
      />
      <div
        className={`svn-output${outputCollapsed ? ' svn-output--collapsed' : ''}`}
        style={outputCollapsed ? undefined : { height: outputHeight }}
      >
        <div className="svn-output-head" onClick={toggleOutputCollapsed}>
          <span className="material-symbols-outlined svn-output-chevron">
            {outputCollapsed ? 'chevron_right' : 'expand_more'}
          </span>
          <span className="material-symbols-outlined svn-output-icon">
            terminal
          </span>
          <span className="svn-output-title">{t('output') as string}</span>
          {outputCollapsed && outputLog.length > 0 && (
            <span
              className={`svn-output-last svn-output-last--${outputLog[outputLog.length - 1].kind}`}
            >
              {outputLog[outputLog.length - 1].text
                .split('\n')
                .filter((l) => l.trim())
                .at(-1) ?? outputLog[outputLog.length - 1].text.split('\n')[0]}
            </span>
          )}
          {!outputCollapsed && outputLog.length > 0 && (
            <Button
              variant="ghost"
              className="svn-output-clear"
              onClick={(e) => {
                e.stopPropagation();
                onClear();
              }}
              title={t('clearOutput') as string}
            >
              {t('clearOutput') as string}
            </Button>
          )}
        </div>
        {!outputCollapsed && (
          <div
            className="svn-output-body"
            ref={outputBodyRef}
            onScroll={(e) => {
              const el = e.currentTarget;
              pinnedRef.current =
                el.scrollHeight - el.scrollTop - el.clientHeight < 8;
            }}
          >
            {outputLog.length === 0 ? (
              <span className="svn-output-empty">
                {t('noOutput') as string}
              </span>
            ) : (
              outputLog.map((entry, i) => <OutputEntry key={i} entry={entry} />)
            )}
          </div>
        )}
      </div>
    </>
  );
}
