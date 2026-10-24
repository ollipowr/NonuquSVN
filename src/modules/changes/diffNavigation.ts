import { useEffect } from 'react';

// Document-level so Ctrl+Up/Down works regardless of which element has focus.
export function useChangeJumpShortcut(jump: (dir: 'prev' | 'next') => boolean) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || !e.ctrlKey || e.altKey || e.shiftKey) return;
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === 'INPUT' ||
          t.tagName === 'TEXTAREA' ||
          t.isContentEditable)
      )
        return;
      if (jump(e.key === 'ArrowDown' ? 'next' : 'prev')) e.preventDefault();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [jump]);
}

export function nextChangeIndex(
  current: number | null,
  count: number,
  direction: 'prev' | 'next',
): number | null {
  if (count === 0) return null;
  if (current === null || current >= count)
    return direction === 'next' ? 0 : count - 1;
  return (current + (direction === 'next' ? 1 : -1) + count) % count;
}
