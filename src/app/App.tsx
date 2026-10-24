import {
  ActivityBar,
  ContextMenu,
  type ContextMenuItem,
  OutputDock,
  useNavExpanded,
  useOutputToggleAction,
} from '@nonu/components';
import { Button } from '@nonu/components/ui/Button';
import type { ShellRequest } from '@nonu/host/shellRequest';
import type { HostAdapter, HostStorage } from '@nonu/host/types';
import { ProjectLogView } from '@nonu/modules/history/ProjectLogView';
import { StartPage } from '@nonu/modules/home/StartPage';
import { attachWorkspace } from '@nonu/modules/projects/attach';
import { CheckoutDialog } from '@nonu/modules/projects/CheckoutDialog';
import { importRecentFolders } from '@nonu/modules/projects/importRecents';
import {
  loadProjectStore,
  PROJECTS_CHANGED,
  pickLastWorkspace,
  preferredWorkspace,
  saveProjectStore,
} from '@nonu/modules/projects/projects';
import { startupWorkspace } from '@nonu/modules/projects/startup';
import { RepoBrowserTab } from '@nonu/modules/repository/RepoBrowserTab';
import { SvnSettingsPanel } from '@nonu/modules/settings/SettingsPanel';
import {
  loadSettings,
  SETTINGS_CHANGED_EVENT,
} from '@nonu/modules/settings/settings';
import { buildNavViews } from '@nonu/modules/workspace/navViews';
import { WorkspaceBar } from '@nonu/modules/workspace/WorkspaceBar';
import {
  type WorkspaceChrome,
  WorkspaceView,
  type WorkspaceViewId,
} from '@nonu/modules/workspace/WorkspaceView';
import {
  getWorkspaceStatus,
  useWorkspaceStatus,
  useWorkspaceStatusVersion,
} from '@nonu/modules/workspace/workspaceStore';
import { detectSvnRepo } from '@nonu/svn';
import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { getLocale, subscribeLocale, t } from './i18n';

const THEMES = [
  { id: 'dark', name: 'Dark' },
  { id: 'light', name: 'Light' },
  { id: 'frozen-dark', name: 'Frozen Dark' },
  { id: 'olive', name: 'Olive' },
  { id: 'solarized-warm', name: 'Solarized Warm' },
  { id: 'milk-coffee', name: 'Milk Coffee' },
  { id: 'dark-coffee', name: 'Dark Coffee' },
  { id: 'dune', name: 'Sandworm' },
  { id: 'lotr', name: 'The Fellowship' },
  { id: 'turtle-svn', name: 'TurtleSVN' },
  { id: 'matrix', name: 'Digital Rain' },
  { id: 'matcha', name: 'Matcha' },
] as const;

/** Theme ids grouped by base brightness for the palette submenu. */
const THEME_GROUPS: { label: () => string; ids: string[] }[] = [
  {
    label: () => t('themeGroupLight'),
    ids: [
      'light',
      'solarized-warm',
      'milk-coffee',
      'dune',
      'turtle-svn',
      'matcha',
    ],
  },
  {
    label: () => t('themeGroupDark'),
    ids: ['dark', 'frozen-dark', 'olive', 'dark-coffee', 'lotr', 'matrix'],
  },
];

const THEME_RECENT_KEY = 'svn.standalone.themeRecent';
const RECENT_LIMIT = 3;

/** Palette menu: last-used themes first, then one submenu per brightness group. */
function themeMenuItems(
  active: string,
  recent: string[],
  onSelect: (id: string) => void,
): ContextMenuItem[] {
  const entry = (id: string): ContextMenuItem => {
    const th = THEMES.find((t) => t.id === id)!;
    return {
      label: th.name,
      checked: th.id === active,
      theme: th.id,
      onClick: () => onSelect(th.id),
    };
  };
  return [
    ...recent.map(entry),
    ...(recent.length ? [{ separator: true }] : []),
    ...THEME_GROUPS.map((g) => ({
      label: g.label(),
      submenu: g.ids.map(entry),
    })),
  ];
}

const THEME_KEY = 'svn.standalone.theme';

/** Persisted ids of removed/renamed themes fall back to dark. */
const validTheme = (id: string | undefined): string =>
  THEMES.some((t) => t.id === id) ? id! : 'dark';

/** Black or white text, whichever contrasts more with a #rrggbb background (WCAG relative luminance). */
function onColor(hex: string): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return '#fff';
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(m[1].slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.179 ? '#000' : '#fff';
}

function applyTheme(id: string) {
  document.documentElement.setAttribute('data-theme', id);
  // Tint the native min/max/close overlay to match the theme's title bar.
  const css = getComputedStyle(document.documentElement);
  const color = css.getPropertyValue('--nonu-bg-secondary').trim();
  const symbolColor = css.getPropertyValue('--nonu-text-muted').trim();
  document.documentElement.style.setProperty(
    '--nonu-on-primary',
    onColor(css.getPropertyValue('--nonu-primary').trim()),
  );
  // Empty when the theme stylesheet isn't active yet; Electron rejects that.
  if (!color || !symbolColor) return;
  void window.svnHost.setTitleBarTheme(color, symbolColor);
}

function AppIcon() {
  // Keep the title-bar icon inline: Chromium renders file:// SVGs blank in packaged Electron.
  return (
    <svg
      className="svn-titlebar-app-icon"
      viewBox="0 0 16 16"
      aria-hidden="true"
    >
      <path
        d="M2.3 13.5V2.3l3.5 3.9M8.2 8.1l5.5 5.7V2.1"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="2.3" cy="2.1" r="1.45" fill="currentColor" />
      <circle cx="2.3" cy="13.8" r="1.45" fill="currentColor" />
      <circle cx="13.7" cy="2.1" r="1.45" fill="currentColor" />
      <circle cx="13.7" cy="13.8" r="1.45" fill="currentColor" />
      <circle
        cx="8"
        cy="7.8"
        r="2.8"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      />
    </svg>
  );
}

type MenuItem =
  | { label: string; onClick: () => void; checked?: boolean; hint?: string }
  | 'sep';
type MenuDef = { label: string; items: MenuItem[] };

const toContextItem = (it: MenuItem): ContextMenuItem =>
  it === 'sep'
    ? { separator: true }
    : {
        label: it.label,
        checked: !!it.checked,
        hint: it.hint,
        onClick: it.onClick,
      };

function TitleBar({
  menus,
  storage,
  title,
}: {
  menus: MenuDef[];
  storage: HostStorage;
  title: string;
}) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const nav = useNavExpanded(storage);
  const items = menus.map<ContextMenuItem>((m) => ({
    label: m.label,
    submenu: m.items.map(toContextItem),
  }));

  return (
    <div className="svn-titlebar">
      <AppIcon />
      <span className="svn-titlebar-title">{title}</span>
      <div className="svn-menubar">
        <Button
          variant="ghost"
          iconOnly
          active={menu !== null}
          aria-label={t('appMenu') as string}
          aria-expanded={menu !== null}
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            setMenu({ x: r.left, y: r.bottom + 4 });
          }}
        >
          <span className="material-symbols-outlined" aria-hidden="true">
            menu
          </span>
        </Button>
        <Button
          variant="ghost"
          iconOnly
          aria-expanded={nav.expanded}
          aria-label={t(nav.expanded ? 'navCollapse' : 'navExpand') as string}
          title={t(nav.expanded ? 'navCollapse' : 'navExpand') as string}
          onClick={nav.toggle}
        >
          <span className="material-symbols-outlined" aria-hidden="true">
            {nav.expanded ? 'left_panel_close' : 'left_panel_open'}
          </span>
        </Button>
      </div>
      {nav.error && <span role="alert">{nav.error}</span>}
      {menu && (
        <ContextMenu {...menu} items={items} onClose={() => setMenu(null)} />
      )}
    </div>
  );
}

// Apply persisted theme before first render to avoid flash
(function initTheme() {
  const stored = window.svnHost.storageGetGlobal(THEME_KEY) as
    | string
    | undefined;
  applyTheme(validTheme(stored));
})();

function HomeShell({
  host,
  themeItems,
  hasWorkspace,
  hasProject,
  activeView,
  noneActive,
  onViewChange,
  children,
}: {
  host: HostAdapter;
  themeItems: ContextMenuItem[];
  hasWorkspace: boolean;
  hasProject: boolean;
  activeView: WorkspaceViewId;
  noneActive: boolean;
  onViewChange: (view: WorkspaceViewId) => void;
  children: React.ReactNode;
}) {
  const outputToggle = useOutputToggleAction();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [themeMenu, setThemeMenu] = useState<{ x: number; y: number } | null>(
    null,
  );
  // Badges come from the same sources as WorkspaceView, so they stay visible
  // on project-level views too (re-rendered on every status refresh).
  useWorkspaceStatusVersion();
  const changesCount =
    getWorkspaceStatus(host.workspacePath)?.changes.filter(
      (c) => c.status !== 'ignored',
    ).length ?? 0;

  return (
    <div className="svn-standalone-home-shell">
      <ActivityBar
        storage={host.storage}
        projectName={
          loadProjectStore(host.storage).projects.find(
            (p) => p.id === loadProjectStore(host.storage).activeProjectId,
          )?.name
        }
        branchName={loadProjectStore(host.storage)
          .workspaces.find((w) => w.localPath === host.workspacePath)
          ?.svnUrl.replace(/\/+$/, '')
          .split('/')
          .pop()}
        views={buildNavViews({
          hasWorkspace,
          changesCount,
          showRepoBrowser: import.meta.env.DEV,
        })}
        active={activeView}
        noneActive={noneActive}
        onChange={onViewChange}
        footer={[
          {
            id: 'theme',
            icon: 'palette',
            label: t('switchTheme'),
            onClick: (e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              setThemeMenu({ x: rect.right + 4, y: rect.top });
            },
          },
          {
            id: 'settings',
            icon: 'settings',
            label: t('settings'),
            active: settingsOpen,
            onClick: () => setSettingsOpen((value) => !value),
          },
          outputToggle,
        ]}
      />
      <div className="svn-standalone-home-content" hidden={settingsOpen}>
        <div className="svn-standalone-home-column">
          {children}
          <OutputDock storage={host.storage} />
        </div>
      </div>
      {settingsOpen && (
        <SvnSettingsPanel host={host} onClose={() => setSettingsOpen(false)} />
      )}
      {themeMenu && (
        <ContextMenu
          {...themeMenu}
          onClose={() => setThemeMenu(null)}
          items={themeItems}
        />
      )}
    </div>
  );
}

export function App({ adapter }: { adapter: HostAdapter }) {
  useSyncExternalStore(subscribeLocale, getLocale);
  const [singleProject, setSingleProject] = useState(
    () => loadSettings(adapter.storage).singleProject,
  );
  useEffect(() => {
    const sync = () =>
      setSingleProject(loadSettings(adapter.storage).singleProject);
    window.addEventListener(SETTINGS_CHANGED_EVENT, sync);
    return () => window.removeEventListener(SETTINGS_CHANGED_EVENT, sync);
  }, [adapter.storage]);
  const [workspacePath, setWorkspacePath] = useState<string | null>(
    adapter.workspacePath || null,
  );
  const lastWorkspaceRef = React.useRef<string | null>(
    adapter.workspacePath || null,
  );
  const [checkout, setCheckout] = useState(false);
  const [checkoutRepositoryUrl, setCheckoutRepositoryUrl] = useState('');
  const [showHome, setShowHome] = useState(!adapter.workspacePath);
  const [projectStore, setProjectStore] = useState(() =>
    loadProjectStore(adapter.storage),
  );
  useEffect(() => {
    const reload = () => setProjectStore(loadProjectStore(adapter.storage));
    window.addEventListener(PROJECTS_CHANGED, reload);
    return () => window.removeEventListener(PROJECTS_CHANGED, reload);
  }, [adapter.storage]);
  const activeProject = projectStore.projects.find(
    (project) => project.id === projectStore.activeProjectId,
  );
  const titleText =
    singleProject && activeProject ? activeProject.name : 'NonuquSVN';
  const [chrome, setChrome] = useState<WorkspaceChrome | null>(null);
  const [switchingWorkspace, setSwitchingWorkspace] = useState(false);
  // Lives here, not in WorkspaceView: the view remounts per workspace (key below),
  // and a branch switch must not drop the user back to the changes view.
  const [workspaceView, setWorkspaceView] = useState<WorkspaceViewId>(
    () => window.svnHost.getShellRequest()?.view ?? 'changes',
  );
  // The repo browser shows only the current branch, i.e. the working copy's URL.
  const workingCopyUrl = useWorkspaceStatus(adapter.workspacePath)?.repo.url;
  const [shellViewRequest, setShellViewRequest] = useState<{
    view: WorkspaceViewId;
    mergeMessage?: string;
  }>();
  const [theme, setThemeState] = useState<string>(() => {
    const stored = window.svnHost.storageGetGlobal(THEME_KEY) as
      | string
      | undefined;
    return validTheme(stored);
  });
  const [recentThemes, setRecentThemes] = useState<string[]>(() => {
    const stored = window.svnHost.storageGetGlobal(THEME_RECENT_KEY);
    return Array.isArray(stored)
      ? stored
          .filter((id) => THEMES.some((t) => t.id === id))
          .slice(0, RECENT_LIMIT)
      : [];
  });

  useEffect(() => {
    applyTheme(theme);
    void window.svnHost.storageSetGlobal(THEME_KEY, theme);
  }, [theme]);

  const selectTheme = (id: string) => {
    setThemeState(id);
    const next = [id, ...recentThemes.filter((r) => r !== id)].slice(
      0,
      RECENT_LIMIT,
    );
    setRecentThemes(next);
    void window.svnHost.storageSetGlobal(THEME_RECENT_KEY, next);
  };
  const workspaceThemeItems = themeMenuItems(theme, recentThemes, selectTheme);

  const handleChrome = React.useCallback((nextChrome: WorkspaceChrome) => {
    setChrome(nextChrome);
    setSwitchingWorkspace(false);
  }, []);

  const chromeRef = React.useRef(chrome);
  chromeRef.current = chrome;
  const viewRef = React.useRef(workspaceView);
  viewRef.current = workspaceView;
  const guard = (proceed: () => void) => {
    if (chromeRef.current?.guard) chromeRef.current.guard(proceed);
    else proceed();
  };
  const [navigationError, setNavigationError] = useState('');
  const open = (
    p: string,
    view: WorkspaceViewId = 'changes',
    mergeMessage?: string,
  ) => {
    guard(() => {
      void (async () => {
        let store = loadProjectStore(adapter.storage);
        let copy = store.workspaces.find(
          (w) =>
            w.localPath?.replace(/\\/g, '/').toLowerCase() ===
            p.replace(/\\/g, '/').toLowerCase(),
        );
        if (!copy) {
          try {
            const info = await detectSvnRepo(p);
            if (info.isWorkingCopy) {
              store = attachWorkspace(
                loadProjectStore(adapter.storage),
                p,
                info,
              );
              copy = store.workspaces.find(
                (w) =>
                  w.localPath?.replace(/\\/g, '/').toLowerCase() ===
                  p.replace(/\\/g, '/').toLowerCase(),
              );
            }
          } catch (reason) {
            setNavigationError(String(reason));
            return;
          }
        }
        if (copy) {
          const next = {
            ...store,
            activeProjectId: copy.projectId,
            workspaces: store.workspaces.map((w) =>
              w.id === copy.id ? { ...w, lastOpenedAt: Date.now() } : w,
            ),
            projects: store.projects.map((project) =>
              project.id === copy.projectId
                ? { ...project, activeWorkspaceId: copy.id }
                : project,
            ),
          };
          try {
            await saveProjectStore(adapter.storage, next);
            setProjectStore(next);
            window.dispatchEvent(new Event(PROJECTS_CHANGED));
          } catch (reason) {
            setNavigationError(String(reason));
            return;
          }
        }
        setNavigationError('');
        applyOpen(p, view, mergeMessage);
      })();
    });
  };
  const applyOpen = (
    p: string,
    view: WorkspaceViewId,
    mergeMessage?: string,
  ) => {
    setWorkspaceView(view);
    setShellViewRequest({ view, ...(mergeMessage ? { mergeMessage } : {}) });
    const isWorkspaceChange =
      lastWorkspaceRef.current !== null && lastWorkspaceRef.current !== p;
    adapter.workspacePath = p;
    lastWorkspaceRef.current = p;
    window.svnHost.addRecentFolder(p);
    setCheckout(false);
    setShowHome(false);
    if (isWorkspaceChange) {
      setChrome(null);
      setSwitchingWorkspace(true);
    }
    setWorkspacePath(p);
  };

  // A second launch (`svn-client.exe <folder>`) hands its path to this window.
  useEffect(() => {
    const applyRequest = (request: ShellRequest) => {
      if (!request.path) return;
      const preserve = (request as ShellRequest & { preserveView?: boolean })
        .preserveView;
      open(
        request.path,
        request.view ??
          (preserve && ['changes', 'logs'].includes(viewRef.current)
            ? viewRef.current
            : 'changes'),
        (request as ShellRequest & { mergeMessage?: string }).mergeMessage,
      );
    };
    const onOpen = (e: Event) =>
      applyRequest((e as CustomEvent<ShellRequest>).detail);
    window.addEventListener('svn-open-path', onOpen);
    // Also consume launches received between preload and React mounting.
    const initialRequest = window.svnHost.getShellRequest();
    if (initialRequest.path) applyRequest(initialRequest);
    else if (adapter.workspacePath) open(adapter.workspacePath);
    else {
      const last = startupWorkspace(adapter.storage);
      if (last) {
        void detectSvnRepo(last)
          .then((info) => {
            if (info.isWorkingCopy) open(last);
          })
          .catch(() => {});
      }
    }
    return () => window.removeEventListener('svn-open-path', onOpen);
  }, []);

  useEffect(() => {
    void importRecentFolders(
      adapter.storage,
      window.svnHost.getRecentFolders(),
    );
  }, []);

  const chooseFolder = async () => {
    const chosen = await window.svnHost.chooseFolder();
    if (chosen) open(chosen);
  };

  const edit = (cmd: string) => () => {
    document.execCommand(cmd);
  };
  const openCheckout = () =>
    guard(() => {
      setCheckoutRepositoryUrl('');
      setShowHome(true);
      setShellViewRequest(undefined);
      setCheckout(true);
    });
  const navigate = (view: WorkspaceViewId, path?: string) => {
    const fallback =
      !workspacePath && activeProject && (view === 'changes' || view === 'logs')
        ? (pickLastWorkspace(projectStore, activeProject.id) ??
          projectStore.workspaces.find(
            (item) =>
              item.projectId === activeProject.id &&
              item.localPath &&
              !item.hidden,
          ))
        : undefined;
    if (path || fallback?.localPath) {
      open((path || fallback?.localPath) as string, view);
      return;
    }
    guard(() => {
      setWorkspaceView(view);
      setShellViewRequest({ view });
      setCheckout(false);
      setShowHome(false);
    });
  };
  useEffect(() => {
    const project = (event: Event) => {
      const { projectId } = (event as CustomEvent).detail;
      guard(() => {
        void (async () => {
          const store = loadProjectStore(adapter.storage);
          if (!store.projects.some((p) => p.id === projectId)) return;
          const next = { ...store, activeProjectId: projectId };
          try {
            await saveProjectStore(adapter.storage, next);
          } catch (reason) {
            setNavigationError(String(reason));
            return;
          }
          setProjectStore(next);
          setChrome(null);
          setNavigationError('');
          window.dispatchEvent(new Event(PROJECTS_CHANGED));
          const target = preferredWorkspace(next, projectId);
          if (target?.localPath) {
            open(target.localPath);
            return;
          }
          setWorkspacePath(null);
          setWorkspaceView('changes');
          setShowHome(true);
          setCheckout(false);
        })();
      });
    };
    window.addEventListener('svn-open-project', project);
    return () => {
      window.removeEventListener('svn-open-project', project);
    };
  }, [adapter]);
  const menus: MenuDef[] = [
    {
      label: t('menuFile'),
      items: [
        {
          label: t('menuOpenWorkingCopy'),
          onClick: () => void chooseFolder(),
        },
        { label: t('menuCheckout'), onClick: openCheckout },
        'sep',
        {
          label: t('menuQuit'),
          hint: 'Alt+F4',
          onClick: () => void window.svnHost.appAction('quit'),
        },
      ],
    },
    {
      label: t('menuEdit'),
      items: [
        { label: t('menuCut'), hint: 'Ctrl+X', onClick: edit('cut') },
        { label: t('copy'), hint: 'Ctrl+C', onClick: edit('copy') },
        { label: t('menuPaste'), hint: 'Ctrl+V', onClick: edit('paste') },
        {
          label: t('menuSelectAll'),
          hint: 'Ctrl+A',
          onClick: edit('selectAll'),
        },
      ],
    },
    {
      label: t('menuView'),
      items: [
        ...THEMES.map<MenuItem>((t) => ({
          label: t.name,
          checked: theme === t.id,
          onClick: () => selectTheme(t.id),
        })),
        'sep',
        {
          label: t('menuZoomIn'),
          onClick: () => window.svnHost.zoom(0.5),
        },
        { label: t('menuZoomOut'), onClick: () => window.svnHost.zoom(-0.5) },
        {
          label: t('menuZoomReset'),
          onClick: () => window.svnHost.zoom(0),
        },
        'sep',
        {
          label: t('menuReload'),
          onClick: () => void window.svnHost.appAction('reload'),
        },
        {
          label: t('menuDevtools'),
          onClick: () => void window.svnHost.appAction('devtools'),
        },
        'sep',
        {
          label: t('menuClearStorage'),
          onClick: () => {
            if (confirm(t('clearStorageConfirm'))) {
              void window.svnHost.devClearStorage().then(() => {
                void window.svnHost.appAction('reload');
              });
            }
          },
        },
      ],
    },
  ];

  if (!workspacePath || showHome) {
    return (
      <>
        <TitleBar menus={menus} storage={adapter.storage} title={titleText} />
        {navigationError && <div role="alert">{navigationError}</div>}
        {workspacePath ? (
          <WorkspaceBar
            workspace={workspacePath}
            chrome={
              chrome
                ? {
                    ...chrome,
                    projectLevel: true,
                    openWorkingCopy: () => navigate('changes'),
                  }
                : chrome
            }
            switching={switchingWorkspace}
            storage={adapter.storage}
            onAddProject={openCheckout}
            onOpenWorkingCopy={() => void chooseFolder()}
            singleProject={singleProject}
          />
        ) : (
          <WorkspaceBar
            workspace=""
            storage={adapter.storage}
            onAddProject={openCheckout}
            onOpenWorkingCopy={() => void chooseFolder()}
            singleProject={singleProject}
          />
        )}
        <HomeShell
          host={adapter}
          themeItems={workspaceThemeItems}
          hasWorkspace={!!workspacePath}
          hasProject={!!activeProject}
          activeView={workspaceView}
          noneActive={showHome || checkout}
          onViewChange={navigate}
        >
          {checkout || (!workspacePath && !projectStore.projects.length) ? (
            <StartPage
              storage={adapter.storage}
              open={open}
              chooseFolder={() => window.svnHost.chooseFolder()}
              onCheckout={openCheckout}
            >
              {checkout && (
                <CheckoutDialog
                  key={checkoutRepositoryUrl}
                  storage={adapter.storage}
                  chooseFolder={() => window.svnHost.chooseFolder()}
                  listSubfolders={(d) => window.svnHost.listSubfolders(d)}
                  onDone={open}
                  onCancel={() => setCheckout(false)}
                  initialRepositoryUrl={checkoutRepositoryUrl}
                />
              )}
            </StartPage>
          ) : !showHome &&
            workspaceView === 'projectLogs' &&
            activeProject?.repositoryUrl ? (
            <ProjectLogView host={adapter} url={activeProject.repositoryUrl} />
          ) : !showHome && workspaceView === 'repo' ? (
            <RepoBrowserTab
              cwd={adapter.workspacePath || '.'}
              url={workingCopyUrl}
            />
          ) : null}
        </HomeShell>
      </>
    );
  }

  return (
    <div className="svn-standalone-shell">
      <TitleBar menus={menus} storage={adapter.storage} title={titleText} />
      {navigationError && <div role="alert">{navigationError}</div>}
      <WorkspaceBar
        workspace={workspacePath}
        chrome={chrome}
        switching={switchingWorkspace}
        storage={adapter.storage}
        onAddProject={openCheckout}
        onOpenWorkingCopy={() => void chooseFolder()}
        singleProject={singleProject}
      />
      <div className="svn-standalone-main">
        <WorkspaceView
          key={workspacePath}
          host={adapter}
          onChrome={handleChrome}
          themes={workspaceThemeItems}
          initialView={workspaceView}
          shellViewRequest={shellViewRequest}
          onViewChange={(view) => {
            setWorkspaceView(view);
            setShellViewRequest(undefined);
          }}
        />
      </div>
    </div>
  );
}
