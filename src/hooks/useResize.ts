import { type MouseEvent, useEffect, useRef } from 'react';

type Drag = {
  value: (event: globalThis.MouseEvent) => number;
  min: number;
  max: number | (() => number);
};

/** Shares drag lifecycle; callers own geometry, units, state and persistence. */
export function useResize({
  start,
  onChange,
  onEnd,
}: {
  start: (event: MouseEvent) => Drag | null;
  onChange: (value: number) => void;
  onEnd?: (value: number) => void;
}) {
  const cleanup = useRef<(() => void) | null>(null);
  useEffect(() => () => cleanup.current?.(), []);
  return (event: MouseEvent) => {
    event.preventDefault();
    cleanup.current?.();
    const drag = start(event);
    if (!drag) return;
    let latest: number | undefined;
    const move = (next: globalThis.MouseEvent) => {
      const max = typeof drag.max === 'function' ? drag.max() : drag.max;
      latest = Math.min(Math.max(drag.value(next), drag.min), max);
      onChange(latest);
    };
    const dispose = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', stop);
      window.removeEventListener('blur', stop);
      cleanup.current = null;
    };
    const stop = () => {
      dispose();
      if (latest !== undefined) onEnd?.(latest);
    };
    cleanup.current = dispose;
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', stop);
    window.addEventListener('blur', stop);
  };
}
