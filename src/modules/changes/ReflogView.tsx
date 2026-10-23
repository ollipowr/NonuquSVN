import { t } from '@nonu/app/i18n';
import { Button, StructuredListRow } from '@nonu/components';
import type { HostAdapter } from '@nonu/host/types';
import type { OperationNotice } from '@nonu/svn';
import { useEffect, useState } from 'react';
import './ReflogView.css';
import { DiffPanel } from './DiffPanel.js';
import { restoreSnapshotFiles } from './restoreFlow.js';
import type { SnapshotDiff } from './snapshotData.js';
import { loadSnapshotDiff, useSnapshotRecords } from './snapshotData.js';

type Show = Parameters<typeof restoreSnapshotFiles>[0]['show'];

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
    return <div className="reflog-empty">{t('reflogEmpty') as string}</div>;

  return (
    <div className="reflog">
      <div className="reflog-list">
        {records.map((r) => (
          <StructuredListRow
            key={r.id}
            columns="minmax(0, 1fr) 40px"
            active={r.id === selected?.id}
            onClick={() => {
              setSelectedId(r.id);
              setSelectedPath(null);
            }}
          >
            <span className="reflog-command">
              <span>{new Date(r.time).toLocaleString()}</span>
              <span className="reflog-muted">{r.command}</span>
            </span>
            <span className="reflog-muted">{r.files.length}</span>
          </StructuredListRow>
        ))}
      </div>
      {selected && (
        <div className="reflog-detail">
          <div className="reflog-detail-head">
            <span className="reflog-command">
              <span>{new Date(selected.time).toLocaleString()}</span>
              <span className="reflog-muted">{selected.command}</span>
            </span>
            <Button
              size="sm"
              onClick={() => restore(selected.files.map((f) => f.path))}
            >
              {t('reflogRestoreAll') as string}
            </Button>
          </div>
          <div className="reflog-files">
            {selected.files.map((f) => (
              <StructuredListRow
                key={f.path}
                columns="16px minmax(0, 1fr) auto"
                active={f.path === selectedPath}
                onClick={() => setSelectedPath(f.path)}
              >
                <span className="reflog-muted">{f.statusBefore}</span>
                <span className="reflog-path">{f.path}</span>
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
                  date: new Date(selected.time).toLocaleString(),
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
                  : (t('reflogPickFile') as string)
              }
            />
          </div>
        </div>
      )}
    </div>
  );
}
