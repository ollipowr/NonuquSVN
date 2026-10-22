import { t } from '@nonu/app/i18n';
import { Button, StructuredListRow } from '@nonu/components';
import type { SvnChange } from '@nonu/svn';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  FileChangeIndicator,
  type FileChangeKind,
} from './FileChangeIndicator.js';
import './ChangesList.css';

type ChangesListProps = {
  groups: Map<string, SvnChange[]>;
  rootName: string;
  groupByFolder: boolean;
  allVisibleChanges: SvnChange[];
  collapsedFolders: Set<string>;
  directoryPaths: Set<string>;
  mtimes: Map<string, number>;
  selected: Set<string>;
  highlighted: Set<string>;
  active?: string;
  menuTarget?: string;
  revalidating: boolean;
  hasLoaded: boolean;
  listRef: React.RefObject<HTMLDivElement | null>;
  onKeyDown: React.KeyboardEventHandler<HTMLDivElement>;
  onToggleFolder: (dir: string) => void;
  onRowClick: (event: React.MouseEvent<HTMLDivElement>, path: string) => void;
  onRowDoubleClick: (path: string) => void;
  onContextMenu: (
    event: React.MouseEvent<HTMLDivElement>,
    change: SvnChange,
  ) => void;
  onFolderContextMenu: (
    event: React.MouseEvent<HTMLButtonElement>,
    dir: string,
    changes: SvnChange[],
  ) => void;
  onCheckboxClick: (
    event: React.MouseEvent<HTMLInputElement>,
    path: string,
  ) => void;
  onOpen: (path: string) => void;
  onRevert: (path: string) => void;
  onPreview: (path: string) => void;
  onResolve: (change: SvnChange) => void;
};

const FILES_WITHOUT_EXTENSION = new Set([
  'makefile',
  'dockerfile',
  'readme',
  'license',
  'changelog',
  'authors',
  'contributors',
  'gemfile',
  'procfile',
  'rakefile',
  'rakefile.rb',
  'appfile',
  'fastfile',
  'guardfile',
  'capfile',
  'thorfile',
]);

function pathKey(path: string): string {
  return path
    .replace(/[\\/]+$/, '')
    .replace(/\\/g, '/')
    .toLowerCase();
}

function getFileIcon(path: string, directorySet: Set<string>): string {
  const cleanPath = path.replace(/[\\/]+$/, '');
  const name = cleanPath.split(/[\\/]/).pop()?.toLowerCase() ?? '';
  if (cleanPath === '.') return 'folder_special';
  if (directorySet.has(pathKey(cleanPath))) return 'folder';

  const hasDot = name.includes('.');
  const ext = hasDot ? (name.split('.').pop()?.toLowerCase() ?? '') : '';
  if (!hasDot)
    return FILES_WITHOUT_EXTENSION.has(name) ? 'description' : 'folder';
  if (['md', 'txt', 'rst', 'doc', 'docx', 'pdf', 'rtf'].includes(ext))
    return 'description';
  if (
    [
      'js',
      'ts',
      'tsx',
      'jsx',
      'mjs',
      'cjs',
      'py',
      'rb',
      'php',
      'go',
      'rs',
      'c',
      'cpp',
      'h',
      'java',
      'cs',
    ].includes(ext)
  )
    return 'code';
  if (['html', 'htm', 'css', 'scss', 'sass', 'less'].includes(ext))
    return 'web';
  if (['json', 'yaml', 'yml', 'xml', 'toml', 'ini', 'conf'].includes(ext))
    return 'settings';
  if (['zip', 'tar', 'gz', 'rar', '7z', 'bz2'].includes(ext))
    return 'folder_zip';
  if (['jpg', 'jpeg', 'png', 'gif', 'svg', 'webp', 'ico', 'bmp'].includes(ext))
    return 'image';
  if (['mp4', 'avi', 'mov', 'mkv', 'flv', 'webm'].includes(ext)) return 'movie';
  if (['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a'].includes(ext))
    return 'audio_file';
  if (['exe', 'dll', 'so', 'dylib', 'sh', 'bat', 'cmd', 'ps1'].includes(ext))
    return 'terminal';
  return 'insert_drive_file';
}

const ROW_HEIGHT_FALLBACK = 25;
const HEADER_HEIGHT_FALLBACK = 25;
const OVERSCAN_PX = 400;

type FlatEntry =
  | { kind: 'header'; dir: string; items: SvnChange[] }
  | { kind: 'row'; dir: string; change: SvnChange };

export function ChangesList(props: ChangesListProps) {
  // Build once per update, not per row. Parent paths infer folders before the filesystem probe finishes.
  const directorySet = useMemo(() => {
    const paths = new Set(Array.from(props.directoryPaths, pathKey));
    for (const change of props.allVisibleChanges) {
      const segments = pathKey(change.path).split('/');
      segments.pop();
      while (segments.length > 0) {
        paths.add(segments.join('/'));
        segments.pop();
      }
    }
    return paths;
  }, [props.allVisibleChanges, props.directoryPaths]);

  const entries = useMemo(() => {
    const out: FlatEntry[] = [];
    // Folders only collapse when their header is shown; otherwise a stale
    // collapsed entry hides rows with no header left to expand them.
    const headers = props.groupByFolder && props.groups.size > 1;
    for (const [dir, items] of props.groups.entries()) {
      if (headers) out.push({ kind: 'header', dir, items });
      if (!headers || !props.collapsedFolders.has(dir)) {
        for (const change of items) out.push({ kind: 'row', dir, change });
      }
    }
    return out;
  }, [props.groups, props.groupByFolder, props.collapsedFolders]);

  const rowHeightRef = useRef(ROW_HEIGHT_FALLBACK);
  const headerHeightRef = useRef(HEADER_HEIGHT_FALLBACK);
  const firstRowElRef = useRef<HTMLDivElement | null>(null);
  const firstHeaderElRef = useRef<HTMLButtonElement | null>(null);
  const [viewport, setViewport] = useState({ scrollTop: 0, height: 0 });

  useEffect(() => {
    const el = props.listRef.current;
    if (!el) return;
    const onScroll = () =>
      setViewport((v) =>
        v.scrollTop === el.scrollTop ? v : { ...v, scrollTop: el.scrollTop },
      );
    const observer = new ResizeObserver(() =>
      setViewport((v) =>
        v.height === el.clientHeight ? v : { ...v, height: el.clientHeight },
      ),
    );
    el.addEventListener('scroll', onScroll, { passive: true });
    observer.observe(el);
    setViewport({ scrollTop: el.scrollTop, height: el.clientHeight });
    return () => {
      el.removeEventListener('scroll', onScroll);
      observer.disconnect();
    };
  }, [props.listRef]);

  useEffect(() => {
    if (firstRowElRef.current)
      rowHeightRef.current =
        firstRowElRef.current.getBoundingClientRect().height ||
        ROW_HEIGHT_FALLBACK;
    if (firstHeaderElRef.current)
      headerHeightRef.current =
        firstHeaderElRef.current.getBoundingClientRect().height ||
        HEADER_HEIGHT_FALLBACK;
  }, [entries]);

  const rowHeight = rowHeightRef.current;
  const headerHeight = headerHeightRef.current;

  const { startIndex, endIndex, topSpacer, bottomSpacer } = useMemo(() => {
    if (entries.length === 0)
      return { startIndex: 0, endIndex: 0, topSpacer: 0, bottomSpacer: 0 };
    const heights = entries.map((e) =>
      e.kind === 'header' ? headerHeight : rowHeight,
    );
    const offsets = new Array<number>(entries.length);
    let total = 0;
    for (let i = 0; i < heights.length; i++) {
      offsets[i] = total;
      total += heights[i];
    }
    const viewTop = Math.max(0, viewport.scrollTop - OVERSCAN_PX);
    const viewBottom = viewport.scrollTop + viewport.height + OVERSCAN_PX;
    let start = 0;
    while (start < entries.length && offsets[start] + heights[start] < viewTop)
      start++;
    let end = start;
    while (end < entries.length && offsets[end] < viewBottom) end++;
    const topSpacer = offsets[start] ?? total;
    const bottomSpacer =
      total -
      (offsets[end - 1] !== undefined
        ? offsets[end - 1] + heights[end - 1]
        : 0);
    return {
      startIndex: start,
      endIndex: end,
      topSpacer,
      bottomSpacer: Math.max(0, bottomSpacer),
    };
  }, [entries, viewport, rowHeight, headerHeight]);

  const visibleEntries = entries.slice(startIndex, endIndex);
  let firstRowAssigned = false;
  let firstHeaderAssigned = false;

  return (
    <div
      className="svn-changes-list"
      ref={props.listRef}
      tabIndex={0}
      onKeyDown={props.onKeyDown}
    >
      {props.revalidating &&
        !props.hasLoaded &&
        [55, 38, 70, 46, 62, 42].map((width, index) => (
          <div
            key={index}
            className="svn-row-skeleton"
            style={{ animationDelay: `${index * 0.08}s` }}
          >
            <div className="svn-row-skeleton__bar svn-row-skeleton__bar--checkbox" />
            <div className="svn-row-skeleton__bar svn-row-skeleton__bar--code" />
            <div className="svn-row-skeleton__bar svn-row-skeleton__bar--icon" />
            <div
              className="svn-row-skeleton__bar svn-row-skeleton__bar--path"
              style={{ width: `${width}%` }}
            />
          </div>
        ))}
      <div style={{ height: topSpacer }} />
      {visibleEntries.map((entry) => {
        if (entry.kind === 'header') {
          const assignRef = !firstHeaderAssigned;
          firstHeaderAssigned = true;
          return (
            <button
              key={`dir:${entry.dir}`}
              ref={assignRef ? firstHeaderElRef : undefined}
              className={`svn-folder-row${props.menuTarget === entry.dir ? ' svn-folder-row--menu-target' : ''}`}
              onClick={() => props.onToggleFolder(entry.dir)}
              onContextMenu={(event) =>
                props.onFolderContextMenu(event, entry.dir, entry.items)
              }
            >
              <span className="material-symbols-outlined svn-folder-chevron">
                {props.collapsedFolders.has(entry.dir)
                  ? 'chevron_right'
                  : 'expand_more'}
              </span>
              <span className="material-symbols-outlined svn-folder-icon">
                folder
              </span>
              <span className="svn-folder-name">{entry.dir}</span>
              <span className="svn-folder-count">{entry.items.length}</span>
            </button>
          );
        }
        const change = entry.change;
        const path = change.path;
        const modifiedAt = props.mtimes.get(path.replace(/\\/g, '/'));
        const canOpen = !['deleted', 'missing'].includes(change.status);
        const canRevert = change.status !== 'unversioned';
        const assignRef = !firstRowAssigned;
        firstRowAssigned = true;
        return (
          <StructuredListRow
            key={path}
            ref={assignRef ? firstRowElRef : undefined}
            columns="13px 14px 16px minmax(0, 1fr) 116px 68px"
            data-path={path}
            className={`svn-row${props.active === path ? ' svn-row--active' : ''}${props.selected.has(path) ? ' svn-row--checked' : ''}${props.highlighted.has(path) ? ' svn-row--highlighted' : ''}${props.menuTarget === path ? ' svn-row--menu-target' : ''}${props.groupByFolder && props.groups.size > 1 ? ' svn-row--indented' : ''}`}
            onMouseDown={(event) => {
              if (event.shiftKey) event.preventDefault();
            }}
            onClick={(event) => props.onRowClick(event, path)}
            onDoubleClick={() => props.onRowDoubleClick(path)}
            onContextMenu={(event) => props.onContextMenu(event, change)}
          >
            <input
              type="checkbox"
              checked={props.selected.has(path)}
              onClick={(event) => props.onCheckboxClick(event, path)}
              onChange={() => {}}
            />
            <span className="svn-code">
              <FileChangeIndicator
                kind={change.status as FileChangeKind}
                title={
                  change.treeConflict
                    ? t('statusTreeConflict')(change.code)
                    : change.status === 'external' && change.externalTarget
                      ? t('statusExternalTarget')(change.externalTarget)
                      : `${change.status} (${change.code})`
                }
              />
            </span>
            <span className="svn-file-icon material-symbols-outlined">
              {getFileIcon(path, directorySet)}
            </span>
            <span className="svn-path" title={path}>
              {path === '.'
                ? props.rootName
                : props.groupByFolder
                  ? (path.split(/[\\/]/).pop() ?? path)
                  : path}
              {change.lockedByMe && (
                <span
                  className="material-symbols-outlined svn-lock-indicator"
                  title={t('lockedByMeTitle') as string}
                >
                  lock
                </span>
              )}
            </span>
            <span
              className={`svn-mtime${modifiedAt ? '' : ' svn-mtime--empty'}`}
              title={
                modifiedAt ? new Date(modifiedAt).toLocaleString() : undefined
              }
            >
              {modifiedAt
                ? new Date(modifiedAt).toLocaleString('de-DE', {
                    year: 'numeric',
                    month: '2-digit',
                    day: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                  })
                : '\u00a0'}
            </span>
            <div className="svn-row-actions">
              <span className="svn-row-action-slot">
                {canOpen && (
                  <Button
                    variant="ghost"
                    title={t('openFile') as string}
                    onClick={(event) => {
                      event.stopPropagation();
                      props.onOpen(path);
                    }}
                  >
                    <span className="material-symbols-outlined">
                      open_in_new
                    </span>
                  </Button>
                )}
              </span>
              <span className="svn-row-action-slot">
                {canRevert && (
                  <Button
                    variant="ghost"
                    title={t('revertFile') as string}
                    onClick={(event) => {
                      event.stopPropagation();
                      props.onRevert(path);
                    }}
                  >
                    <span className="material-symbols-outlined">undo</span>
                  </Button>
                )}
              </span>
              <span className="svn-row-action-slot">
                {canOpen && (
                  <Button
                    variant="ghost"
                    title={
                      change.status === 'unversioned'
                        ? (t('previewFile') as string)
                        : (t('showDiff') as string)
                    }
                    onClick={(event) => {
                      event.stopPropagation();
                      props.onPreview(path);
                    }}
                  >
                    <span className="material-symbols-outlined">
                      visibility
                    </span>
                  </Button>
                )}
              </span>
              <span className="svn-row-action-slot">
                {change.status === 'conflicted' && (
                  <Button
                    variant="ghost"
                    title={t('ctxResolve') as string}
                    onClick={(event) => {
                      event.stopPropagation();
                      props.onResolve(change);
                    }}
                  >
                    <span className="material-symbols-outlined">
                      check_circle
                    </span>
                  </Button>
                )}
              </span>
            </div>
          </StructuredListRow>
        );
      })}
      <div style={{ height: bottomSpacer }} />
    </div>
  );
}
