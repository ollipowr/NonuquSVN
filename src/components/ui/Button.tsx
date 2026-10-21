import { t } from '@nonu/app/i18n';
import type { ButtonHTMLAttributes } from 'react';
import { forwardRef, useEffect, useRef, useState } from 'react';
import './button.css';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'primary' | 'danger' | 'ghost' | 'mode';
  size?: 'md' | 'sm';
  icon?: boolean;
  /** Square 24px button for a single icon. */
  iconOnly?: boolean;
  active?: boolean;
  scan?: boolean;
  scanActive?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    {
      variant = 'default',
      size = 'md',
      icon = false,
      iconOnly = false,
      active = false,
      scan = false,
      scanActive = false,
      className,
      type = 'button',
      children,
      ...props
    },
    ref,
  ) {
    const classes = [
      'svn-btn',
      variant !== 'default' && `svn-btn--${variant}`,
      size === 'sm' && 'svn-btn--sm',
      icon && 'svn-btn--icon',
      iconOnly && 'svn-btn--square',
      active && 'svn-btn--active',
      scan && 'svn-btn--scan',
      scanActive && 'svn-btn--scan-active',
      className,
    ]
      .filter(Boolean)
      .join(' ');

    return (
      <button ref={ref} {...props} type={type} className={classes}>
        {children}
      </button>
    );
  },
);

export interface SplitButtonItem {
  label: string;
  icon?: string;
  onClick: () => void;
}

export interface SplitButtonProps {
  /** Primary action — shown as the main button label. */
  primary: SplitButtonItem;
  /** Additional items shown in the dropdown (primary is also listed first). */
  items: SplitButtonItem[];
  variant?: ButtonProps['variant'];
  className?: string;
  disabled?: boolean;
}

export function SplitButton({
  primary,
  items,
  variant = 'mode',
  className,
  disabled,
}: SplitButtonProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const btnCls = [
    'svn-btn',
    variant !== 'default' && `svn-btn--${variant}`,
    'svn-edit-btn',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  const hasItems = items.length > 0;

  return (
    <div ref={rootRef} className="svn-menu svn-split-btn">
      <button
        type="button"
        className={`${btnCls}${hasItems ? ' svn-split-btn__primary' : ''}`}
        disabled={disabled}
        onClick={() => {
          primary.onClick();
          setOpen(false);
        }}
      >
        {primary.icon && (
          <span className="material-symbols-outlined">{primary.icon}</span>
        )}
        {primary.label}
      </button>
      {hasItems && (
        <button
          type="button"
          className={`${btnCls} svn-split-btn__chevron`}
          disabled={disabled}
          aria-label={t('moreActions')}
          onClick={() => setOpen((v) => !v)}
        >
          <span className="material-symbols-outlined">arrow_drop_down</span>
        </button>
      )}
      {open && hasItems && (
        <div className="svn-menu-popup svn-split-btn__menu" role="menu">
          {items.map((item, i) => (
            <button
              key={i}
              type="button"
              role="menuitem"
              className="svn-menu-item svn-split-btn__item"
              onClick={() => {
                item.onClick();
                setOpen(false);
              }}
            >
              {item.icon && (
                <span className="material-symbols-outlined">{item.icon}</span>
              )}
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
