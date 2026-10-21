import { t } from '@nonu/app/i18n';
import {
  ConfirmDialog,
  ContextMenu,
  type ContextMenuItem,
  Dialog,
} from '@nonu/components';
import { Button } from '@nonu/components/ui/Button';
import { Select } from '@nonu/components/ui/Select';
import { TextField } from '@nonu/components/ui/TextField';
import type { HostStorage } from '@nonu/host/types';
import { updateBranch } from '@nonu/modules/branches/branches';
import {
  loadProjectStore,
  mergeProjects,
  type NonuquProject,
  PROJECTS_CHANGED,
  type ProjectStore,
  removeProject,
  removeWorkspace,
  renameProject,
  renameWorkspace,
  saveProjectStore,
} from '@nonu/modules/projects/projects';
import { type MouseEvent as ReactMouseEvent, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Switcher } from './Switcher.js';
import type { SwitcherRow } from './switcherRows.js';
import type { WorkspaceChrome } from './WorkspaceView.js';
import { workspaceKey } from './workspaceStore.js';
import './WorkspaceBar.css';
export function WorkspaceBar({
  workspace,
  chrome,
  switching = false,
  storage,
  onAddProject,
  onOpenWorkingCopy,
}: {
  workspace: string;
  chrome?: WorkspaceChrome | null;
  switching?: boolean;
  storage: HostStorage;
  onAddProject?: () => void;
  onOpenWorkingCopy?: () => void;
}) {
  const [store, setStore] = useState(() => loadProjectStore(storage));
  const project = store.projects.find((p) => p.id === store.activeProjectId);
  const copy = store.workspaces.find(
    (w) =>
      w.localPath &&
      workspaceKey(w.localPath) === workspaceKey(workspace) &&
      w.projectId === project?.id,
  );
  const upToDate = chrome?.updateAvailable === false;
  const branch =
    copy?.name ||
    copy?.svnUrl.replace(/\/+$/, '').split('/').pop() ||
    workspace.replace(/\\/g, '/').split('/').pop();
  useEffect(() => {
    const reload = () => setStore(loadProjectStore(storage));
    window.addEventListener(PROJECTS_CHANGED, reload);
    return () => window.removeEventListener(PROJECTS_CHANGED, reload);
  }, [storage]);

  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    items: ContextMenuItem[];
  } | null>(null);
  const [confirm, setConfirm] = useState<{
    title: string;
    message: string;
    confirmLabel: string;
    run: () => void;
  } | null>(null);
  const apply = (change: (s: ProjectStore) => ProjectStore) =>
    void saveProjectStore(storage, change(loadProjectStore(storage))).then(() =>
      window.dispatchEvent(new Event(PROJECTS_CHANGED)),
    );
  const [renaming, setRenaming] = useState<{
    kind: 'project' | 'branch';
    id: string;
    name: string;
  } | null>(null);
  const commitRename = (r: { kind: string; id: string; name: string }) => {
    setRenaming(null);
    apply((s) =>
      r.kind === 'branch'
        ? renameWorkspace(s, r.id, r.name)
        : renameProject(s, r.id, r.name),
    );
  };
  const openMenu = (e: ReactMouseEvent, items: ContextMenuItem[]) =>
    setMenu({ x: e.clientX, y: e.clientY, items });
  const projectMenu = (e: ReactMouseEvent, p: NonuquProject) => {
    const others = store.projects.filter((o) => o.id !== p.id);
    openMenu(e, [
      {
        icon: 'edit',
        label: t('homeCtxRename') as string,
        onClick: () => setRenaming({ kind: 'project', id: p.id, name: p.name }),
      },
      ...(others.length
        ? [
            {
              icon: 'merge',
              label: t('homeCtxMerge') as string,
              submenu: others.map((o) => ({
                label: o.name,
                onClick: () =>
                  setConfirm({
                    title: t('homeMergeTitle') as string,
                    message: (
                      t('homeMergeText') as (a: string, b: string) => string
                    )(p.name, o.name),
                    confirmLabel: t('homeMergeConfirm') as string,
                    run: () => apply((s) => mergeProjects(s, p.id, o.id)),
                  }),
              })),
            },
          ]
        : []),
      {
        icon: 'link_off',
        label: t('menuRemoveProject') as string,
        onClick: () =>
          setConfirm({
            title: t('menuRemoveProject') as string,
            message: (t('menuRemoveProjectText') as (n: string) => string)(
              p.name,
            ),
            confirmLabel: t('menuRemoveProjectConfirm') as string,
            run: () => apply((s) => removeProject(s, p.id)),
          }),
      },
    ]);
  };
  const branchMenu = (row: SwitcherRow, e: ReactMouseEvent) => {
    const copy = store.workspaces.find((w) => w.id === row.workspaceId);
    openMenu(e, [
      {
        icon: 'content_copy',
        label: t('menuCopyPath') as string,
        onClick: () => void navigator.clipboard.writeText(row.localPath),
      },
      {
        icon: 'link',
        label: t('menuCopyUrl') as string,
        onClick: () => void navigator.clipboard.writeText(copy?.svnUrl ?? ''),
      },
      {
        icon: 'edit',
        label: t('menuRenameBranch') as string,
        onClick: () =>
          setRenaming({ kind: 'branch', id: row.workspaceId, name: row.name }),
      },
      {
        icon: 'refresh',
        label: t('menuUpdate') as string,
        onClick: () =>
          void updateBranch({
            id: row.workspaceId,
            name: row.name,
            url: copy?.svnUrl ?? '',
            localPath: row.localPath,
            kind: row.kind,
          }).catch((err: unknown) =>
            setConfirm({
              title: t('menuUpdate') as string,
              message: String(err instanceof Error ? err.message : err),
              confirmLabel: 'OK',
              run: () => {},
            }),
          ),
      },
      ...(chrome?.mergeAvailable && row.localPath !== workspace
        ? [
            {
              icon: 'merge',
              label: t('menuMergeHere') as string,
              onClick: () => chrome?.openMerge?.(row.workspaceId),
            },
          ]
        : []),
      {
        icon: 'link_off',
        label: t('homeCtxRemove') as string,
        onClick: () =>
          setConfirm({
            title: t('homeRemoveTitle') as string,
            message: (t('homeRemoveText') as (n: string) => string)(row.name),
            confirmLabel: t('homeRemoveConfirm') as string,
            run: () => apply((s) => removeWorkspace(s, row.workspaceId)),
          }),
      },
    ]);
  };
  return (
    <div className="svn-titlebar-ws svn-workspace-bar">
      <Select
        className="svn-workspace-project-select"
        value={project?.id ?? ''}
        ariaLabel={t('currentProject') as string}
        disabled={switching}
        onOpen={
          store.projects.length === 0 && onAddProject ? onAddProject : undefined
        }
        panelTitle={t('chooseProject') as string}
        panelHint={(t('chooseProjectHint') as (n: number) => string)(
          store.projects.length,
        )}
        trigger={
          <>
            <span
              className="svn-workspace-choice-icon material-symbols-outlined"
              aria-hidden="true"
            >
              folder_open
            </span>
            <span className="svn-workspace-choice-text">
              <span className="svn-workspace-choice-kicker">
                {t('currentProject')}
              </span>
              <span className="svn-select-label">
                {project?.name ??
                  (store.projects.length
                    ? (t('navProjects') as string)
                    : `${t('projectCreateAction') as string}…`)}
              </span>
            </span>
            <span className="material-symbols-outlined" aria-hidden="true">
              expand_more
            </span>
          </>
        }
        options={store.projects.map((p) => ({
          value: p.id,
          label: p.name,
          menu: (e) => projectMenu(e, p),
          description: (t('homeCopies') as (n: number) => string)(
            store.workspaces.filter((w) => w.projectId === p.id && w.localPath)
              .length,
          ),
        }))}
        onChange={(projectId) =>
          window.dispatchEvent(
            new CustomEvent('svn-open-project', { detail: { projectId } }),
          )
        }
        footer={[
          ...(onAddProject
            ? [
                {
                  label: t('projectCreateAction') as string,
                  icon: 'add',
                  onClick: onAddProject,
                },
              ]
            : []),
        ]}
      />
      <Switcher
        store={{
          ...store,
          projects: store.projects.filter((p) => p.id === project?.id),
        }}
        currentPath={workspace}
        projectId={project?.id}
        disabled={switching || (!project && !!workspace)}
        onOpen={!project && !workspace ? onOpenWorkingCopy : undefined}
        onStart={onOpenWorkingCopy}
        onMenu={branchMenu}
        label={
          switching
            ? (t('navSwitching') as string)
            : branch || (t('navOpenWorkingCopy') as string) + '…'
        }
        onSelect={(row) => {
          if (workspaceKey(row.localPath) !== workspaceKey(workspace))
            window.dispatchEvent(
              new CustomEvent('svn-open-path', {
                detail: { path: row.localPath, preserveView: true },
              }),
            );
        }}
      />
      <Button
        variant={upToDate ? 'default' : 'primary'}
        icon
        className={`svn-titlebar-btn${upToDate ? ' svn-workspace-up-to-date' : ''}`}
        disabled={!workspace || !chrome || chrome.busy || switching || upToDate}
        onClick={() => {
          const update = () => chrome?.update();
          if (chrome?.guard) chrome.guard(update);
          else update();
        }}
      >
        <span className="material-symbols-outlined" aria-hidden="true">
          {upToDate ? 'check' : 'download'}
        </span>
        {t(upToDate ? 'upToDate' : 'update') as string}
      </Button>
      <Button
        icon
        className="svn-titlebar-btn"
        disabled={
          !workspace ||
          !chrome?.openMerge ||
          !chrome.mergeAvailable ||
          chrome.busy ||
          switching
        }
        onClick={() => chrome?.openMerge?.()}
      >
        <span className="material-symbols-outlined" aria-hidden="true">
          merge
        </span>
        {t('mergeTitle') as string} …
      </Button>
      {createPortal(
        <>
          {menu && (
            <ContextMenu
              x={menu.x}
              y={menu.y}
              items={menu.items}
              onClose={() => setMenu(null)}
            />
          )}
          {confirm && (
            <ConfirmDialog
              title={confirm.title}
              message={confirm.message}
              confirmLabel={confirm.confirmLabel}
              danger
              onConfirm={() => {
                const { run } = confirm;
                setConfirm(null);
                run();
              }}
              onCancel={() => setConfirm(null)}
            />
          )}
          {renaming && (
            <Dialog
              title={
                (renaming.kind === 'branch'
                  ? t('menuRenameBranch')
                  : t('homeCtxRename')) as string
              }
              onClose={() => setRenaming(null)}
            >
              <TextField
                label={
                  (renaming.kind === 'branch'
                    ? t('menuRenameBranchText')
                    : t('menuRenameProjectText')) as string
                }
                maxLength={100}
                autoFocus
                value={renaming.name}
                onChange={(name) => setRenaming({ ...renaming, name })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitRename(renaming);
                }}
              />
              <div className="svn-checkout-actions">
                <Button onClick={() => setRenaming(null)}>
                  {t('branchFormCancel') as string}
                </Button>
                <Button
                  variant="primary"
                  disabled={!renaming.name.trim()}
                  onClick={() => commitRename(renaming)}
                >
                  {t('save') as string}
                </Button>
              </div>
            </Dialog>
          )}
        </>,
        document.body,
      )}
    </div>
  );
}
