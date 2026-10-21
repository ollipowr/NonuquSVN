import { t } from '@nonu/app/i18n';
import {
  ActionButton,
  Button,
  ConfirmDialog,
  ContextMenu,
  type ContextMenuItem,
} from '@nonu/components';
import type { HostStorage } from '@nonu/host/types';
import {
  loadProjectStore,
  mergeProjects,
  type NonuquProject,
  PROJECTS_CHANGED,
  type ProjectStore,
  type RepositoryWorkspace,
  removeWorkspace,
  renameProject,
  saveProjectStore,
  setWorkspaceHidden,
} from '@nonu/modules/projects/projects';
import {
  checkWorkspaceRemote,
  getWorkspaceStatus,
  loadWorkspaceStatus,
  useWorkspaceStatusVersion,
} from '@nonu/modules/workspace/workspaceStore';
import { loadPersistentSnapshot } from '@nonu/stores';
import React, { useEffect, useRef, useState } from 'react';
import { ProjectGroup } from './ProjectGroup.js';
import { ResumeCard } from './ResumeCard.js';
import {
  badgesFor,
  branchRows,
  orderedProjects,
  projectIdForPath,
  resumeCards,
  type StatusView,
} from './startModel.js';
import { createQueue, type Queue } from './statusQueue.js';
import './StartPage.css';

const EXPANDED_KEY = 'nonuqu.home.expanded';

export function StartPage({
  storage,
  open,
  chooseFolder,
  onCheckout,
  children,
}: {
  storage: HostStorage;
  open: (path: string) => void;
  chooseFolder: () => Promise<string | null>;
  onCheckout: () => void;
  children?: React.ReactNode;
}) {
  useWorkspaceStatusVersion(); // re-render whenever any status changes
  const [store, setStore] = useState(() => loadProjectStore(storage));
  const [expanded, setExpanded] = useState<Set<string> | null>(() => {
    const saved = storage.getGlobal<string[]>(EXPANDED_KEY);
    return Array.isArray(saved) ? new Set(saved) : null;
  });
  const [showHidden, setShowHidden] = useState<Set<string>>(new Set());
  const [renaming, setRenaming] = useState<string | null>(null);
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
  const [refreshTick, setRefreshTick] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const queues = useRef<{ local: Queue; remote: Queue } | undefined>(undefined);

  useEffect(() => {
    const reload = () => setStore(loadProjectStore(storage));
    window.addEventListener(PROJECTS_CHANGED, reload);
    return () => window.removeEventListener(PROJECTS_CHANGED, reload);
  }, [storage]);

  const viewOf = (path: string): StatusView | undefined => {
    const live = getWorkspaceStatus(path);
    if (live)
      return {
        changes: live.changes,
        revision: live.revision,
        updateAvailable: live.updateAvailable,
        missing: !live.repo.isWorkingCopy,
      };
    const snapshot = loadPersistentSnapshot(path, storage);
    return snapshot
      ? { changes: snapshot.changes, revision: snapshot.repo?.revision }
      : undefined;
  };
  const isMissing = (path: string) => viewOf(path)?.missing === true;

  const cards = resumeCards(store, isMissing);
  const cardProjects = new Set(cards.map((c) => c.project.id));
  const isExpanded = (id: string) =>
    expanded ? expanded.has(id) : cardProjects.has(id);
  const toggle = (id: string) => {
    const next = new Set(expanded ?? cardProjects);
    if (!next.delete(id)) next.add(id);
    setExpanded(next);
    void storage.setGlobal(EXPANDED_KEY, [...next]);
  };

  // Queues live for one refresh round; a refresh click starts fresh ones with force.
  useEffect(() => {
    const force = refreshTick > 0;
    const local = createQueue(async (p) => {
      await loadWorkspaceStatus(p, force);
    }, 3);
    const remote = createQueue(async (p) => {
      const status = await loadWorkspaceStatus(p);
      if (status.repo.isWorkingCopy)
        await checkWorkspaceRemote(p, status.repo, force);
    }, 2);
    queues.current = { local, remote };
    return () => {
      local.cancel();
      remote.cancel();
      queues.current = undefined;
    };
  }, [refreshTick]);

  useEffect(() => {
    const q = queues.current;
    if (!q) return;
    const all = store.workspaces.flatMap((w) =>
      w.localPath ? [w.localPath] : [],
    );
    const visible = [
      ...cards.map((c) => c.workspace.localPath as string),
      ...store.projects
        .filter((p) => isExpanded(p.id))
        .flatMap((p) =>
          branchRows(store, p.id, false).rows.map((w) => w.localPath as string),
        ),
    ];
    q.local.enqueue(visible, true);
    q.local.enqueue(all);
    q.remote.enqueue(visible, true);
  }, [refreshTick, store, expanded]);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const apply = (op: (s: ProjectStore) => ProjectStore) =>
    run(async () => {
      const next = op(loadProjectStore(storage));
      await saveProjectStore(storage, next);
      setStore(next);
    });
  const openWorkspace = (workspace: RepositoryWorkspace) =>
    run(async () => {
      const current = loadProjectStore(storage);
      await saveProjectStore(storage, {
        ...current,
        activeProjectId: workspace.projectId,
      });
      open(workspace.localPath as string);
    });
  const openChosenFolder = () =>
    run(async () => {
      const path = await chooseFolder();
      if (!path) return;
      const current = loadProjectStore(storage);
      await saveProjectStore(storage, {
        ...current,
        activeProjectId:
          projectIdForPath(current, path) ?? current.activeProjectId,
      });
      open(path);
    });
  const startCheckout = () =>
    run(async () => {
      await saveProjectStore(storage, {
        ...loadProjectStore(storage),
        activeProjectId: undefined,
      });
      onCheckout();
    });

  const openAddMenu = (e: React.MouseEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setMenu({
      x: r.right - 200,
      y: r.bottom + 4,
      items: [
        {
          icon: 'folder_open',
          label: t('homeAddOpen') as string,
          onClick: () => void openChosenFolder(),
        },
        {
          icon: 'download',
          label: t('homeAddCheckout') as string,
          onClick: () => void startCheckout(),
        },
      ],
    });
  };
  const rowMenu = (e: React.MouseEvent, w: RepositoryWorkspace) => {
    e.preventDefault();
    setMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        {
          icon: w.hidden ? 'visibility' : 'visibility_off',
          label: (w.hidden ? t('homeCtxShow') : t('homeCtxHide')) as string,
          onClick: () =>
            void apply((s) => setWorkspaceHidden(s, w.id, !w.hidden)),
        },
        {
          icon: 'link_off',
          label: t('homeCtxRemove') as string,
          onClick: () =>
            setConfirm({
              title: t('homeRemoveTitle') as string,
              message: (t('homeRemoveText') as (n: string) => string)(w.name),
              confirmLabel: t('homeRemoveConfirm') as string,
              run: () => void apply((s) => removeWorkspace(s, w.id)),
            }),
        },
      ],
    });
  };
  const projectMenu = (e: React.MouseEvent<HTMLElement>, p: NonuquProject) => {
    e.preventDefault();
    e.stopPropagation();
    const at =
      e.type === 'contextmenu'
        ? { x: e.clientX, y: e.clientY }
        : (() => {
            const r = e.currentTarget.getBoundingClientRect();
            return { x: r.right - 200, y: r.bottom + 4 };
          })();
    const others = store.projects.filter((o) => o.id !== p.id);
    setMenu({
      ...at,
      items: [
        {
          icon: 'edit',
          label: t('homeCtxRename') as string,
          onClick: () => setRenaming(p.id),
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
                      run: () =>
                        void apply((s) => mergeProjects(s, p.id, o.id)),
                    }),
                })),
              },
            ]
          : []),
      ],
    });
  };

  const projects = orderedProjects(store);
  return (
    <main className="svn-home">
      <div className="svn-home-content">
        <header className="svn-home-head">
          <span className="svn-home-brand">
            <span className="svn-home-logo" aria-hidden="true" />
            <span>
              Nonuqu<span className="svn-home-brand-suffix">SVN</span>
            </span>
          </span>
          <span className="svn-home-grow" />
          <Button
            icon
            title={t('homeRefresh') as string}
            onClick={() => setRefreshTick((n) => n + 1)}
          >
            <span className="material-symbols-outlined">refresh</span>
          </Button>
          <Button icon title={t('homeAdd') as string} onClick={openAddMenu}>
            <span className="material-symbols-outlined">add</span>
          </Button>
        </header>
        {!children && projects.length > 0 && (
          <section className="svn-home-intro">
            <h1>{t('homeProjectsTitle') as string}</h1>
            <p>{t('homeProjectsIntro') as string}</p>
            <div className="svn-home-actions">
              <ActionButton
                icon="create_new_folder"
                label={t('projectCreateAction') as string}
                disabled={busy}
                onClick={() => void startCheckout()}
              />
              <ActionButton
                icon="folder_open"
                label={t('homeAddOpen') as string}
                disabled={busy}
                onClick={() => void openChosenFolder()}
              />
            </div>
          </section>
        )}
        {children ? (
          <section className="svn-home-checkout">{children}</section>
        ) : (
          <>
            {error && (
              <p className="svn-home-error" role="alert">
                {error}
              </p>
            )}
            {cards.map(({ project, workspace }) => {
              const view = viewOf(workspace.localPath as string);
              return (
                <ResumeCard
                  key={project.id}
                  projectName={project.name}
                  branchName={workspace.name}
                  badges={badgesFor(view)}
                  revision={view?.revision}
                  disabled={busy}
                  onOpen={() => void openWorkspace(workspace)}
                />
              );
            })}
            {projects.length > 0 && (
              <h2 className="svn-home-section-title">
                {t('homeAllProjects') as string}
              </h2>
            )}
            {projects.map((project) => {
              const { rows, hiddenCount } = branchRows(
                store,
                project.id,
                showHidden.has(project.id),
              );
              const current = cards.find((c) => c.project.id === project.id)
                ?.workspace.id;
              return (
                <ProjectGroup
                  key={project.id}
                  project={project}
                  rows={rows.map((w) => {
                    const view = viewOf(w.localPath as string);
                    return {
                      workspace: w,
                      badges: badgesFor(view),
                      revision: view?.revision,
                      current: w.id === current,
                    };
                  })}
                  hiddenCount={hiddenCount}
                  showHidden={showHidden.has(project.id)}
                  expanded={isExpanded(project.id)}
                  renaming={renaming === project.id}
                  busy={busy}
                  onToggle={() => toggle(project.id)}
                  onToggleHidden={() =>
                    setShowHidden((s) => {
                      const next = new Set(s);
                      if (!next.delete(project.id)) next.add(project.id);
                      return next;
                    })
                  }
                  onOpen={(w) => void openWorkspace(w)}
                  onRowMenu={rowMenu}
                  onProjectMenu={(e) => projectMenu(e, project)}
                  onRename={(name) => {
                    setRenaming(null);
                    void apply((s) => renameProject(s, project.id, name));
                  }}
                  onRenameCancel={() => setRenaming(null)}
                />
              );
            })}
            {!projects.length && (
              <div className="svn-home-empty">
                <h2>{t('homeEmptyTitle')}</h2>
                <p>{t('homeEmptyText')}</p>
                <div className="svn-home-empty-actions">
                  <ActionButton
                    icon="create_new_folder"
                    label={t('projectCreateAction') as string}
                    disabled={busy}
                    onClick={() => void startCheckout()}
                  />
                  <ActionButton
                    icon="folder_open"
                    label={t('homeAddOpen') as string}
                    disabled={busy}
                    onClick={() => void openChosenFolder()}
                  />
                </div>
              </div>
            )}
          </>
        )}
      </div>
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
            const { run: action } = confirm;
            setConfirm(null);
            action();
          }}
          onCancel={() => setConfirm(null)}
        />
      )}
    </main>
  );
}
