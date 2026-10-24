import { t } from '@nonu/app/i18n';
import {
  forwardRef,
  type ReactNode,
  useCallback,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import {
  type DiffFiles,
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
import { useChangeJumpShortcut } from './diffNavigation.js';
import type { DiffHeaders } from './RevisionHeadline.js';

export interface DiffPanelHandle {
  jump(direction: 'prev' | 'next'): boolean;
  editable(): boolean;
  save(force?: boolean): Promise<boolean>;
  revert(): void;
  formatInPlace(format: (path: string) => Promise<void>): Promise<void>;
}

type DiffPanelSource =
  | { kind: 'fixed'; files: DiffFiles }
  | {
      kind: 'editable';
      cwd: string;
      cacheVersion: number;
      unversioned?: boolean;
      onStateChange: (state: EditableDiffState) => void;
      onSaved: () => void;
    }
  | { kind: 'text'; text: string };

interface DiffPanelProps {
  path: string | null;
  rootName?: string;
  readOnly?: boolean;
  mode: 'inline' | 'split';
  onModeChange: (mode: 'inline' | 'split') => void;
  /** New files have no base side, so split is unavailable. */
  newFile?: boolean;
  headers?: DiffHeaders;
  leading?: ReactNode;
  actions?: ReactNode;
  source?: DiffPanelSource;
  /** Shown in place of the diff while there is no source. */
  placeholder?: ReactNode;
}

export const DiffPanel = forwardRef<DiffPanelHandle, DiffPanelProps>(
  function DiffPanel(
    {
      path,
      rootName,
      readOnly = false,
      mode,
      onModeChange,
      newFile = false,
      headers,
      leading,
      actions,
      source,
      placeholder = null,
    },
    ref,
  ) {
    const [syncScroll, setSyncScroll] = useState(true);
    const editRef = useRef<EditableDiffHandle | null>(null);
    const readRef = useRef<DiffViewHandle | null>(null);
    const split = mode === 'split' && !newFile;
    const jump = useCallback(
      (direction: 'prev' | 'next') =>
        (editRef.current ?? readRef.current)?.jump(direction) ?? false,
      [],
    );

    useChangeJumpShortcut(jump);

    useImperativeHandle(
      ref,
      () => ({
        jump,
        editable: () => source?.kind === 'editable' && editRef.current !== null,
        save: (force) => editRef.current?.save(force) ?? Promise.resolve(true),
        revert: () => editRef.current?.revert(),
        formatInPlace: (format) =>
          editRef.current?.formatInPlace(format) ?? Promise.resolve(),
      }),
      [source, jump],
    );

    let body: ReactNode = placeholder ?? (
      <div className="svn-empty">
        <div className="svn-empty-hint">{t('selectFileForDiff') as string}</div>
      </div>
    );
    if (source?.kind === 'text') {
      body = (
        <DiffView
          ref={readRef}
          text={source.text}
          path={path}
          mode={split ? 'split' : 'inline'}
          hideHunks
          hideMetadata
          headers={headers}
          syncScroll={syncScroll}
        />
      );
    } else if (source && path) {
      body = (
        <EditableDiff
          key={path}
          ref={editRef}
          path={path}
          mode={split ? 'split' : 'inline'}
          fixed={source.kind === 'fixed' ? source.files : undefined}
          cwd={source.kind === 'editable' ? source.cwd : undefined}
          cacheVersion={
            source.kind === 'editable' ? source.cacheVersion : undefined
          }
          unversioned={
            source.kind === 'editable' ? source.unversioned : undefined
          }
          onStateChange={
            source.kind === 'editable' ? source.onStateChange : undefined
          }
          onSaved={source.kind === 'editable' ? source.onSaved : undefined}
          headers={headers}
          syncScroll={syncScroll}
        />
      );
    }

    return (
      <>
        <DiffHeader path={path} rootName={rootName} readOnly={readOnly}>
          {leading}
          <DiffControls
            mode={split ? 'split' : 'inline'}
            onModeChange={onModeChange}
            onJump={(direction) => void jump(direction)}
            syncScroll={syncScroll}
            onSyncScrollChange={setSyncScroll}
            splitDisabled={newFile}
          />
          {actions}
        </DiffHeader>
        {body}
      </>
    );
  },
);
