import { t } from '@nonu/app/i18n';
import { Button } from '@nonu/components/ui/Button';
import { TextInput } from '@nonu/components/ui/TextInput';
import type {
  NonuquProject,
  RepositoryWorkspace,
} from '@nonu/modules/projects/projects';
import React, { useState } from 'react';
import { StatusBadges } from './StatusBadges.js';
import { type Badges, summarize } from './startModel.js';

export interface GroupRow {
  workspace: RepositoryWorkspace;
  badges?: Badges;
  revision?: string;
  current: boolean;
}

const KIND_LABEL = { trunk: 'Trunk', branch: 'Branch', tag: 'Tag', other: '' };

export function ProjectGroup({
  project,
  rows,
  hiddenCount,
  showHidden,
  expanded,
  renaming,
  busy,
  onToggle,
  onToggleHidden,
  onOpen,
  onRowMenu,
  onProjectMenu,
  onRename,
  onRenameCancel,
}: {
  project: NonuquProject;
  rows: GroupRow[];
  hiddenCount: number;
  showHidden: boolean;
  expanded: boolean;
  renaming: boolean;
  busy: boolean;
  onToggle: () => void;
  onToggleHidden: () => void;
  onOpen: (workspace: RepositoryWorkspace) => void;
  onRowMenu: (e: React.MouseEvent, workspace: RepositoryWorkspace) => void;
  onProjectMenu: (e: React.MouseEvent<HTMLElement>) => void;
  onRename: (name: string) => void;
  onRenameCancel: () => void;
}) {
  const [draft, setDraft] = useState(project.name);
  const sum = summarize(rows.map((r) => r.badges));
  return (
    <section className="svn-home-project">
      <div className="svn-home-project-head" onContextMenu={onProjectMenu}>
        <button
          type="button"
          className="svn-home-toggle"
          aria-expanded={expanded}
          onClick={onToggle}
        >
          <span className="material-symbols-outlined">
            {expanded ? 'expand_more' : 'chevron_right'}
          </span>
          <span className="svn-home-initial">
            {project.name.slice(0, 1).toLocaleUpperCase()}
          </span>
        </button>
        {renaming ? (
          <TextInput
            className="svn-home-rename"
            autoFocus
            maxLength={100}
            value={draft}
            onChange={setDraft}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onRename(draft);
              if (e.key === 'Escape') onRenameCancel();
            }}
            onBlur={onRenameCancel}
          />
        ) : (
          <strong className="svn-home-project-name">{project.name}</strong>
        )}
        <span className="svn-home-muted">
          {(t('homeCopies') as (n: number) => string)(rows.length)}
        </span>
        {!expanded &&
          (sum.dirty > 0 || sum.conflicts > 0 || sum.updates > 0) && (
            <span className="svn-home-summary">
              {sum.conflicts > 0 && (
                <span className="svn-home-badge svn-home-badge--error">
                  ⚠ {sum.conflicts}
                </span>
              )}
              {sum.dirty > 0 && (
                <span className="svn-home-badge svn-home-badge--dirty">
                  ● {sum.dirty}
                </span>
              )}
              {sum.updates > 0 && (
                <span className="svn-home-badge svn-home-badge--update">
                  ↓ {sum.updates}
                </span>
              )}
            </span>
          )}
        <span className="svn-home-grow" />
        <Button
          variant="ghost"
          icon
          className="svn-home-iconbtn"
          title={t('homeProjectMenu') as string}
          aria-label={t('homeProjectMenu') as string}
          onClick={onProjectMenu}
        >
          <span className="material-symbols-outlined">more_horiz</span>
        </Button>
      </div>
      {expanded && (
        <div className="svn-home-rows">
          {rows.map(({ workspace, badges, revision, current }) => (
            <button
              key={workspace.id}
              type="button"
              className={`svn-home-row${current ? ' svn-home-row--current' : ''}`}
              disabled={busy || badges?.missing}
              title={workspace.localPath}
              onClick={() => onOpen(workspace)}
              onContextMenu={(e) => onRowMenu(e, workspace)}
            >
              <span className="svn-home-kind">
                {KIND_LABEL[workspace.kind]}
              </span>
              <span className="svn-home-name">{workspace.name}</span>
              <StatusBadges badges={badges} />
              <span className="svn-home-rev">
                {revision ? `r${revision}` : ''}
              </span>
            </button>
          ))}
          {hiddenCount > 0 && (
            <Button
              variant="ghost"
              className="svn-home-more"
              onClick={onToggleHidden}
            >
              {showHidden
                ? (t('homeHideAgain') as string)
                : (t('homeHiddenCount') as (n: number) => string)(hiddenCount)}
            </Button>
          )}
        </div>
      )}
    </section>
  );
}
