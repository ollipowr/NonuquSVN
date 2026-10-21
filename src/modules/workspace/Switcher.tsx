import { t } from '@nonu/app/i18n';
import { Select } from '@nonu/components/ui/Select';
import type { ProjectStore } from '@nonu/modules/projects/projects';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { changeCount } from './statusBadges.js';
import { type SwitcherRow, switcherRows } from './switcherRows.js';
import {
  getWorkspaceStatus,
  useWorkspaceStatusVersion,
  workspaceKey,
} from './workspaceStore.js';
import './Switcher.css';

/** Keyboard-accessible list of local working copies. */
export function Switcher({
  store,
  currentPath,
  onSelect,
  onMenu,
  onOpen,
  onStart,
  projectId,
  label,
  disabled,
}: {
  store: ProjectStore;
  currentPath: string;
  onSelect: (row: SwitcherRow) => void;
  onMenu?: (row: SwitcherRow, event: ReactMouseEvent) => void;
  onOpen?: () => void;
  onStart?: () => void;
  projectId?: string;
  label?: string;
  disabled?: boolean;
}) {
  useWorkspaceStatusVersion();
  const rows = switcherRows(store, projectId);
  const current = rows.find(
    (row) => workspaceKey(row.localPath) === workspaceKey(currentPath),
  );
  const project = store.projects.find((item) => item.id === projectId);
  return (
    <Select
      className="svn-workspace-select"
      value={current?.workspaceId ?? ''}
      disabled={disabled}
      onOpen={onOpen}
      ariaLabel={t('navBranchSelect') as string}
      emptyLabel={t('switcherEmpty') as string}
      panelTitle={t('chooseBranch') as string}
      panelHint={`${project?.name ?? ''} · ${(t('chooseBranchHint') as (n: number) => string)(rows.length)}`}
      trigger={
        label ? (
          <>
            <span
              className="svn-workspace-choice-icon material-symbols-outlined"
              aria-hidden="true"
            >
              account_tree
            </span>
            <span className="svn-workspace-choice-text">
              <span className="svn-workspace-choice-kicker">
                {t('currentBranch')}
              </span>
              <span className="svn-select-label">{label}</span>
            </span>
            <span className="material-symbols-outlined" aria-hidden="true">
              expand_more
            </span>
          </>
        ) : undefined
      }
      options={rows.map((row) => {
        const status = getWorkspaceStatus(row.localPath);
        const dirty = status ? changeCount(status.changes) : 0;
        return {
          value: row.workspaceId,
          menu: onMenu && ((e) => onMenu(row, e)),
          label: row.name,
          description: [
            t(
              row.kind === 'trunk'
                ? 'branchKindTrunk'
                : row.kind === 'tag'
                  ? 'branchKindTag'
                  : row.kind === 'branch'
                    ? 'branchKindBranch'
                    : 'branchKindOther',
            ) as string,
            row.branch,
          ]
            .filter(Boolean)
            .join(' · '),
          title:
            dirty > 0
              ? (t('branchChangesHint') as (n: number) => string)(dirty)
              : undefined,
          adornment: (
            <span className="svn-workspace-copy-status">
              {dirty > 0 && (
                <span
                  className="svn-workspace-change-badge"
                  title={(t('branchChangesHint') as (n: number) => string)(
                    dirty,
                  )}
                >
                  {dirty}
                </span>
              )}
              {status?.updateAvailable && (
                <span
                  className="svn-workspace-update-badge"
                  title={t('branchUpdateHint') as string}
                >
                  ↓
                </span>
              )}
            </span>
          ),
        };
      })}
      onChange={(id) => {
        const row = rows.find((item) => item.workspaceId === id);
        if (row) onSelect(row);
      }}
      footer={[
        ...(onStart
          ? [
              {
                label: t('addWorktree') as string,
                icon: 'add',
                onClick: onStart,
              },
            ]
          : []),
      ]}
    />
  );
}
