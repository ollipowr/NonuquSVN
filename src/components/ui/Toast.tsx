import { useEffect, useRef } from 'react';
import './Toast.css';

export type ToastNotice = {
  kind: 'info' | 'success' | 'error';
  text: string;
  subtitle?: string;
} | null;

const AUTO_DISMISS_MS = 3000;

interface ToastProps {
  notice: ToastNotice;
  onDismiss: () => void;
  onErrorClick: () => void;
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
    timerRef.current = setTimeout(onDismiss, AUTO_DISMISS_MS);
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
        <span className="svn-toast-title">{notice.text}</span>
        {notice.subtitle && (
          <span className="svn-toast-subtitle">{notice.subtitle}</span>
        )}
      </div>
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
