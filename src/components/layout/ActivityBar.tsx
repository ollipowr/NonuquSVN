import { t } from '@nonu/app/i18n';
import type { HostStorage } from '@nonu/host/types';
import React, { useEffect, useState } from 'react';
import './ActivityBar.css';

const NAV_EXPANDED_KEY = 'nonuqu.navigation.expanded';
const NAV_EXPANDED_EVENT = 'nonuqu:navigation-expanded';

/** Navigation expanded state, shared by the title-bar toggle and every ActivityBar. */
export function useNavExpanded(storage?: HostStorage) {
  const [expanded, setExpanded] = useState(
    () => storage?.getGlobal<boolean>(NAV_EXPANDED_KEY) === true,
  );
  const [error, setError] = useState('');
  useEffect(() => {
    const sync = (e: Event) => setExpanded((e as CustomEvent<boolean>).detail);
    window.addEventListener(NAV_EXPANDED_EVENT, sync);
    return () => window.removeEventListener(NAV_EXPANDED_EVENT, sync);
  }, []);
  const toggle = async () => {
    const next = !expanded;
    try {
      await storage?.setGlobal(NAV_EXPANDED_KEY, next);
      window.dispatchEvent(
        new CustomEvent<boolean>(NAV_EXPANDED_EVENT, { detail: next }),
      );
      setError('');
    } catch (reason) {
      setError(String(reason));
    }
  };
  return { expanded, toggle: () => void toggle(), error };
}

export interface ActivityView<Id extends string> {
  id: Id;
  icon: string;
  label: string;
  badge?: number;
  /** A separator is drawn where the group changes between neighbours. */
  group?: string;
  disabled?: boolean;
  /** Tooltip while disabled; falls back to the label. */
  disabledTitle?: string;
}

export interface ActivityAction {
  id: string;
  icon: string;
  label: string;
  active?: boolean;
  /** Draws a divider above this action. */
  separator?: boolean;
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
}

interface ActivityBarProps<Id extends string> {
  views: ActivityView<Id>[];
  active: Id;
  onChange: (id: Id) => void;
  footer?: ActivityAction[];
  /** Set when a footer action's view is shown instead of a tab view. */
  noneActive?: boolean;
  heading?: string;
  storage?: HostStorage;
  projectName?: string;
  branchName?: string;
}

export function ActivityBar<Id extends string>({
  views,
  active,
  onChange,
  footer,
  noneActive,
  heading,
  storage,
  projectName,
  branchName,
}: ActivityBarProps<Id>) {
  const { expanded } = useNavExpanded(storage);
  return (
    <nav
      className={`svn-ab${expanded ? '' : ' svn-ab--collapsed'}`}
      role={views.length ? 'tablist' : undefined}
      aria-orientation={views.length ? 'vertical' : undefined}
    >
      {heading && <span className="svn-ab-heading">{heading}</span>}
      {views.map((v, i) => {
        const isActive = !noneActive && v.id === active;
        const groupHeading =
          v.group === 'projects'
            ? (t('navProject') as string) +
              (projectName ? ' - ' + projectName : '')
            : v.group === 'workspace'
              ? 'Branch' + (branchName ? ' - ' + branchName : '')
              : undefined;
        const firstInGroup = i === 0 || v.group !== views[i - 1].group;
        const newGroup = i > 0 && v.group !== views[i - 1].group;
        return (
          <React.Fragment key={v.id}>
            {newGroup && <div className="svn-ab-sep" role="separator" />}
            {firstInGroup && groupHeading && v.group !== 'workspace' && (
              <span className="svn-ab-heading" title={groupHeading}>
                {groupHeading}
              </span>
            )}
            <button
              role="tab"
              aria-selected={isActive}
              aria-label={v.label}
              title={
                v.disabled && v.disabledTitle ? v.disabledTitle : v.label
              }
              disabled={v.disabled}
              className={`svn-ab-item${isActive ? ' svn-ab-item--active' : ''}`}
              onKeyDown={(event) => {
                if (
                  !['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)
                )
                  return;
                event.preventDefault();
                const tabs = Array.from(
                  event.currentTarget
                    .closest('nav')!
                    .querySelectorAll<HTMLButtonElement>(
                      'button[role="tab"]:not(:disabled)',
                    ),
                );
                const index = tabs.indexOf(event.currentTarget);
                const next =
                  event.key === 'Home'
                    ? 0
                    : event.key === 'End'
                      ? tabs.length - 1
                      : (index +
                          (event.key === 'ArrowDown' ? 1 : -1) +
                          tabs.length) %
                        tabs.length;
                tabs[next]?.focus();
                tabs[next]?.click();
              }}
              onClick={() => onChange(v.id)}
            >
              <span className="material-symbols-outlined svn-ab-icon">
                {v.icon}
              </span>
              <span className="svn-ab-label">{v.label}</span>
              {!!v.badge && (
                <span className="svn-ab-badge">
                  {v.badge > 99 ? '99+' : v.badge}
                </span>
              )}
            </button>
          </React.Fragment>
        );
      })}
      {footer && footer.length > 0 && (
        <div className="svn-ab-footer">
          {footer.map((a) => (
            <React.Fragment key={a.id}>
              {a.separator && <div className="svn-ab-sep" role="separator" />}
              <button
                aria-label={a.label}
                title={a.label}
                className={`svn-ab-item${a.active ? ' svn-ab-item--active' : ''}`}
                onClick={a.onClick}
              >
                <span className="material-symbols-outlined svn-ab-icon">
                  {a.icon}
                </span>
                <span className="svn-ab-label">{a.label}</span>
              </button>
            </React.Fragment>
          ))}
        </div>
      )}
    </nav>
  );
}
