import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import './ContextMenu.css';

export interface ContextMenuItem {
  label?: string;
  icon?: string;
  /** Renders a check mark when true (and keeps the label aligned when false). */
  checked?: boolean;
  onClick?: () => void;
  /** Theme id: shows a small background/primary color swatch at the right. */
  theme?: string;
  /** Shortcut text shown at the right. */
  hint?: string;
  separator?: boolean;
  /** Renders a flyout with these items on hover instead of a click action. */
  submenu?: ContextMenuItem[];
}

/** Flyout that shifts up when it would run past the bottom of the window. */
function ContextSubmenu({
  label,
  children,
}: {
  label?: string;
  children: React.ReactNode;
}) {
  const flyoutRef = useRef<HTMLDivElement>(null);
  const [shift, setShift] = useState(0);

  const onOpen = () => {
    const el = flyoutRef.current;
    if (!el) return;
    // Undo the previous shift so the measurement reflects the natural position.
    const bottom = el.getBoundingClientRect().bottom - shift;
    const overflow = bottom + 4 - window.innerHeight;
    setShift(overflow > 0 ? -overflow : 0);
  };

  return (
    <div className="svn-context-menu-group" onMouseEnter={onOpen}>
      <button className="svn-context-menu-item" aria-haspopup="menu">
        <span>{label}</span>
        <span className="svn-context-menu-chevron material-symbols-outlined">
          chevron_right
        </span>
      </button>
      <div
        ref={flyoutRef}
        className="svn-context-menu-flyout"
        style={{ transform: `translateY(${shift}px)` }}
      >
        {children}
      </div>
    </div>
  );
}

export function ContextMenu({
  x,
  y,
  items,
  onClose,
}: {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const MARGIN = 4;
    setPos({
      left: x + width + MARGIN > vw ? Math.max(MARGIN, vw - width - MARGIN) : x,
      top:
        y + height + MARGIN > vh ? Math.max(MARGIN, vh - height - MARGIN) : y,
    });
  }, [x, y]);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose]);

  const renderItem = (item: ContextMenuItem, i: number) => {
    if (item.separator)
      return <div key={i} className="svn-context-menu-separator" />;
    if (item.submenu)
      return (
        <ContextSubmenu key={i} label={item.label}>
          {item.submenu.map(renderItem)}
        </ContextSubmenu>
      );
    return (
      <button
        key={i}
        className={`svn-context-menu-item${item.checked ? ' svn-context-menu-item--checked' : ''}`}
        onClick={() => {
          onClose();
          item.onClick?.();
        }}
      >
        {item.checked !== undefined ? (
          <span className="svn-context-menu-icon svn-context-menu-check material-symbols-outlined">
            {item.checked ? 'check' : ''}
          </span>
        ) : (
          item.icon && (
            <span className="svn-context-menu-icon material-symbols-outlined">
              {item.icon}
            </span>
          )
        )}
        <span>{item.label}</span>
        {item.hint && (
          <span className="svn-context-menu-hint">{item.hint}</span>
        )}
        {item.theme && (
          <span
            className="svn-context-menu-swatch"
            data-theme={item.theme}
            aria-hidden="true"
          />
        )}
      </button>
    );
  };

  return (
    <div
      ref={ref}
      className="svn-context-menu"
      style={{ left: pos.left, top: pos.top }}
      // Menus with flyouts close once the pointer leaves them; plain menus stay until a click outside.
      onMouseLeave={items.some((i) => i.submenu) ? onClose : undefined}
    >
      {items.map(renderItem)}
    </div>
  );
}
