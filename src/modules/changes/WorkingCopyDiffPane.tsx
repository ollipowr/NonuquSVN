import { t } from '@nonu/app/i18n';
import { Button, SplitButton } from '@nonu/components';
import type { SvnChange, SvnLogEntry } from '@nonu/svn';
import type { RefObject } from 'react';

import type { EditableDiffState } from './DiffEditor.js';
import { DiffPanel, type DiffPanelHandle } from './DiffPanel.js';

export function WorkingCopyDiffPane({
  active,
  activeChange,
  diffIsNewFile,
  diffMode,
  chooseDiffMode,
  editState,
  onResolveAny,
  activeFormatterRule,
  busy,
  doFormatFile,
  doFormatAndSave,
  diffRef,
  cwd,
  rootName,
  editable,
  mtimes,
  baseEntry,
  activeStatus,
  setEditState,
  refresh,
  diff,
}: {
  rootName: string;
  active: string | null;
  activeChange?: SvnChange;
  diffIsNewFile: boolean;
  diffMode: 'split' | 'unified';
  chooseDiffMode: (mode: 'split' | 'unified') => void;
  editState: EditableDiffState;
  onResolveAny: (change: SvnChange) => void;
  activeFormatterRule: boolean;
  busy: boolean;
  doFormatFile: () => void;
  doFormatAndSave: () => void;
  diffRef: RefObject<DiffPanelHandle | null>;
  cwd: string;
  editable: boolean;
  mtimes: Map<string, number>;
  baseEntry?: SvnLogEntry;
  activeStatus?: string;
  setEditState: (state: EditableDiffState) => void;
  refresh: () => Promise<void>;
  diff: string;
}) {
  const workingMtime = active
    ? mtimes.get(active.replace(/\\/g, '/'))
    : undefined;
  const headers = {
    old: diffIsNewFile
      ? undefined
      : {
          label: t('diffSplitHeaderBase') as string,
          revision: baseEntry?.revision,
          date: baseEntry ? new Date(baseEntry.date).toLocaleString() : '-',
          author: baseEntry?.author,
        },
    new: {
      label: t('diffSplitHeaderWorking') as string,
      date: workingMtime ? new Date(workingMtime).toLocaleString() : '-',
    },
  };

  return (
    <div className="svn-diff">
      <DiffPanel
        ref={diffRef}
        path={active}
        rootName={rootName}
        mode={diffMode === 'split' ? 'split' : 'inline'}
        onModeChange={(mode) =>
          chooseDiffMode(mode === 'split' ? 'split' : 'unified')
        }
        newFile={diffIsNewFile}
        headers={headers}
        leading={
          activeChange && (
            <span className={`svn-badge svn-badge--${activeChange.status}`}>
              {diffIsNewFile ? (t('newFile') as string) : activeChange.status}
            </span>
          )
        }
        actions={
          <>
            {activeChange?.status === 'conflicted' && (
              <Button
                variant="mode"
                className="svn-edit-btn svn-resolve-btn"
                title={
                  editState.dirty
                    ? (t('saveBeforeResolve') as string)
                    : (t('ctxResolve') as string)
                }
                disabled={editState.dirty || editState.saving}
                onClick={() => activeChange && onResolveAny(activeChange)}
              >
                <span className="material-symbols-outlined">check_circle</span>{' '}
                {t('ctxResolve') as string}
              </Button>
            )}
            {activeFormatterRule && (
              <SplitButton
                disabled={editState.saving || editState.externalChanged || busy}
                primary={{
                  label: t('formatFile') as string,
                  icon: 'format_align_left',
                  onClick: doFormatFile,
                }}
                items={[
                  ...(editState.dirty
                    ? [
                        {
                          label: t('save') as string,
                          icon: 'save',
                          onClick: () => void diffRef.current?.save(),
                        },
                        {
                          label: t('formatAndSave') as string,
                          icon: 'save',
                          onClick: doFormatAndSave,
                        },
                      ]
                    : []),
                ]}
              />
            )}
            {!activeFormatterRule && editState.dirty && (
              <Button
                variant="mode"
                className="svn-edit-btn"
                title={`${t('save') as string} (Ctrl+S)`}
                disabled={editState.saving || editState.externalChanged}
                onClick={() => void diffRef.current?.save()}
              >
                <span className="material-symbols-outlined">save</span>{' '}
                {t('save') as string}
              </Button>
            )}
            {editState.dirty && (
              <Button
                variant="mode"
                className="svn-edit-btn"
                title={t('discardEdits') as string}
                disabled={editState.saving}
                onClick={() => diffRef.current?.revert()}
              >
                <span className="material-symbols-outlined">undo</span>{' '}
                {t('discardEdits') as string}
              </Button>
            )}
            {editState.externalChanged && (
              <>
                <span className="svn-editor-error">
                  {t('externalFileChanged') as string}
                </span>
                <Button
                  variant="mode"
                  disabled={editState.saving}
                  onClick={() => diffRef.current?.revert()}
                >
                  {t('reloadFromDisk') as string}
                </Button>
                <Button
                  variant="mode"
                  disabled={editState.saving}
                  onClick={() => void diffRef.current?.save(true)}
                >
                  {t('overwriteFile') as string}
                </Button>
              </>
            )}
            {editState.error && (
              <span className="svn-editor-error">{editState.error}</span>
            )}
          </>
        }
        source={
          active && cwd && editable
            ? {
                kind: 'editable',
                cwd,
                cacheVersion: mtimes.get(active.replace(/\\/g, '/')) ?? 0,
                unversioned: activeStatus === 'unversioned',
                onStateChange: setEditState,
                onSaved: () => void refresh(),
              }
            : { kind: 'text', text: diff }
        }
      />
    </div>
  );
}
