import { useEffect, useRef } from 'react';
import './Toast.css';

export type ToastNotice = {
  kind: 'info' | 'success' | 'error';
  text: string;
  subtitle?: string;
  action?: { label: string; onClick: () => void };
} | null;

const AUTO_DISMISS_MS = 3000;
// Long enough to reach an action button before the toast disappears.
const ACTION_DISMISS_MS = 10000;

interface ToastProps {
  notice: ToastNotice;
  onDismiss: () => void;
  onErrorClick: () => void;
}

// A quoted path is the part worth reading: truncate it at the start, keep its end.
function ToastTitle({ text }: { text: string }) {
  const line = text.trim().split('\n')[0];
  const m = /^([^']*')([^']+)('.*)$/.exec(line);
  if (!m) return <span className="svn-toast-title">{text}</span>;
  return (
    <span className="svn-toast-title svn-toast-title--path">
      <span>{m[1]}</span>
      <span className="svn-toast-path">
        <bdo dir="ltr">{m[2]}</bdo>
      </span>
      <span>{m[3]}</span>
    </span>
  );
}

/** Floating feedback for the last SVN operation; errors stay until dismissed. */
export function Toast({ notice, onDismiss, onErrorClick }: ToastProps) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = () => {
    if (timerRef.current != null) clearTimeout(timerRef.current);
    timerRef.current = null;
  };
  const startTimer = () => {
    if (!notice || notice.kind === 'error') return;
    timerRef.current = setTimeout(
      onDismiss,
      notice.action ? ACTION_DISMISS_MS : AUTO_DISMISS_MS,
    );
  };

  useEffect(() => {
    startTimer();
    return clearTimer;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-arm only when the notice itself changes
  }, [notice]);

  if (!notice) return null;

  return (
    <div
      className={`svn-toast svn-toast--${notice.kind}${notice.kind === 'error' ? ' svn-toast--clickable' : ''}`}
      onClick={notice.kind === 'error' ? onErrorClick : undefined}
      onMouseEnter={clearTimer}
      onMouseLeave={startTimer}
      role="status"
    >
      <div className="svn-toast-body">
        <ToastTitle text={notice.text} />
        {notice.subtitle && (
          <span className="svn-toast-subtitle">{notice.subtitle}</span>
        )}
      </div>
      {notice.action && (
        <button
          type="button"
          className="svn-toast-action"
          onClick={notice.action.onClick}
        >
          {notice.action.label}
        </button>
      )}
      {notice.kind === 'error' && (
        <button
          type="button"
          className="svn-toast-close"
          aria-label="Dismiss"
          onClick={(e) => {
            e.stopPropagation();
            onDismiss();
          }}
        >
          <span className="material-symbols-outlined">close</span>
        </button>
      )}
    </div>
  );
}
