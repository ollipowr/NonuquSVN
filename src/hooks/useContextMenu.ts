import { useState } from 'react';

/** Context-menu state: open position plus an arbitrary payload (`data`), independent of how items render. */
export function useContextMenu<T>() {
  const [menu, setMenuState] = useState<{
    x: number;
    y: number;
    data: T;
  } | null>(null);

  const open = (
    e: { clientX: number; clientY: number; preventDefault?: () => void },
    data: T,
  ) => {
    e.preventDefault?.();
    setMenuState({ x: e.clientX, y: e.clientY, data });
  };

  const close = () => setMenuState(null);

  return { menu, open, close };
}
