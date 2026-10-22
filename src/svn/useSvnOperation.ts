import { t } from '@nonu/app/i18n';
import type { AuthDialogResult, LogEntry } from '@nonu/components';
import { useCallback, useState } from 'react';

import {
  isAuthError,
  isConnectionError,
  type SvnCredentials,
  SvnError,
} from './svn.js';

export type OperationNotice = {
  kind: 'info' | 'success' | 'error';
  text: string;
  /** Second line shown under the title in the toast (e.g. the revision). */
  subtitle?: string;
  command?: string;
  stderr?: string;
  action?: { label: string; onClick: () => void };
} | null;
/** Lets a long operation write intermediate lines to the output panel. */
export type OperationLog = (entry: LogEntry) => void;
type PendingOp = {
  label: string;
  fn: (credentials?: SvnCredentials, log?: OperationLog) => Promise<string>;
  refresh: boolean;
};
/** First line is the toast title, the rest (if any) is the subtitle. */
function splitNotice(out: string): { text: string; subtitle?: string } {
  const newline = out.indexOf('\n');
  if (newline === -1) return { text: out };
  return { text: out.slice(0, newline), subtitle: out.slice(newline + 1) };
}

export function toOperationNotice(err: unknown): OperationNotice {
  if (err instanceof SvnError)
    return {
      kind: 'error',
      text: err.message,
      command: err.command,
      stderr: err.stderr,
    };
  return {
    kind: 'error',
    text: err instanceof Error ? err.message : String(err),
  };
}

export function useSvnOperation({
  setBusy,
  setPill,
  appendLog,
  refresh,
}: {
  setBusy: (busy: boolean) => void;
  setPill: (notice: OperationNotice) => void;
  appendLog: (entry: LogEntry) => void;
  refresh: () => Promise<void>;
}) {
  const [pendingAuth, setPendingAuth] = useState<PendingOp | null>(null);
  const [authBusy, setAuthBusy] = useState(false);
  const run = useCallback(
    async (
      label: string,
      fn: (credentials?: SvnCredentials, log?: OperationLog) => Promise<string>,
      options: { refresh?: boolean } = {},
    ) => {
      setBusy(true);
      setPill({ kind: 'info', text: `${label}…` }); // label is already translated at call site
      appendLog({ kind: 'info', text: `${label}…`, ts: Date.now() });
      try {
        const out = await fn(undefined, appendLog);
        const text = out || `${label} done.`;
        setPill({ kind: 'success', ...splitNotice(text) });
        appendLog({ kind: 'success', text, ts: Date.now() });
      } catch (err) {
        if (err instanceof SvnError && isAuthError(err)) {
          setPendingAuth({ label, fn, refresh: options.refresh !== false });
          const p = {
            kind: 'error' as const,
            text: (t('authNeeded') as (label: string) => string)(label),
            command: err.command,
            stderr: err.stderr,
          };
          setPill(p);
          appendLog({ ...p, ts: Date.now() });
        } else if (err instanceof SvnError && isConnectionError(err)) {
          const p = {
            kind: 'error' as const,
            text: (t('connectionFailed') as (label: string) => string)(label),
            command: err.command,
            stderr: err.stderr,
          };
          setPill(p);
          appendLog({ ...p, ts: Date.now() });
        } else {
          const p = toOperationNotice(err)!;
          setPill(p);
          appendLog({ ...p, kind: p.kind, ts: Date.now() });
        }
      } finally {
        setBusy(false);
        // Re-read status regardless of outcome: a failed commit can still have
        // changed the working copy (e.g. partial add). Read-only callers may opt out.
        if (options.refresh !== false) await refresh();
      }
    },
    [refresh, appendLog, setBusy, setPill],
  );

  const onAuthSubmit = useCallback(
    async (result: AuthDialogResult) => {
      if (!pendingAuth) return;
      setAuthBusy(true);
      try {
        const credentials: SvnCredentials = {
          username: result.username,
          password: result.password,
          trustServerCert: result.trustServerCert,
        };
        appendLog({
          kind: 'info',
          text: `${pendingAuth.label}…`,
          ts: Date.now(),
        });
        setPill({ kind: 'info', text: `${pendingAuth.label}…` });
        const out = await pendingAuth.fn(credentials, appendLog);
        const text = out || `${pendingAuth.label} done.`;
        setPill({ kind: 'success', text });
        appendLog({ kind: 'success', text, ts: Date.now() });
        setPendingAuth(null);
      } catch (err) {
        const p = toOperationNotice(err)!;
        setPill(p);
        appendLog({ ...p, kind: p.kind, ts: Date.now() });
      } finally {
        setAuthBusy(false);
        if (pendingAuth.refresh) await refresh();
      }
    },
    [pendingAuth, refresh, appendLog, setPill],
  );

  return {
    run,
    pendingAuth,
    authBusy,
    onAuthSubmit,
    cancelAuth: () => setPendingAuth(null),
  };
}
