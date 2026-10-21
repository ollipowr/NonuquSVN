import {
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import './Select.css';
export interface SelectOption {
  value: string;
  label: string;
  icon?: string;
  description?: string;
  adornment?: ReactNode;
  disabled?: boolean;
  title?: string;
  /** Shows a "…" button on the row that calls this with the click position. */
  menu?: (event: ReactMouseEvent) => void;
}
interface SelectFooterItem {
  label: string;
  icon?: string;
  onClick: () => void;
}
export interface SelectProps {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  className?: string;
  variant?: 'default' | 'filled';
  size?: 'default' | 'small';
  trigger?: ReactNode;
  footer?: SelectFooterItem[];
  disabled?: boolean;
  ariaLabel?: string;
  emptyLabel?: string;
  panelTitle?: string;
  panelHint?: string;
  /** Replaces opening the list on click (e.g. to open a folder instead). */
  onOpen?: () => void;
}
export function Select({
  value,
  options,
  onChange,
  className,
  variant = 'default',
  size = 'default',
  trigger,
  footer,
  disabled = false,
  ariaLabel,
  emptyLabel,
  panelTitle,
  panelHint,
  onOpen,
}: SelectProps) {
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const id = useId();
  const close = (restore = false) => {
    setOpen(false);
    if (restore) button.current?.focus();
  };
  const choose = (option: SelectOption) => {
    if (option.disabled) return;
    close(true);
    if (option.value !== value) onChange(option.value);
  };
  const show = () => {
    const selected = options.findIndex((o) => o.value === value && !o.disabled);
    setIndex(
      selected >= 0
        ? selected
        : Math.max(
            0,
            options.findIndex((o) => !o.disabled),
          ),
    );
    setOpen(true);
  };
  useEffect(() => {
    if (!open) return;
    list.current?.focus();
    const down = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setOpen(false);
        button.current?.focus();
      }
    };
    window.addEventListener('mousedown', down);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('mousedown', down);
      window.removeEventListener('keydown', key);
    };
  }, [open]);
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);
  useEffect(() => {
    if (open)
      (
        list.current?.children[index] as HTMLElement | undefined
      )?.scrollIntoView?.({ block: 'nearest' });
  }, [open, index]);
  const current = options.find((o) => o.value === value);
  const move = (direction: number) => {
    const enabled = options
      .map((option, i) => ({ option, i }))
      .filter(({ option }) => !option.disabled);
    if (!enabled.length) return;
    const position = enabled.findIndex((item) => item.i === index);
    setIndex(
      enabled[(position + direction + enabled.length) % enabled.length].i,
    );
  };
  return (
    <div
      className={'svn-menu' + (className ? ' ' + className : '')}
      ref={ref}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node))
          setOpen(false);
      }}
    >
      <button
        ref={button}
        type="button"
        className={
          'svn-select-trigger' +
          (variant === 'filled' ? ' svn-select-trigger--filled' : '') +
          (size === 'small' ? ' svn-select-trigger--small' : '') +
          (open ? ' is-open' : '')
        }
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => (onOpen ? onOpen() : open ? close() : show())}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            show();
          }
        }}
      >
        {trigger ?? (
          <>
            <span className="svn-select-label">{current?.label ?? value}</span>
            <span className="material-symbols-outlined" aria-hidden="true">
              expand_more
            </span>
          </>
        )}
      </button>
      {open && (
        <div className="svn-menu-popup svn-select-popup">
          {panelTitle && (
            <div className="svn-select-panel-head">
              <strong>{panelTitle}</strong>
              {panelHint && <span>{panelHint}</span>}
            </div>
          )}
          <div
            ref={list}
            id={id}
            role="listbox"
            aria-label={ariaLabel}
            tabIndex={-1}
            aria-activedescendant={
              options[index] ? id + '-' + index : undefined
            }
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault();
                move(event.key === 'ArrowDown' ? 1 : -1);
              } else if (event.key === 'Home' || event.key === 'End') {
                event.preventDefault();
                const enabled = options
                  .map((o, i) => (!o.disabled ? i : -1))
                  .filter((i) => i >= 0);
                setIndex(
                  enabled[event.key === 'Home' ? 0 : enabled.length - 1] ?? 0,
                );
              } else if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                if (options[index]) choose(options[index]);
              } else if (event.key === 'Tab') close();
            }}
          >
            {options.map((option, i) => (
              <button
                key={option.value}
                id={id + '-' + i}
                type="button"
                tabIndex={-1}
                role="option"
                aria-selected={option.value === value}
                disabled={option.disabled}
                title={option.title}
                className={
                  'svn-menu-item' +
                  (index === i ? ' svn-select-option--cursor' : '')
                }
                onMouseEnter={() => setIndex(i)}
                onClick={() => choose(option)}
              >
                <span className="svn-menu-check">
                  {option.value === value ? '✓' : ''}
                </span>
                {option.icon && (
                  <span
                    className="svn-select-row-icon material-symbols-outlined"
                    aria-hidden="true"
                  >
                    {option.icon}
                  </span>
                )}
                <span className="svn-menu-label">
                  {option.label}
                  {option.description && (
                    <small className="svn-select-description">
                      {option.description}
                    </small>
                  )}
                </span>
                {option.adornment}
                {option.menu && (
                  // A span, not a button: it sits inside the option button.
                  <span
                    className="svn-select-more material-symbols-outlined"
                    aria-hidden="true"
                    onClick={(event) => {
                      event.stopPropagation();
                      option.menu?.(event);
                    }}
                  >
                    more_horiz
                  </span>
                )}
              </button>
            ))}
            {!options.length && emptyLabel && (
              <div className="svn-select-empty" role="status">
                {emptyLabel}
              </div>
            )}
          </div>
          {!!footer?.length && (
            <>
              <div className="svn-menu-sep" />
              {footer.map((item, i) => (
                <button
                  key={i}
                  type="button"
                  className="svn-menu-item"
                  onClick={() => {
                    close(true);
                    item.onClick();
                  }}
                >
                  <span className="svn-menu-check" />
                  {item.icon && (
                    <span
                      className="svn-select-row-icon material-symbols-outlined"
                      aria-hidden="true"
                    >
                      {item.icon}
                    </span>
                  )}
                  <span className="svn-menu-label">{item.label}</span>
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
