import { t } from '@nonu/app/i18n';
import {
  ActivityBar,
  AuthDialog,
  OutputDock,
  useOutputToggleAction,
  Button,
  ConfirmDialog,
  ContextMenu,
  type ContextMenuItem,
  Dialog,
  type LogEntry,
  Splitter,
  useListSelection,
  ViewHeader,
} from '@nonu/components';
import { useConfirmation, useContextMenu, useResize } from '@nonu/hooks';
import type { HostAdapter } from '@nonu/host/types';
import type { BranchRegistry } from '@nonu/modules/branches/branches';
import { MergeView } from '@nonu/modules/branches/MergeView';
import {
  buildChangeMenu,
  ChangesView,
  CommitComposer,
  type DiffViewHandle,
  diffCacheEntryKey,
  type EditableDiffHandle,
  type EditableDiffState,
  type FilterStatus,
  folderGroupChange,
  loadView,
  type SortBy,
  saveView,
  useChangesModel,
  useFileActions,
  useWorkingCopyDiff,
  WorkingCopyDiffPane,
} from '@nonu/modules/changes';
import {
  absoluteLocalLogPath,
  BlameDialog,
  LogDialog,
  LogView,
  loadFileBlame,
  loadFileHistory,
  loadHistory,
  loadRevisionFiles,
  logFileTarget,
} from '@nonu/modules/history';
import {
  chromeBranches,
  loadProjectStore,
  PROJECTS_CHANGED,
  workspaceRegistry,
} from '@nonu/modules/projects/projects';
import { RepoBrowserTab } from '@nonu/modules/repository';
import { SvnSettingsPanel } from '@nonu/modules/settings/SettingsPanel';
import { isPreselected, loadSettings } from '@nonu/modules/settings/settings';
import {
  clearEditableFileCache,
  type DiffCacheEntry,
  loadPersistentSnapshot,
  loadSnapshot,
  type PanelSnapshot,
  savePersistentSnapshot,
  saveSnapshot,
  setPanelHost,
} from '@nonu/stores';
import {
  commandTooLong,
  expandUnversionedFolders,
  findDirectories,
  type OperationNotice as Pill,
  runSvn,
  type SvnBlameLine,
  type SvnChange,
  type SvnLogEntry,
  type SvnRepoInfo,
  toOperationNotice as toPill,
  useSvnOperation,
} from '@nonu/svn';
import {
  ackJob,
  findFormatterRule,
  getJob,
  runFormatterRules,
  startGeneration,
  subscribe,
} from '@nonu/utils';
import {
  appendOutput,
  setOutputBusy,
  setOutputCollapsed,
} from '@nonu/stores/outputLog';
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { mergeRegistryForWorkspace } from './mergeWorkspace.js';
import { buildNavViews } from './navViews.js';

import {
  checkWorkspaceRemote,
  loadWorkspaceStatus,
  publishWorkspaceRevision,
  useWorkspaceStatus,
  workspaceKey,
} from './workspaceStore.js';

import './WorkspaceView.css';

type DiffMode = 'unified' | 'split';

const DIFF_MODE_KEY = 'svn.diffMode';
const LIST_WIDTH_KEY = 'svn.listWidth';
const COMMIT_HEIGHT_KEY = 'svn.commitHeight';
const COMMIT_DEFAULT_HEIGHT = 100;

/** State a host can render in its own chrome (e.g. the standalone title bar). */
export interface WorkspaceChrome {
  revision?: string;
  busy: boolean;
  /** false = server has nothing new; undefined = unknown. */
  updateAvailable?: boolean;
  update: () => void;
  openMerge?: (sourceId?: string) => void;
  mergeAvailable?: boolean;
  openSettings: () => void;
  /** undefined = this workspace was opened without a project (loose repo). */
  project?: { name: string };
  /** All workspaces of the active project; empty if no project or no workspaces yet. */
  branches: { id: string; name: string; isCurrent: boolean }[];
  /** Switches the working copy to another workspace's localPath. No-op for remote-only entries or the current one. */
  onSwitchBranch: (id: string) => void;
  openHome?: () => void;
  openWorkingCopy?: () => void;
  projectLevel?: boolean;
  guard?: (proceed: () => void) => void;
}

/** Ready-made palette menu items; the host decides grouping and recents. */
export type WorkspaceThemes = ContextMenuItem[];

export type WorkspaceViewId =
  | 'changes'
  | 'projectLogs'
  | 'logs'
  | 'merge'
  | 'repo';

export function WorkspaceView({
  host,
  onChrome,
  themes,
  initialView = 'changes',
  shellViewRequest,
  onViewChange,
  onHome,
}: {
  host: HostAdapter;
  /** Host renders update/revision/settings itself; skip the built-in toolbar. */
  onChrome?: (chrome: WorkspaceChrome) => void;
  /** Host-provided theme list; shows a palette button in the activity bar. */
  themes?: WorkspaceThemes;
  /** View to open with; lets a host keep the view across remounts (e.g. branch switch). */
  initialView?: WorkspaceViewId;
  shellViewRequest?: { view: WorkspaceViewId; mergeMessage?: string };
  onViewChange?: (view: WorkspaceViewId) => void;
  /** Goes to the start page (rail item "Start"). */
  onHome?: () => void;
}) {
  const cwd = host.workspacePath;
  const workspaceStatus = useWorkspaceStatus(cwd);
  // Last known state for this workspace: lets a reopened panel paint instantly.
  const snapRef = useRef<PanelSnapshot | undefined>(undefined);
  if (snapRef.current === undefined) {
    snapRef.current =
      loadSnapshot(cwd) ?? loadPersistentSnapshot(cwd, host.storage);
  }
  const snap = snapRef.current;
  const diffCacheRef = useRef<Map<string, DiffCacheEntry>>(
    snap?.diffs ?? new Map(),
  );

  const initialSettings = loadSettings(host.storage);
  const savedView = initialSettings.rememberView
    ? loadView(host.storage)
    : undefined;

  const [repo, setRepo] = useState<SvnRepoInfo | null>(
    workspaceStatus?.repo ?? snap?.repo ?? null,
  );
  const [changes, setChanges] = useState<SvnChange[]>(
    workspaceStatus?.changes ?? snap?.changes ?? [],
  );
  const [selected, setSelected] = useState<Set<string>>(
    new Set(snap?.selected),
  );
  const [active, setActiveRaw] = useState<string | null>(snap?.active ?? null);
  const activeRef = useRef(active);
  activeRef.current = active;
  const [refreshTick, setRefreshTick] = useState(0);
  const [query, setQuery] = useState('');
  // undefined = unknown (offline/auth); the Update button stays enabled then.
  const [updateAvailable, setUpdateAvailable] = useState<boolean | undefined>(
    undefined,
  );
  // An undefined remote check means "not checked yet": it must not overwrite a fresh local state.
  useEffect(() => {
    if (workspaceStatus) {
      setRepo(workspaceStatus.repo);
      if (workspaceStatus.updateAvailable !== undefined)
        setUpdateAvailable(workspaceStatus.updateAvailable);
    }
  }, [workspaceStatus]);
  const lastRemoteCheck = useRef(0);
  // Shields the next refresh from re-deriving "update available" against the stale WC base revision.
  const justCommittedRef = useRef(false);
  const [editState, setEditState] = useState<EditableDiffState>({
    dirty: false,
    saving: false,
    error: null,
    externalChanged: false,
  });
  const readOnlyDiffRef = useRef<DiffViewHandle | null>(null);
  const editorRef = useRef<EditableDiffHandle | null>(null);
  const dirtyRef = useRef(false);
  dirtyRef.current = editState.dirty;
  // Leaving the editor (file, view, commit) with unsaved edits asks save/discard first.
  const guardUnsaved = (proceed: () => void) => {
    if (!dirtyRef.current) return proceed();
    void showConfirm({
      title: t('unsavedChanges') as string,
      message: t('unsavedChangesMsg') as string,
      confirmLabel: t('save') as string,
      extraLabel: t('discardEdits') as string,
      cancelLabel: t('authCancel') as string,
      icon: 'warning',
      confirmIcon: 'save',
      onConfirm: async () => {
        const saved = (await editorRef.current?.save()) ?? true;
        if (saved) proceed();
      },
      onExtra: () => {
        editorRef.current?.revert();
        proceed();
      },
    });
  };
  const guardRef = useRef(guardUnsaved);
  guardRef.current = guardUnsaved;
  const setActive: typeof setActiveRaw = (value) => {
    if (typeof value !== 'function' && value !== active) {
      guardUnsaved(() => setActiveRaw(value));
      return;
    }
    setActiveRaw(value);
  };
  const initialDiff = snap?.active
    ? snap.diffs.get(
        diffCacheEntryKey(
          snap.active,
          snap.changes.find((c) => c.path === snap.active)?.status,
        ),
      )
    : undefined;
  const [message, setMessage] = useState(snap?.message ?? '');
  const [settings, setSettings] = useState(() => loadSettings(host.storage));
  const [showSettings, setShowSettings] = useState(false);
  const outputToggle = useOutputToggleAction();
  const [activeView, setActiveViewState] =
    useState<WorkspaceViewId>(initialView);
  useEffect(() => {
    if (shellViewRequest) {
      setActiveViewState(shellViewRequest.view);
      if (shellViewRequest.mergeMessage)
        setMessage(shellViewRequest.mergeMessage);
      setShowSettings(false);
    }
  }, [shellViewRequest]);
  const setActiveView = useCallback(
    (view: WorkspaceViewId) => {
      if (view === activeView) {
        setShowSettings(false);
        return;
      }
      guardRef.current(() => {
        setActiveViewState(view);
        setShowSettings(false);
        onViewChange?.(view);
      });
    },
    [activeView, onViewChange],
  );
  const homeRef = useRef(onHome);
  homeRef.current = onHome;
  const navigateRef = useRef(setActiveView);
  navigateRef.current = setActiveView;
  const [projectStore, setProjectStore] = useState(() =>
    loadProjectStore(host.storage),
  );
  useEffect(() => {
    const reload = () => setProjectStore(loadProjectStore(host.storage));
    window.addEventListener(PROJECTS_CHANGED, reload);
    return () => window.removeEventListener(PROJECTS_CHANGED, reload);
  }, [host.storage]);
  const activeProjectId = projectStore.activeProjectId;
  const registry = useMemo(
    () => workspaceRegistry(projectStore, activeProjectId),
    [projectStore, activeProjectId],
  );
  const [mergeSourceId, setMergeSourceId] = useState<string>();
  const mergeRegistry = useMemo(
    () => mergeRegistryForWorkspace(registry, cwd, repo?.url),
    [registry, cwd, repo?.url],
  );
  const mergeTarget = mergeRegistry.entries.find(
    (entry) =>
      entry.localPath && workspaceKey(entry.localPath) === workspaceKey(cwd),
  );
  const mergeAvailable = !!mergeTarget;
  const openMerge = (sourceId?: string) => {
    if (busy || !mergeAvailable) return;
    guardRef.current(() => {
      setMergeSourceId(sourceId);
      setActiveViewState('merge');
      setShowSettings(false);
      onViewChange?.('merge');
    });
  };
  const openMergeRef = useRef(openMerge);
  openMergeRef.current = openMerge;
  const [generating, setGenerating] = useState(
    () => getJob(cwd)?.status === 'running',
  );
  const [busy, setBusy] = useState(false);
  useEffect(() => setOutputBusy(busy), [busy]);
  const [pill, setPill] = useState<Pill>(null);
  const {
    confirmation: confirmDialog,
    show: showConfirm,
    cancel: cancelConfirm,
  } = useConfirmation();
  const [diffMode, setDiffMode] = useState<DiffMode>(() =>
    host.storage.get<string>(DIFF_MODE_KEY) === 'split' ? 'split' : 'unified',
  );
  const {
    menu,
    open: openMenu,
    close: closeMenu,
  } = useContextMenu<{ items: ContextMenuItem[]; target: string | null }>();
  const menuTarget = menu?.data.target ?? null;
  const [logDialog, setLogDialog] = useState<{
    path: string;
    entries: SvnLogEntry[];
  } | null>(null);
  const [blameDialog, setBlameDialog] = useState<{
    path: string;
    lines: SvnBlameLine[];
  } | null>(null);
  const [listWidth, setListWidth] = useState<number | null>(
    () => host.storage.get<number>(LIST_WIDTH_KEY) ?? null,
  );
  const [commitHeight, setCommitHeight] = useState<number>(
    () => host.storage.get<number>(COMMIT_HEIGHT_KEY) ?? COMMIT_DEFAULT_HEIGHT,
  );
  const [filterStatus, setFilterStatus] = useState<FilterStatus>(
    (snap?.filterStatus ?? savedView?.filterStatus ?? 'all') as FilterStatus,
  );
  const [showIgnored, setShowIgnored] = useState(
    snap?.showIgnored ?? savedView?.showIgnored ?? false,
  );
  const [sortBy, setSortBy] = useState<SortBy>(
    (snap?.sortBy ?? savedView?.sortBy ?? 'name') as SortBy,
  );
  const [groupByFolder, setGroupByFolder] = useState(
    snap?.groupByFolder ?? savedView?.groupByFolder ?? true,
  );
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(
    new Set(snap?.collapsedFolders),
  );
  const [mtimes, setMtimes] = useState<Map<string, number>>(
    snap?.mtimes ?? new Map(),
  );
  const [hasLoaded, setHasLoaded] = useState(!!snap);
  // A reopened panel shows the cached list while 'svn status' re-runs; this flag only drives a spinner.
  const [revalidating, setRevalidating] = useState(false);
  const [directoryPaths, setDirectoryPaths] = useState<Set<string>>(new Set());
  const refreshInflight = useRef<Promise<void> | null>(null);
  // Protect deferred filesystem work from overwriting a newer status refresh.
  const refreshGeneration = useRef(0);
  const loadedRef = useRef(!!snap);
  // Revision we just committed — held so refresh() doesn't overwrite it with the
  // stale WC revision that svn info reports until the next svn update.
  const committedRevRef = useRef<string | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);

  const autoRefresh = settings.autoRefresh;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const showIgnoredRef = useRef(showIgnored);
  showIgnoredRef.current = showIgnored;
  useEffect(() => {
    if (workspaceStatus) {
      setChanges(
        workspaceStatus.changes.filter(
          (change) => showIgnoredRef.current || change.status !== 'ignored',
        ),
      );
    }
  }, [workspaceStatus?.changes]);
  // The host's own openSettings() only flips a flag for fullscreen panels, so
  // the settings view is rendered by the panel itself.
  const closeSettings = () => {
    setSettings(loadSettings(host.storage));
    setShowSettings(false);
  };

  // Persist the list view across restarts when enabled.
  useEffect(() => {
    if (settings.rememberView)
      void saveView(host.storage, {
        filterStatus,
        showIgnored,
        sortBy,
        groupByFolder,
      });
  }, [
    host,
    settings.rememberView,
    filterStatus,
    showIgnored,
    sortBy,
    groupByFolder,
  ]);

  // The shared status includes ignored entries; toggling their visibility needs no SVN request.
  useEffect(() => {
    if (!hasLoaded) return;
    refreshInflight.current = null;
    void refresh(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showIgnored]);

  // Detect empty directories by checking filesystem (for paths without extension)
  useEffect(() => {
    if (!cwd || changes.length === 0) return;

    const detectDirs = async () => {
      // Only check paths without dots (likely directories), in one batched process.
      const pathsToCheck = changes
        .filter((c) => !c.path.includes('.'))
        .map((c) => c.path);
      setDirectoryPaths(
        await findDirectories(pathsToCheck, cwd, host.exec.bind(host)),
      );
    };

    void detectDirs();
  }, [changes, cwd, host]);

  // Commit-message generation runs at module level so it survives this panel
  // unmounting; here we only mirror its log/outcome while mounted.
  const genSeenRef = useRef(0);
  const syncGeneration = useCallback(
    (initial = false) => {
      const job = getJob(cwd);
      if (!job) return;
      // On mount, only replay a job that is still running or whose outcome
      // nobody has seen yet; never an old, already-acknowledged one.
      if (initial && job.status !== 'running' && job.acked) return;
      const entries = job.log.slice(genSeenRef.current);
      genSeenRef.current = job.log.length;
      if (entries.length) appendOutput(...entries);
      setGenerating(job.status === 'running');
      if (job.status === 'done') {
        setMessage(loadSnapshot(cwd)?.message ?? '');
        setPill({ kind: 'success', text: t('pillGenerated') as string });
        ackJob(cwd);
      } else if (job.status === 'error') {
        setPill({
          kind: 'error',
          text: job.log[job.log.length - 1]?.text ?? t('generationFailed'),
        });
        ackJob(cwd);
      }
    },
    [cwd],
  );
  useEffect(() => {
    syncGeneration(true);
    return subscribe(() => syncGeneration());
  }, [syncGeneration]);

  // Publish the host as soon as we mount so exec works outside the panel.
  useEffect(() => {
    setPanelHost(host);
  }, [host]);

  const startSplitterDrag = useResize({
    start: () => {
      const body = bodyRef.current;
      return body
        ? {
            value: (event) => event.clientX - body.getBoundingClientRect().left,
            min: 240,
            max: () => body.getBoundingClientRect().width - 240,
          }
        : null;
    },
    onChange: setListWidth,
    onEnd: (value) => {
      void host.storage.set(LIST_WIDTH_KEY, value);
    },
  });
  const startCommitSplitterDrag = useResize({
    start: (event) => {
      const panel = event.currentTarget.closest('.svn-panel');
      const startY = event.clientY;
      return panel
        ? {
            value: (next) => commitHeight + startY - next.clientY,
            min: 60,
            max: () => panel.getBoundingClientRect().height - 200,
          }
        : null;
    },
    onChange: setCommitHeight,
    onEnd: (value) => {
      void host.storage.set(COMMIT_HEIGHT_KEY, value);
    },
  });

  const appendLog = useCallback((entry: LogEntry) => {
    appendOutput(entry);
  }, []);

  // Optimistically remove paths from the list so they disappear immediately
  // without waiting for the next `svn status` round-trip.
  const removeFromList = useCallback(
    (paths: string[]) => {
      const removing = new Set(paths);
      setChanges((prev) => prev.filter((c) => !removing.has(c.path)));
      setSelected((prev) => {
        const next = new Set(prev);
        for (const p of paths) next.delete(p);
        return next;
      });
      setActive((prev) => (prev && removing.has(prev) ? null : prev));
    },
    [setActive],
  );

  /** Re-reads status. With a cached snapshot this runs silently; concurrent calls share one run. */
  const refresh = useCallback(
    async (force = true) => {
      if (!cwd) return;
      if (refreshInflight.current) return refreshInflight.current;
      const silent = loadedRef.current;
      const job = (async () => {
        if (!silent) setBusy(true);
        setRevalidating(true);
        try {
          const generation = ++refreshGeneration.current;
          const workspace = await loadWorkspaceStatus(cwd, force);
          // A newer run superseded this one; applying its stale status would resurrect committed files.
          if (refreshGeneration.current !== generation) return;
          // BASE can move outside Nonuqu (other clients, svn CLI); refresh re-reads it.
          clearEditableFileCache();
          const info = workspace.repo;
          const parsed = workspace.changes.filter(
            (change) => showIgnoredRef.current || change.status !== 'ignored',
          );
          // svn info lags until svn update: pin the revision we just committed so the toolbar stays correct.
          const pinnedRev = committedRevRef.current;
          const displayInfo = pinnedRev
            ? { ...info, revision: pinnedRev }
            : info;
          if (pinnedRev) publishWorkspaceRevision(cwd, pinnedRev);
          setRepo(displayInfo);
          if (!info.isWorkingCopy) {
            setChanges([]);
            setDiff('');
            return;
          }
          // HEAD is what we just pushed; re-checking against the stale WC base would flip "Aktuell" back.
          if (justCommittedRef.current) {
            justCommittedRef.current = false;
            setUpdateAvailable(false);
          } else if (
            (!pinnedRev && workspace.updateAvailable === undefined) ||
            (settingsRef.current.updateCheckSeconds > 0 &&
              Date.now() - lastRemoteCheck.current >
                settingsRef.current.updateCheckSeconds * 1000)
          ) {
            lastRemoteCheck.current = Date.now();
            void checkWorkspaceRemote(cwd, displayInfo, true).then(
              setUpdateAvailable,
            );
          }
          const prevPaths = new Set(
            (snapRef.current?.changes ?? []).map((c) => c.path),
          );
          const first = !loadedRef.current;
          const parsedPaths = new Set(parsed.map((c) => c.path));
          setChanges((current) => {
            const activePath = activeRef.current;
            const edited = current.find((change) => change.path === activePath);
            return dirtyRef.current && edited && !parsedPaths.has(edited.path)
              ? [...parsed, edited]
              : parsed;
          });
          // First load: pre-select everything committable, like the Git panel.
          // Later: keep the user's selection and only auto-select new arrivals.
          setSelected((prev) => {
            if (first) {
              return new Set(
                parsed
                  .filter((c) =>
                    isPreselected(c, settingsRef.current.defaultSelection),
                  )
                  .map((c) => c.path),
              );
            }
            const next = new Set<string>();
            for (const c of parsed) {
              if (prev.has(c.path) || (c.committable && !prevPaths.has(c.path)))
                next.add(c.path);
            }
            return next;
          });
          setActive((prev) =>
            prev && (dirtyRef.current || parsed.some((c) => c.path === prev))
              ? prev
              : null,
          );
          setRefreshTick((t) => t + 1);

          // Folder expansion can be slow on big build trees: merge its result only while this status is still current.
          void expandUnversionedFolders(parsed, cwd, host.exec.bind(host)).then(
            (expanded) => {
              if (refreshGeneration.current !== generation) return;
              setChanges((current) => {
                const activePath = activeRef.current;
                const edited = current.find(
                  (change) => change.path === activePath,
                );
                return dirtyRef.current &&
                  edited &&
                  !expanded.some((change) => change.path === edited.path)
                  ? [...expanded, edited]
                  : expanded;
              });
              setSelected((prev) => {
                const next = new Set(prev);
                for (const change of expanded) {
                  if (
                    !parsedPaths.has(change.path) &&
                    (first
                      ? isPreselected(
                          change,
                          settingsRef.current.defaultSelection,
                        )
                      : change.committable)
                  )
                    next.add(change.path);
                }
                return next;
              });
              setActive((prev) =>
                prev &&
                (dirtyRef.current || expanded.some((c) => c.path === prev))
                  ? prev
                  : null,
              );
              setRefreshTick((t) => t + 1);
            },
          );
        } catch (err) {
          setPill(toPill(err));
        } finally {
          loadedRef.current = true;
          setHasLoaded(true);
          if (!silent) setBusy(false);
          setRevalidating(false);
          refreshInflight.current = null;
        }
      })();
      refreshInflight.current = job;
      return job;
    },
    [cwd],
  );

  // Explicit refresh (button) shows the busy state even though background
  // refreshes are silent.
  const manualRefresh = useCallback(async () => {
    setBusy(true);
    try {
      await refresh();
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!cwd) return;
    let disposed = false;
    let running = false;
    let rerun = false;
    const revalidate = () => {
      if (running) {
        rerun = true;
        return;
      }
      running = true;
      void (async () => {
        do {
          rerun = false;
          await refresh();
        } while (!disposed && rerun);
        running = false;
      })();
    };

    if (!autoRefresh) {
      return () => {
        disposed = true;
      };
    }
    const stopWatching = host.watchWorkspace?.(cwd, revalidate);
    // A focus refresh also covers changes made while the app was suspended and
    // hosts that cannot provide a recursive filesystem watcher.
    window.addEventListener('focus', revalidate);
    return () => {
      disposed = true;
      stopWatching?.();
      window.removeEventListener('focus', revalidate);
    };
  }, [cwd, host, refresh, autoRefresh]);

  // Stat only the changed paths: a recursive scan of the working copy timed out. Node runs this directly, since shell quoting breaks on some names.
  useEffect(() => {
    if (!cwd || changes.length === 0 || !host.getModificationTimes) return;
    let cancelled = false;
    (async () => {
      const paths = changes.map((c) => c.path.replace(/\\/g, '/'));
      try {
        const mtimes = await host.getModificationTimes!(paths, cwd);
        if (!cancelled) setMtimes(new Map(Object.entries(mtimes)));
      } catch (err) {
        console.warn('[svn] mtime fetch failed:', err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [cwd, changes, host]);

  // Load the focused file's diff. Cached diffs show at once and revalidate after refresh; unversioned files show raw content.
  const activeStatus = changes.find((c) => c.path === active)?.status;
  const { diff, setDiff, diffIsNewFile } = useWorkingCopyDiff({
    cwd,
    active,
    activeStatus,
    refreshTick,
    hasLoaded,
    initialDiff,
    diffCacheRef,
  });

  useEffect(() => {
    if (!hasLoaded) return;
    const next: PanelSnapshot = {
      repo,
      changes,
      selected: Array.from(selected),
      active,
      message,
      mtimes,
      diffs: diffCacheRef.current,
      filterStatus,
      showIgnored,
      sortBy,
      groupByFolder,
      collapsedFolders: Array.from(collapsedFolders),
      fetchedAt: Date.now(),
    };
    snapRef.current = next;
    saveSnapshot(cwd, next);
    savePersistentSnapshot(cwd, host.storage, next);
  }, [
    cwd,
    hasLoaded,
    repo,
    changes,
    selected,
    active,
    message,
    mtimes,
    filterStatus,
    showIgnored,
    sortBy,
    groupByFolder,
    collapsedFolders,
  ]);

  /** Runs an op; on an auth failure it stashes the op and opens the auth dialog so the user can retry in place. */
  const refreshAfterOperation = useCallback(async () => {
    refreshInflight.current = null;
    await refresh();
  }, [refresh]);
  const { run, pendingAuth, authBusy, onAuthSubmit, cancelAuth } =
    useSvnOperation({
      setBusy,
      setPill,
      appendLog,
      refresh: refreshAfterOperation,
    });

  const activeChange = changes.find((c) => c.path === active);
  // Open the editable view at once: it loads BASE and the working copy itself.
  const editable =
    !!active &&
    !!activeChange &&
    !['deleted', 'missing'].includes(activeChange.status) &&
    ['modified', 'unversioned', 'conflicted'].includes(activeChange.status);
  const toggle = (path: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  // Anchor for shift-click range selection (checkboxes).
  const selectionAnchorRef = useRef<string | null>(null);

  const {
    filteredAndSorted,
    folderGroups,
    visiblePaths,
    allSelected,
    visibleSelectedPaths,
    hiddenSelectedCount,
  } = useChangesModel({
    changes,
    filterStatus,
    showIgnored,
    sortBy,
    mtimes,
    query,
    groupByFolder,
    collapsedFolders,
    selected,
  });

  const listRef = useRef<HTMLDivElement | null>(null);
  const {
    highlighted,
    setHighlighted,
    select: onRowClick,
    onKeyDown: onListKeyDown,
  } = useListSelection({
    keys: visiblePaths,
    listRef,
    rangeMode: 'extend',
    onRefresh: () => {
      void manualRefresh();
    },
    onEnter: (keys, anchor) => onRowDoubleClick(anchor ?? Array.from(keys)[0]),
    onSpace: (keys) => {
      const allChecked = Array.from(keys).every((path) => selected.has(path));
      setSelected((previous) => {
        const next = new Set(previous);
        keys.forEach((path) =>
          allChecked ? next.delete(path) : next.add(path),
        );
        return next;
      });
    },
    scrollToKey: (key, index) => {
      const container = listRef.current;
      if (!container) return;
      const row = container.querySelector<HTMLElement>(
        `[data-path="${CSS.escape(key)}"]`,
      );
      if (row) row.scrollIntoView({ block: 'nearest' });
      else {
        const height =
          container.scrollHeight / Math.max(1, visiblePaths.length) || 25;
        const top = index * height;
        if (top < container.scrollTop) container.scrollTop = top;
        else if (top + height > container.scrollTop + container.clientHeight)
          container.scrollTop = top + height - container.clientHeight;
      }
    },
  });
  const onRowDoubleClick = (path: string) => {
    const change = changes.find((c) => c.path === path);
    if (change && !['deleted', 'missing'].includes(change.status))
      setActive(path);
  };

  const onCheckboxClick = (e: React.MouseEvent, path: string) => {
    e.stopPropagation();
    if (e.shiftKey) {
      const paths = visiblePaths;
      let anchor = selectionAnchorRef.current;
      if (!anchor || !paths.includes(anchor)) anchor = path;
      const a = paths.indexOf(anchor);
      const b = paths.indexOf(path);
      if (a !== -1 && b !== -1) {
        const [lo, hi] = a < b ? [a, b] : [b, a];
        setSelected((prev) => {
          const next = new Set(prev);
          for (let i = lo; i <= hi; i++) next.add(paths[i]);
          return next;
        });
      }
      return;
    }
    selectionAnchorRef.current = path;
    toggle(path);
  };

  const selectedPaths = visibleSelectedPaths;
  const committable = selectedPaths.filter((c) => c.committable);
  const conflictedSelected = selectedPaths.filter(
    (c) => c.status === 'conflicted',
  );
  const unversionedSelected = selectedPaths.filter(
    (c) => c.status === 'unversioned',
  );

  const toggleFolder = (dir: string) => {
    setCollapsedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(dir)) next.delete(dir);
      else next.add(dir);
      return next;
    });
  };

  const onCommit = () => {
    if (
      !cwd ||
      !message.trim() ||
      committable.length + unversionedSelected.length === 0
    )
      return;
    guardUnsaved(() => {
      // Committing on a stale base is usually an error, and SVN rejects it anyway.
      if (updateAvailable === true) {
        void showConfirm({
          title: t('updateBeforeCommit') as string,
          message: t('updateBeforeCommitMsg') as string,
          confirmLabel: t('update') as string,
          cancelLabel: t('authCancel') as string,
          icon: 'warning',
          confirmIcon: 'download',
          onConfirm: () => onUpdate(),
        });
        return;
      }
      // Unversioned files are not committable until added; `svn commit` would skip them.
      if (unversionedSelected.length > 0) {
        void showConfirm({
          title: t('commitUnversioned') as string,
          message: (t('commitUnversionedMsg') as (n: number) => string)(
            unversionedSelected.length,
          ),
          confirmLabel: t('commitAddButton') as string,
          cancelLabel: t('authCancel') as string,
          icon: 'warning',
          onConfirm: () => onAdd(unversionedSelected.map((c) => c.path)),
        });
        return;
      }
      doCommit();
    });
  };

  const doCommit = () => {
    if (!cwd || !message.trim() || committable.length === 0) return;
    const paths = committable.map((c) => c.path);
    // Dropping paths from a huge list is only safe when every committable file is selected: `svn commit` without paths commits everything.
    const allCommittableSelected = changes
      .filter((c) => c.committable)
      .every((c) => visibleSelectedPaths.includes(c));
    if (commandTooLong(paths) && !allCommittableSelected) {
      setPill({
        kind: 'error',
        text: (t('commitTooManyFiles') as (n: number) => string)(paths.length),
      });
      return;
    }
    const args = commandTooLong(paths)
      ? ['commit', '-m', message.trim()]
      : ['commit', '-m', message.trim(), ...paths];
    removeFromList(paths);
    void run(t('opCommit') as string, async (credentials) => {
      await runFormatterRules(settings.formatterRules ?? [], paths, host);
      const { stdout } = await runSvn(args, cwd, credentials);
      // A commit moves BASE to the new revision; drop the cached old BASE content.
      clearEditableFileCache();
      setMessage('');
      // Read the new revision from a committed item, not the localized commit text; `svn info --xml` stays exact.
      const probe = committable.find((c) => c.status !== 'deleted')?.path;
      const committedRev = probe
        ? /<entry[^>]*\srevision="(\d+)"/.exec(
            (await runSvn(['info', '--xml', probe], cwd, credentials)).stdout,
          )?.[1]
        : undefined;
      if (committedRev) {
        // Pin the revision so the next refresh() doesn't overwrite it with the
        // stale WC base revision that svn info reports until svn update is run.
        committedRevRef.current = committedRev;
      }
      justCommittedRef.current = true;
      setUpdateAvailable(false);
      // HEAD equals the committed revision, so no re-check is needed soon.
      lastRemoteCheck.current = Date.now();
      return (
        stdout.trim() ||
        (t('opCommitDone') as (n: number) => string)(paths.length)
      );
    });
  };

  const activeFormatterRule = active
    ? findFormatterRule(settings.formatterRules ?? [], active)
    : null;

  const doFormatFile = () => {
    if (!cwd || !active || !activeFormatterRule) return;
    const rule = activeFormatterRule;
    const editor = editorRef.current;
    if (editor) {
      // Format in place: run() would refresh from disk and discard the editor state.
      setBusy(true);
      editor
        .formatInPlace(async (filePath) => {
          await runFormatterRules([rule], [filePath], host);
        })
        .finally(() => setBusy(false));
    } else {
      // Read-only DiffView: format on disk and reload diff via run().
      void run(t('opFormatter') as string, async () => {
        await runFormatterRules([rule], [active], host);
        diffCacheRef.current.delete(diffCacheEntryKey(active, activeStatus));
        setRefreshTick((t) => t + 1);
        return '';
      });
    }
  };

  const doFormatAndSave = () => {
    if (!cwd || !active || !activeFormatterRule) return;
    const rule = activeFormatterRule;
    const editor = editorRef.current;
    void run(t('opFormatter') as string, async () => {
      if (editor) {
        await editor.formatInPlace(async (filePath) => {
          await runFormatterRules([rule], [filePath], host);
        });
        await editor.save();
      } else {
        await runFormatterRules([rule], [active], host);
        diffCacheRef.current.delete(diffCacheEntryKey(active, activeStatus));
        setRefreshTick((t) => t + 1);
      }
      return '';
    });
  };

  const onGenerateMessage = () => {
    if (!cwd || committable.length === 0 || generating) return;
    if (settings.autoOpenOutput) setOutputCollapsed(false);
    setPill({ kind: 'info', text: t('pillGenerating') as string });
    genSeenRef.current = 0;
    startGeneration(cwd, committable, settings);
  };

  const {
    onAdd,
    onRevert,
    onDeleteSmart,
    onResolveAny,
    onLock,
    onUnlock,
    onBreakLock,
    onIgnore,
    onIgnoreMultiple,
    treeConflictChoice,
    setTreeConflictChoice,
    onResolveTreeConflictKeepMine,
    onResolveTreeConflictAcceptDelete,
  } = useFileActions({
    cwd,
    changes,
    host,
    run,
    showConfirm,
    removeFromList,
    setPill,
  });

  const onLog = (path: string) => {
    if (!cwd) return;
    void (async () => {
      try {
        // Peg to HEAD: without it `svn log` resolves the path at BASE and skips revisions committed remotely since the last update.
        setLogDialog({
          path,
          entries: await loadFileHistory(cwd, `${path}@HEAD`),
        });
      } catch (err) {
        setPill(toPill(err));
      }
    })();
  };

  const onBlame = (path: string) => {
    if (!cwd) return;
    void (async () => {
      try {
        setBlameDialog({ path, lines: await loadFileBlame(cwd, path) });
      } catch (err) {
        setPill(toPill(err));
      }
    })();
  };

  const onUpdate = () => {
    if (!cwd) return;
    clearEditableFileCache();
    committedRevRef.current = null; // WC revision is now authoritative again
    justCommittedRef.current = false;
    void run(t('opUpdate') as string, async (credentials) => {
      const { stdout } = await runSvn(['update'], cwd, credentials);
      // svn update brings the WC to HEAD, so the button can disable without a remote re-check.
      setUpdateAvailable(false);
      lastRemoteCheck.current = Date.now();
      return stdout.trim() || (t('opUpdateDone') as string);
    });
  };

  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;
  const chromeRevision = repo?.revision ? `r${repo.revision}` : undefined;
  const activeProject = projectStore.projects.find(
    (p) => p.id === activeProjectId,
  );
  const onSwitchBranchRef = useRef((id: string) => {
    const entry = registry.entries.find((e) => e.id === id);
    if (!entry?.localPath || entry.localPath === cwd) return;
    window.dispatchEvent(
      new CustomEvent('svn-open-path', {
        detail: { path: entry.localPath },
      }),
    );
  });
  onSwitchBranchRef.current = (id: string) => {
    const entry = registry.entries.find((e) => e.id === id);
    if (!entry?.localPath || entry.localPath === cwd) return;
    host.workspacePath = entry.localPath;
    window.dispatchEvent(
      new CustomEvent('svn-open-path', {
        detail: { path: entry.localPath },
      }),
    );
  };
  useEffect(() => {
    onChrome?.({
      guard: (proceed) => guardRef.current(proceed),
      revision: chromeRevision,
      busy,
      updateAvailable,
      update: () => onUpdateRef.current(),
      openMerge: (sourceId) => openMergeRef.current(sourceId),
      mergeAvailable,
      openSettings: () => setShowSettings(true),
      project: activeProject ? { name: activeProject.name } : undefined,
      branches: chromeBranches(registry, cwd),
      onSwitchBranch: (id: string) => onSwitchBranchRef.current(id),
      openHome: () => homeRef.current?.(),
      openWorkingCopy: () => navigateRef.current('changes'),
      projectLevel: ['repo', 'projectLogs'].includes(activeView),
    });
  }, [
    onChrome,
    chromeRevision,
    mergeAvailable,
    activeView,
    busy,
    updateAvailable,
    activeProject,
    registry,
    cwd,
  ]);

  // Scrolls the diff so the previous/next change block sits in the vertical middle of the view.
  const jumpToChange = useCallback((dir: 'prev' | 'next') => {
    if (editorRef.current) return editorRef.current.jump(dir);
    return readOnlyDiffRef.current?.jump(dir) ?? false;
  }, []);

  // Ctrl+Up / Ctrl+Down jumps between change blocks in the diff.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || !e.ctrlKey || e.altKey || e.shiftKey) return;
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === 'INPUT' ||
          t.tagName === 'TEXTAREA' ||
          t.isContentEditable)
      )
        return;
      if (jumpToChange(e.key === 'ArrowDown' ? 'next' : 'prev'))
        e.preventDefault();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [jumpToChange]);

  const chooseDiffMode = (mode: DiffMode) => {
    setDiffMode(mode);
    void host.storage.set(DIFF_MODE_KEY, mode);
  };

  const copyPath = async (path: string) => {
    try {
      await navigator.clipboard.writeText(path);
    } catch {
      // Clipboard API can be unavailable in some embeds; nothing actionable to do.
    }
  };

  const absolutePath = (path: string) => {
    const root = cwd!.replace(/[\\/]+$/, '');
    const separator = root.includes('\\') ? '\\' : '/';
    // Normalize a leading separator too, so a listed file can never escape the working copy.
    const relative = path.replace(/^[\\/]+/, '').replace(/[\\/]+/g, separator);
    return `${root}${separator}${relative}`;
  };

  const openLocalFile = async (path: string) => {
    try {
      await host.openFile(path);
    } catch (err) {
      const next = toPill(err);
      setPill(next);
      if (next) {
        appendLog({ ...next, kind: next.kind, ts: Date.now() });
        // A rejected host request must not hide in a collapsed output pane.
        setOutputCollapsed(false);
      }
      throw err;
    }
  };

  const showInExplorer = (path: string) => {
    if (!cwd) return;
    const abs = absolutePath(path);
    const dir = abs.substring(0, abs.lastIndexOf('\\'));
    void host.exec(`start "" "${dir}"`, { cwd }).catch(() => {});
  };

  const changeMenuActions = {
    onAdd,
    onRevert,
    onDeleteSmart,
    onLock,
    onUnlock,
    onBreakLock,
    onIgnore,
    onIgnoreMultiple,
    onResolveAny,
    onLog,
    onBlame,
    copyPath,
    absolutePath,
    openLocalFile,
    showInExplorer,
    setActive,
    setHighlighted,
    setSelected,
    selectionAnchorRef,
  };

  const onContextMenu = (event: React.MouseEvent, change: SvnChange) => {
    openMenu(event, {
      target: change.path,
      items: buildChangeMenu(change, changes, highlighted, changeMenuActions),
    });
  };

  const onFolderContextMenu = (
    event: React.MouseEvent,
    dir: string,
    groupChanges: SvnChange[],
  ) => {
    const change = folderGroupChange(dir, changes);
    openMenu(event, {
      target: dir,
      items: buildChangeMenu(
        change,
        changes,
        new Set(),
        changeMenuActions,
        groupChanges.map((item) => item.path),
      ),
    });
  };

  if (!cwd) {
    return (
      <div className={`svn-panel${busy ? ' svn-panel--busy' : ''}`}>
        <div className="svn-empty">
          <div className="svn-empty-title">{t('noWorkspace') as string}</div>
          <div className="svn-empty-hint">{t('noWorkspaceHint') as string}</div>
        </div>
      </div>
    );
  }

  if (repo && !repo.isWorkingCopy) {
    return (
      <div className={`svn-panel${busy ? ' svn-panel--busy' : ''}`}>
        <div className="svn-empty">
          <div className="svn-empty-title">
            {repo.svnMissing
              ? (t('svnNotFound') as string)
              : (t('notWorkingCopy') as string)}
          </div>
          <div className="svn-empty-hint">{repo.reason}</div>
          <Button onClick={() => void manualRefresh()} disabled={busy}>
            {t('checkAgain') as string}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="svn-shell">
      <ActivityBar
        storage={host.storage}
        projectName={activeProject?.name}
        branchName={
          registry.entries
            .find(
              (entry) =>
                entry.localPath &&
                workspaceKey(entry.localPath) === workspaceKey(cwd),
            )
            ?.url.replace(/\/+$/, '')
            .split('/')
            .pop() ?? repo?.url?.replace(/\/+$/, '').split('/').pop()
        }
        active={activeView}
        noneActive={showSettings}
        onChange={(id) => {
          if (id === 'start') {
            onHome?.();
            return;
          }
          if (showSettings) closeSettings();
          setActiveView(id);
        }}
        footer={[
          ...(themes
            ? [
                {
                  id: 'theme',
                  icon: 'palette',
                  label: t('theme') as string,
                  onClick: (e: React.MouseEvent<HTMLButtonElement>) => {
                    const r = e.currentTarget.getBoundingClientRect();
                    openMenu(
                      { clientX: r.right + 4, clientY: r.top },
                      { target: null, items: themes },
                    );
                  },
                },
              ]
            : []),
          {
            id: 'settings',
            icon: 'settings',
            label: t('settings') as string,
            active: showSettings,
            onClick: () => setShowSettings(true),
          },
          outputToggle,
        ]}
        views={buildNavViews({
          hasWorkspace: true,
          activeView,
          changesCount: changes.length,
        })}
      />
      <div
        className={`svn-panel${busy ? ' svn-panel--busy' : ''}${activeView !== 'changes' || showSettings ? ' svn-panel--inactive' : ''}`}
      >
        <ViewHeader title={t('navLocalChanges') as string}>
          {!onChrome && (
            <Button
              icon
              onClick={() => openMerge()}
              disabled={busy || !mergeAvailable}
            >
              <span className="material-symbols-outlined">merge</span>
              {t('mergeTitle') as string} …
            </Button>
          )}
          <Button
            icon
            title={t('refresh') as string}
            onClick={() => void manualRefresh()}
            disabled={busy}
          >
            <span className="material-symbols-outlined">refresh</span>
          </Button>
        </ViewHeader>
        <div className="svn-body" ref={bodyRef}>
          <div
            className="svn-changes"
            style={
              listWidth != null ? { flex: `0 0 ${listWidth}px` } : undefined
            }
          >
            <ChangesView
              visibleCount={visiblePaths.length}
              selectedCount={selected.size}
              totalCount={changes.length}
              filteredCount={filteredAndSorted.length}
              allSelected={allSelected}
              onToggleAll={() =>
                setSelected(
                  selected.size > 0 ? new Set() : new Set(visiblePaths),
                )
              }
              toolbar={{
                filterStatus: filterStatus,
                sortBy: sortBy,
                groupByFolder: groupByFolder,
                query: query,
                onQuery: setQuery,
                onFilterStatus: setFilterStatus,
                onSortBy: setSortBy,
                onToggleGroupByFolder: () => setGroupByFolder((v) => !v),
              }}
              bulk={{
                count: visibleSelectedPaths.length,
                hiddenCount: hiddenSelectedCount,
                busy: busy,
                canAdd: unversionedSelected.length > 0,
                canRevert:
                  selectedPaths.filter((c) => c.status !== 'unversioned')
                    .length > 0,
                canDeleteLocal: unversionedSelected.length > 0,
                canDeleteSvn:
                  selectedPaths.filter((c) => c.status !== 'unversioned')
                    .length > 0,
                onAdd: () => onAdd(unversionedSelected.map((c) => c.path)),
                onRevert: () =>
                  onRevert(
                    selectedPaths
                      .filter((c) => c.status !== 'unversioned')
                      .map((c) => c.path),
                  ),
                onDelete: () =>
                  onDeleteSmart(
                    selectedPaths
                      .filter((c) => !['deleted', 'missing'].includes(c.status))
                      .map((c) => c.path),
                  ),
                onClear: () => setSelected(new Set()),
              }}
              list={{
                groups: folderGroups,
                groupByFolder: groupByFolder,
                allVisibleChanges: filteredAndSorted,
                collapsedFolders: collapsedFolders,
                directoryPaths: directoryPaths,
                mtimes: mtimes,
                selected: selected,
                highlighted: highlighted,
                active: active ?? undefined,
                menuTarget: menuTarget ?? undefined,
                revalidating: revalidating,
                hasLoaded: hasLoaded,
                listRef: listRef,
                onKeyDown: onListKeyDown,
                onToggleFolder: toggleFolder,
                onRowClick: onRowClick,
                onRowDoubleClick: onRowDoubleClick,
                onContextMenu: onContextMenu,
                onFolderContextMenu: onFolderContextMenu,
                onCheckboxClick: onCheckboxClick,
                onOpen: (path) =>
                  void openLocalFile(absolutePath(path)).catch(() => {}),
                onRevert: (path) => onRevert([path]),
                onPreview: setActive,
                onResolve: onResolveAny,
              }}
            />
            <CommitComposer
              message={message}
              setMessage={setMessage}
              generating={generating}
              busy={busy}
              committable={[...committable, ...unversionedSelected]}
              conflictedSelected={conflictedSelected}
              commitHeight={commitHeight}
              startCommitSplitterDrag={startCommitSplitterDrag}
              onGenerateMessage={onGenerateMessage}
              onCommit={onCommit}
            />
          </div>

          <Splitter direction="h" onMouseDown={startSplitterDrag} />

          <WorkingCopyDiffPane
            active={active}
            activeChange={activeChange}
            diffIsNewFile={diffIsNewFile}
            diffMode={diffMode}
            chooseDiffMode={chooseDiffMode}
            jumpToChange={jumpToChange}
            editState={editState}
            onResolveAny={onResolveAny}
            activeFormatterRule={!!activeFormatterRule}
            busy={busy}
            doFormatFile={doFormatFile}
            doFormatAndSave={doFormatAndSave}
            editorRef={editorRef}
            cwd={cwd}
            editable={editable}
            mtimes={mtimes}
            activeStatus={activeStatus}
            setEditState={setEditState}
            refresh={refresh}
            readOnlyDiffRef={readOnlyDiffRef}
            diff={diff}
          />
        </div>

        {activeView === 'merge' && !showSettings && mergeTarget && (
          <div className="svn-branches">
            <ViewHeader title={t('mergeTitle') as string}>
              <Button onClick={() => setActiveView('changes')} disabled={busy}>
                {t('mergeClose') as string}
              </Button>
            </ViewHeader>
            <MergeView
              registry={mergeRegistry}
              cwd={cwd}
              defaultSourceId={mergeSourceId}
              defaultTargetId={mergeTarget.id}
              run={run}
              onClose={() => setActiveView('changes')}
              onMerged={(message, targetPath) => {
                if (workspaceKey(targetPath) !== workspaceKey(cwd)) {
                  window.dispatchEvent(
                    new CustomEvent('svn-open-path', {
                      detail: {
                        path: targetPath,
                        view: 'changes',
                        mergeMessage: message,
                      },
                    }),
                  );
                  return;
                }
                setMessage(message);
                void refresh();
                setActiveView('changes');
              }}
            />
          </div>
        )}

        {(activeView === 'logs' || activeView === 'projectLogs') &&
          !showSettings && (
            <LogView
              key={activeView}
              diffMode={diffMode === 'split' ? 'split' : 'inline'}
              onDiffModeChange={(mode) =>
                chooseDiffMode(mode === 'split' ? 'split' : 'unified')
              }
              load={(query) =>
                loadHistory(
                  cwd,
                  query,
                  activeView === 'projectLogs'
                    ? activeProject?.repositoryUrl
                    : undefined,
                )
              }
              loadRevisionFiles={async (revision, path, action) => {
                if (!cwd) return { base: '', work: '' };
                // Repository-rooted log paths: `^/` keeps the lookup in the repository, not the working copy.
                return loadRevisionFiles(
                  cwd,
                  async (rev) =>
                    logFileTarget(path, rev, undefined, repo?.repositoryRoot)
                      .target,
                  revision,
                  action,
                );
              }}
              onOpenFile={async (path) => {
                const local = absoluteLocalLogPath(path, repo, cwd);
                if (local === null)
                  throw new Error(t('logPathNotLocal') as string);
                // Validate the path first: the host API may fail silently.
                await runSvn(['info', local], cwd);
                await openLocalFile(local);
              }}
              onLogFile={async (path, revision, action) => {
                if (!cwd) return;
                const file = logFileTarget(
                  path,
                  revision,
                  action,
                  repo?.repositoryRoot,
                );
                const local =
                  action === 'D' ? null : absoluteLocalLogPath(path, repo, cwd);
                const target = local ? `${local}@${revision}` : file.target;
                setLogDialog({
                  path,
                  entries: await loadFileHistory(cwd, target, revision),
                });
              }}
              onBlameFile={async (path, revision, action) => {
                if (!cwd) return;
                const file = logFileTarget(
                  path,
                  revision,
                  action,
                  repo?.repositoryRoot,
                );
                const local =
                  action === 'D' ? null : absoluteLocalLogPath(path, repo, cwd);
                const target = local
                  ? `${local}@${file.revision}`
                  : file.target;
                setBlameDialog({
                  path,
                  lines: await loadFileBlame(cwd, target, file.revision),
                });
              }}
              onShowInExplorer={(path) => {
                const local = absoluteLocalLogPath(path, repo, cwd);
                if (local === null)
                  throw new Error(t('logPathNotLocal') as string);
                host.openFile(
                  local.substring(
                    0,
                    Math.max(local.lastIndexOf('\\'), local.lastIndexOf('/')),
                  ),
                );
              }}
            />
          )}

        {showSettings && (
          <SvnSettingsPanel host={host} onClose={closeSettings} />
        )}

        {activeView === 'repo' && !showSettings && (
          <RepoBrowserTab
            key={`${cwd}|${repo?.url}`}
            cwd={cwd}
            url={repo?.url}
          />
        )}

        {logDialog && (
          <LogDialog
            path={logDialog.path}
            entries={logDialog.entries}
            onClose={() => setLogDialog(null)}
          />
        )}

        {blameDialog && (
          <BlameDialog
            path={blameDialog.path}
            lines={blameDialog.lines}
            onClose={() => setBlameDialog(null)}
          />
        )}

        {menu && (
          <ContextMenu
            x={menu.x}
            y={menu.y}
            items={menu.data.items}
            onClose={closeMenu}
          />
        )}

        {pendingAuth && (
          <AuthDialog
            busy={authBusy}
            onCancel={cancelAuth}
            onSubmit={(result) => void onAuthSubmit(result)}
          />
        )}

        {confirmDialog && (
          <ConfirmDialog
            title={confirmDialog.title}
            message={confirmDialog.message}
            confirmLabel={confirmDialog.confirmLabel}
            cancelLabel={confirmDialog.cancelLabel}
            danger={confirmDialog.danger}
            extraLabel={confirmDialog.extraLabel}
            icon={confirmDialog.icon}
            confirmIcon={confirmDialog.confirmIcon}
            onConfirm={confirmDialog.onConfirm}
            onExtra={confirmDialog.onExtra}
            onCancel={cancelConfirm}
          />
        )}

        {treeConflictChoice && (
          <Dialog
            title={t('treeConflictDialogTitle') as string}
            onClose={() => setTreeConflictChoice(null)}
          >
            <p className="svn-tree-conflict-msg">
              {(t('treeConflictDialogMsg') as (p: string) => string)(
                treeConflictChoice.path,
              )}
            </p>
            <div className="svn-tree-conflict-actions">
              <Button
                variant="primary"
                icon
                onClick={() =>
                  onResolveTreeConflictKeepMine(treeConflictChoice.path)
                }
              >
                <span className="material-symbols-outlined">save</span>{' '}
                {t('treeConflictKeepMine') as string}
              </Button>
              <Button
                icon
                className="svn-confirm-btn--danger"
                onClick={() =>
                  onResolveTreeConflictAcceptDelete(treeConflictChoice.path)
                }
              >
                <span className="material-symbols-outlined">delete</span>{' '}
                {t('treeConflictAcceptDelete') as string}
              </Button>
            </div>
          </Dialog>
        )}

        <OutputDock storage={host.storage} />
      </div>
    </div>
  );
}
