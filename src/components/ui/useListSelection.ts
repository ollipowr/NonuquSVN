import {
  type KeyboardEvent,
  type MouseEvent,
  type RefObject,
  useRef,
  useState,
} from 'react';

type Options = {
  keys: string[];
  listRef: RefObject<HTMLDivElement | null>;
  activeKey?: string | null;
  onNavigate?: (key: string) => void;
  onEnter?: (keys: Set<string>, anchor: string | null) => void;
  onSpace?: (keys: Set<string>) => void;
  onRefresh?: () => void;
  rangeMode?: 'replace' | 'extend';
  scrollToKey?: (key: string, index: number) => void;
};

/** Shared listbox selection: click, Ctrl/Cmd toggle, Shift range, arrows, and Ctrl/Cmd+A. */
export function useListSelection({
  keys,
  listRef,
  activeKey,
  onNavigate,
  onEnter,
  onSpace,
  onRefresh,
  rangeMode = 'replace',
  scrollToKey,
}: Options) {
  const [highlighted, setHighlighted] = useState<Set<string>>(new Set());
  const anchorRef = useRef<string | null>(null);

  const select = (event: MouseEvent, key: string) => {
    listRef.current?.focus({ preventScroll: true });
    if (event.shiftKey && anchorRef.current) {
      const a = keys.indexOf(anchorRef.current);
      const b = keys.indexOf(key);
      if (a !== -1 && b !== -1) {
        const [start, end] = a < b ? [a, b] : [b, a];
        setHighlighted(new Set(keys.slice(start, end + 1)));
      }
    } else if (event.ctrlKey || event.metaKey) {
      setHighlighted((current) => {
        const next = new Set(current);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      });
      anchorRef.current = key;
    } else {
      setHighlighted(new Set([key]));
      anchorRef.current = key;
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'F5' && onRefresh) {
      event.preventDefault();
      onRefresh();
      return;
    }
    if (event.key === 'a' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      setHighlighted(new Set(keys));
      if (keys.length) anchorRef.current = keys.at(-1)!;
      return;
    }
    if (event.key === 'Enter' && highlighted.size > 0) {
      event.preventDefault();
      onEnter?.(highlighted, anchorRef.current);
      return;
    }
    if (event.key === ' ' && highlighted.size > 0) {
      event.preventDefault();
      onSpace?.(highlighted);
      return;
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    if (keys.length === 0) return;
    const currentIndex = anchorRef.current
      ? keys.indexOf(anchorRef.current)
      : keys.indexOf(activeKey ?? '');
    const nextIndex =
      event.key === 'ArrowDown'
        ? Math.min(keys.length - 1, currentIndex + 1)
        : Math.max(0, currentIndex === -1 ? 0 : currentIndex - 1);
    const key = keys[nextIndex];
    const anchorIndex = currentIndex === -1 ? nextIndex : currentIndex;
    if (
      event.shiftKey &&
      (rangeMode !== 'extend' ||
        (anchorRef.current && currentIndex !== nextIndex))
    ) {
      const [start, end] =
        anchorIndex < nextIndex
          ? [anchorIndex, nextIndex]
          : [nextIndex, anchorIndex];
      setHighlighted(
        (current) =>
          new Set([
            ...(rangeMode === 'extend' ? current : []),
            ...keys.slice(start, end + 1),
          ]),
      );
    } else {
      setHighlighted(new Set([key]));
    }
    anchorRef.current = key;
    onNavigate?.(key);
    if (scrollToKey) scrollToKey(key, nextIndex);
    else
      listRef.current
        ?.querySelector<HTMLElement>(`[data-list-key="${CSS.escape(key)}"]`)
        ?.scrollIntoView({ block: 'nearest' });
  };

  return { highlighted, setHighlighted, select, onKeyDown, anchorRef };
}
