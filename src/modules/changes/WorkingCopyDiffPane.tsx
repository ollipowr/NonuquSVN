import { t } from '@nonu/app/i18n';
import { Button, SplitButton } from '@nonu/components';
import type { SvnChange } from '@nonu/svn';
import { type RefObject, useState } from 'react';

import {
  EditableDiff,
  type EditableDiffHandle,
  type EditableDiffState,
} from './DiffEditor.js';
import {
  DiffControls,
  DiffHeader,
  DiffView,
  type DiffViewHandle,
} from './DiffView.js';

export function WorkingCopyDiffPane({
  active,
  activeChange,
  diffIsNewFile,
  diffMode,
  chooseDiffMode,
  jumpToChange,
  editState,
  onResolveAny,
  activeFormatterRule,
  busy,
  doFormatFile,
  doFormatAndSave,
  editorRef,
  cwd,
  rootName,
  editable,
  mtimes,
  activeStatus,
  setEditState,
  refresh,
  readOnlyDiffRef,
  diff,
}: {
  rootName: string;
  active: string | null;
  activeChange?: SvnChange;
  diffIsNewFile: boolean;
  diffMode: 'split' | 'unified';
  chooseDiffMode: (mode: 'split' | 'unified') => void;
  jumpToChange: (direction: 'prev' | 'next') => void;
  editState: EditableDiffState;
  onResolveAny: (change: SvnChange) => void;
  activeFormatterRule: boolean;
  busy: boolean;
  doFormatFile: () => void;
  doFormatAndSave: () => void;
  editorRef: RefObject<EditableDiffHandle | null>;
  cwd: string;
  editable: boolean;
  mtimes: Map<string, number>;
  activeStatus?: string;
  setEditState: (state: EditableDiffState) => void;
  refresh: () => Promise<void>;
  readOnlyDiffRef: RefObject<DiffViewHandle | null>;
  diff: string;
}) {
  const [syncScroll, setSyncScroll] = useState(true);

  return (
    <div className="svn-diff">
      <DiffHeader path={active} rootName={rootName}>
        {activeChange && (
          <span className={`svn-badge svn-badge--${activeChange.status}`}>
            {diffIsNewFile ? (t('newFile') as string) : activeChange.status}
          </span>
        )}
        <DiffControls
          mode={diffMode === 'split' ? 'split' : 'inline'}
          onModeChange={(mode) =>
            chooseDiffMode(mode === 'split' ? 'split' : 'unified')
          }
          onJump={jumpToChange}
          syncScroll={syncScroll}
          onSyncScrollChange={setSyncScroll}
        />
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
                      onClick: () => void editorRef.current?.save(),
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
            onClick={() => void editorRef.current?.save()}
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
            onClick={() => editorRef.current?.revert()}
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
              onClick={() => editorRef.current?.revert()}
            >
              {t('reloadFromDisk') as string}
            </Button>
            <Button
              variant="mode"
              disabled={editState.saving}
              onClick={() => void editorRef.current?.save(true)}
            >
              {t('overwriteFile') as string}
            </Button>
          </>
        )}
        {editState.error && (
          <span className="svn-editor-error">{editState.error}</span>
        )}
      </DiffHeader>
      {active && cwd && editable ? (
        <>
          {diffIsNewFile && diffMode === 'split' && (
            <div className="svn-diff-hint">
              {t('splitUnavailable') as string}
            </div>
          )}
          <EditableDiff
            key={active}
            ref={editorRef}
            path={active}
            cwd={cwd}
            cacheVersion={mtimes.get(active.replace(/\\/g, '/')) ?? 0}
            mode={diffMode === 'split' && !diffIsNewFile ? 'split' : 'inline'}
            unversioned={activeStatus === 'unversioned'}
            onStateChange={setEditState}
            onSaved={() => void refresh()}
            syncScroll={syncScroll}
          />
        </>
      ) : (
        <DiffView
          ref={readOnlyDiffRef}
          text={diff}
          path={active}
          mode={diffMode === 'split' ? 'split' : 'inline'}
          hideHunks
          hideMetadata
          splitHeaders={
            diffMode === 'split'
              ? {
                  old: t('diffSplitHeaderBase') as string,
                  new: t('diffSplitHeaderWorking') as string,
                }
              : undefined
          }
          syncScroll={syncScroll}
        />
      )}
    </div>
  );
}
