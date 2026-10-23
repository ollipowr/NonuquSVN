import { t } from '@nonu/app/i18n';
import {
  Button,
  Splitter,
  StructuredListRow,
  ViewHeader,
} from '@nonu/components';
import { useResize } from '@nonu/hooks';
import type { HostAdapter } from '@nonu/host/types';
import type { OperationNotice } from '@nonu/svn';
import React, { useEffect, useState } from 'react';
import {
  FileChangeIndicator,
  type FileChangeKind,
} from './FileChangeIndicator.js';
import './ReflogView.css';
import { DiffPanel } from './DiffPanel.js';
import { restoreSnapshotFiles } from './restoreFlow.js';
import type { SnapshotDiff } from './snapshotData.js';
import { loadSnapshotDiff, useSnapshotRecords } from './snapshotData.js';

type Show = Parameters<typeof restoreSnapshotFiles>[0]['show'];

const STATUS_KIND: Record<string, FileChangeKind> = {
  A: 'added',
  D: 'deleted',
  M: 'modified',
  R: 'replaced',
  '?': 'unversioned',
};
const FILES_MIN_HEIGHT = 80;

const statusKind = (code: string): FileChangeKind =>
  STATUS_KIND[code] ?? 'unknown';

export function ReflogView({
  host,
  cwd,
  refreshTick,
  show,
  setPill,
  diffMode,
  onDiffModeChange,
}: {
  host: HostAdapter;
  cwd: string;
  refreshTick: number;
  show: Show;
  setPill: (notice: OperationNotice) => void;
  diffMode: 'split' | 'unified';
  onDiffModeChange: (mode: 'split' | 'unified') => void;
}) {
  const records = useSnapshotRecords(host, cwd, refreshTick);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [diff, setDiff] = useState<SnapshotDiff | null>(null);
  const [listWidth, setListWidth] = useState(30);
  const [filesHeight, setFilesHeight] = useState(180);
  const resizeList = useResize({
    start: (event) => {
      const bounds = event.currentTarget.parentElement?.getBoundingClientRect();
      return bounds?.width
        ? {
            value: (next) =>
              ((next.clientX - bounds.left) / bounds.width) * 100,
            min: 15,
            max: 60,
          }
        : null;
    },
    onChange: setListWidth,
  });
  const resizeFiles = useResize({
    start: (event) => {
      const bounds = event.currentTarget.parentElement?.getBoundingClientRect();
      const top =
        event.currentTarget.previousElementSibling?.getBoundingClientRect().top;
      return bounds && top !== undefined
        ? {
            value: (next) => next.clientY - top,
            min: FILES_MIN_HEIGHT,
            max: () => bounds.height - 160,
          }
        : null;
    },
    onChange: setFilesHeight,
  });
  const selected =
    records.find((r) => r.id === selectedId) ?? records[0] ?? null;

  useEffect(() => {
    setDiff(null);
    if (!selected || !selectedPath) return;
    let cancelled = false;
    loadSnapshotDiff(host, selected.id, cwd, selectedPath)
      .then((d) => {
        if (!cancelled) setDiff(d);
      })
      .catch(() => {
        if (!cancelled) setDiff(null);
      });
    return () => {
      cancelled = true;
    };
  }, [host, cwd, selected, selectedPath]);

  const restore = (paths: string[]) => {
    if (!selected) return;
    void restoreSnapshotFiles({
      host,
      cwd,
      snapshotId: selected.id,
      paths,
      show,
      setPill,
    });
  };

  if (records.length === 0)
    return (
      <section className="reflog-view">
        <ViewHeader title={t('navReflog') as string} />
        <div className="reflog-empty">{t('reflogEmpty') as string}</div>
      </section>
    );

  const when = (time: string | number) => new Date(time).toLocaleString();

  return (
    <section className="reflog-view">
      <ViewHeader title={t('navReflog') as string} />
      <div
        className="reflog"
        style={
          { '--reflog-list-width': `${listWidth}%` } as React.CSSProperties
        }
      >
        <div className="reflog-list">
          {records.map((r) => (
            <StructuredListRow
              key={r.id}
              columns="minmax(0, 1fr) auto"
              className="reflog-row"
              active={r.id === selected?.id}
              onClick={() => {
                setSelectedId(r.id);
                setSelectedPath(null);
              }}
            >
              <span className="reflog-command">
                <time className="reflog-when">{when(r.time)}</time>
                <span className="reflog-muted" title={r.command}>
                  {r.command}
                </span>
              </span>
              <span className="reflog-count">{r.files.length}</span>
            </StructuredListRow>
          ))}
        </div>
        <Splitter direction="h" onMouseDown={resizeList} />
        {selected && (
          <div className="reflog-detail">
            <div className="reflog-detail-head">
              <span className="reflog-command">
                <time className="reflog-when">{when(selected.time)}</time>
                <span className="reflog-muted" title={selected.command}>
                  {selected.command}
                </span>
              </span>
              <Button
                size="sm"
                onClick={() => restore(selected.files.map((f) => f.path))}
              >
                {t('reflogRestoreAll') as string}
              </Button>
            </div>
            <div className="reflog-files" style={{ height: filesHeight }}>
              {selected.files.map((f) => (
                <StructuredListRow
                  key={f.path}
                  columns="20px minmax(0, 1fr) auto"
                  className="reflog-file"
                  active={f.path === selectedPath}
                  onClick={() => setSelectedPath(f.path)}
                >
                  <FileChangeIndicator kind={statusKind(f.statusBefore)} />
                  <span className="reflog-path" title={f.path}>
                    {f.path}
                  </span>
                  <Button
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      restore([f.path]);
                    }}
                  >
                    {t('reflogRestoreFile') as string}
                  </Button>
                </StructuredListRow>
              ))}
            </div>
            <Splitter direction="v" onMouseDown={resizeFiles} />
            <div className="reflog-diff">
              <DiffPanel
                path={selectedPath}
                readOnly
                mode={diffMode === 'split' ? 'split' : 'inline'}
                onModeChange={(mode) =>
                  onDiffModeChange(mode === 'split' ? 'split' : 'unified')
                }
                headers={{
                  old: {
                    label: t('reflogBefore') as string,
                    date: when(selected.time),
                  },
                  new: { label: t('reflogCurrent') as string, date: '' },
                }}
                source={
                  diff && !diff.binarySize
                    ? { kind: 'fixed', files: diff.files }
                    : undefined
                }
                placeholder={
                  diff?.binarySize !== undefined
                    ? (t('reflogBinary') as (kb: number) => string)(
                        Math.ceil(diff.binarySize / 1024),
                      )
                    : null
                }
              />
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
