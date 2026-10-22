import type { HostAdapter } from '@nonu/host/types';
import type { SvnBlameLine, SvnLogEntry } from '@nonu/svn';
import { runSvn } from '@nonu/svn';
import { useState } from 'react';
import { BlameDialog } from './BlameDialog.js';
import {
  loadFileBlame,
  loadFileHistory,
  loadHistory,
  loadRevisionFiles,
} from './historyLoader.js';
import { LogDialog } from './LogDialog.js';
import { LogView } from './LogView.js';
export function ProjectLogView({
  host,
  url,
}: {
  host: HostAdapter;
  url: string;
}) {
  const [mode, setMode] = useState<'inline' | 'split'>('inline');
  const [log, setLog] = useState<{
    path: string;
    entries: SvnLogEntry[];
  } | null>(null);
  const [blame, setBlame] = useState<{
    path: string;
    lines: SvnBlameLine[];
  } | null>(null);
  const cwd = host.workspacePath || '.';
  const target = async (path: string, revision: string) => {
    const { stdout } = await runSvn(
      ['info', '--show-item', 'repos-root-url', url],
      cwd,
    );
    return (
      stdout.trim().replace(/\/+$/, '') +
      '/' +
      path.replace(/^\/+/, '') +
      '@' +
      revision
    );
  };
  return (
    <>
      <LogView
        diffMode={mode}
        onDiffModeChange={setMode}
        load={(query) => loadHistory(cwd, query, url)}
        loadRevisionFiles={(revision, path, action) =>
          loadRevisionFiles(cwd, (rev) => target(path, rev), revision, action)
        }
        onLogFile={async (path, revision) =>
          setLog({
            path,
            entries: await loadFileHistory(
              cwd,
              await target(path, revision),
              revision,
            ),
          })
        }
        onBlameFile={async (path, revision, action) => {
          const rev =
            action === 'D'
              ? String(Math.max(1, Number(revision) - 1))
              : revision;
          setBlame({
            path,
            lines: await loadFileBlame(cwd, await target(path, rev), rev),
          });
        }}
      />
      {log && <LogDialog {...log} onClose={() => setLog(null)} />}
      {blame && <BlameDialog {...blame} onClose={() => setBlame(null)} />}
    </>
  );
}
