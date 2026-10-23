import { contextBridge, ipcRenderer, webFrame } from 'electron';
import type { ShellRequest } from '../src/host/shellRequest';
import type { RestoreMode, SnapshotEntryInput, SnapshotFileInput } from '../src/host/types';

/** Typed renderer API via contextBridge. Initial values are fetched synchronously so they exist before the first render. */

// Fetch synchronously before any renderer JS runs.
const initialArgPath: string = ipcRenderer.sendSync('get-arg-path-sync') as string ?? '';
const initialRecent: string[] = ipcRenderer.sendSync('get-recent-folders-sync') as string[] ?? [];
const initialSvnPath: string | null = ipcRenderer.sendSync('get-svn-binary-path-sync') as string | null ?? null;
const appIconUrl: string = ipcRenderer.sendSync('get-app-icon-url-sync') as string;

// Local mirror of the persisted storage. Panel code reads storage synchronously,
// but IPC is async, so reads hit this cache and writes go through to main.
const storageCache = ipcRenderer.sendSync('storage-snapshot-sync') as Record<string, unknown>;
const globalCache = (storageCache['__global__'] ??= {}) as Record<string, unknown>;
const recent: string[] = [...initialRecent];

let currentWorkspacePath = initialArgPath;
let shellRequest: ShellRequest = ipcRenderer.sendSync('get-shell-request-sync');

contextBridge.exposeInMainWorld('svnHost', {
  // contextBridge snapshots plain values/getters, so expose a function instead.
  getWorkspacePath: (): string => currentWorkspacePath,
  getShellRequest: (): ShellRequest => shellRequest,
  setWorkspacePath: (p: string) => {
    currentWorkspacePath = p;
  },

  exec: (command: string, opts: { cwd: string; timeout?: number }) =>
    ipcRenderer.invoke('exec', command, opts),
  execSvnArgs: (args: string[], opts: { cwd: string; timeout?: number }) =>
    ipcRenderer.invoke('exec-svn-args', args, opts),
  getModificationTimes: (paths: string[], cwd: string) =>
    ipcRenderer.invoke('get-modification-times', paths, cwd),
  watchWorkspace: (cwd: string, onChange: () => void) => {
    let disposed = false;
    const listener = (_event: Electron.IpcRendererEvent, changedCwd: string) => {
      if (!disposed && changedCwd === cwd) onChange();
    };
    ipcRenderer.on('workspace-files-changed', listener);
    void ipcRenderer
      .invoke('watch-workspace', cwd)
      .then(() => {
        if (disposed) void ipcRenderer.invoke('unwatch-workspace');
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
      ipcRenderer.removeListener('workspace-files-changed', listener);
      void ipcRenderer.invoke('unwatch-workspace');
    };
  },

  storageGet: (key: string) => storageCache[key],
  storageSet: (key: string, value: unknown) => {
    storageCache[key] = value;
    return ipcRenderer.invoke('storage-set', key, value);
  },
  storageGetGlobal: (key: string) => globalCache[key],
  storageSetGlobal: (key: string, value: unknown) => {
    globalCache[key] = value;
    return ipcRenderer.invoke('storage-set-global', key, value);
  },

  snapshotSave: (entry: SnapshotEntryInput, files: SnapshotFileInput[]) =>
    ipcRenderer.invoke('snapshot-save', entry, files),
  snapshotList: (workspace: string) => ipcRenderer.invoke('snapshot-list', workspace),
  snapshotRestore: (id: string, files: string[], mode: RestoreMode) =>
    ipcRenderer.invoke('snapshot-restore', id, files, mode),
  snapshotReadFile: (id: string, path: string) => ipcRenderer.invoke('snapshot-read-file', id, path),

  openFile: (path: string) => ipcRenderer.invoke('open-file', path),
  writeFile: (absolutePath: string, content: string) =>
    ipcRenderer.invoke('write-file', absolutePath, content),
  readFileBase64: (absolutePath: string) => ipcRenderer.invoke('read-file-base64', absolutePath),
  svnCatBase64: (filePath: string, cwd: string) => ipcRenderer.invoke('svn-cat-base64', filePath, cwd),
  notify: (kind: 'info' | 'error', message: string) =>
    ipcRenderer.invoke('notify', kind, message),

  chooseFolder: (): Promise<string | null> => ipcRenderer.invoke('choose-folder'),
  listSubfolders: (dir: string): Promise<string[]> => ipcRenderer.invoke('list-subfolders', dir),
  getRecentFolders: (): string[] => {
    const updated = ipcRenderer.sendSync('get-recent-folders-sync') as string[] ?? [];
    recent.length = 0;
    recent.push(...updated);
    return [...recent];
  },
  addRecentFolder: (folder: string) => {
    const i = recent.indexOf(folder);
    if (i >= 0) recent.splice(i, 1);
    recent.unshift(folder);
    recent.length = Math.min(recent.length, 10);
    return ipcRenderer.invoke('add-recent-folder', folder);
  },
  svnBinaryPath: (): string | null => initialSvnPath,
  appAction: (action: 'quit' | 'reload' | 'devtools') => ipcRenderer.invoke('app-action', action),
  zoom: (delta: number) => {
    webFrame.setZoomLevel(delta === 0 ? 0 : Math.max(-3, Math.min(5, webFrame.getZoomLevel() + delta)));
  },
  setTitleBarTheme: (color: string, symbolColor: string) =>
    ipcRenderer.invoke('set-titlebar-theme', color, symbolColor),
  appIconUrl: () => appIconUrl,
  devClearStorage: () => ipcRenderer.invoke('dev-clear-storage'),
});

// When a second instance passes a new path, update currentWorkspacePath and
// dispatch a DOM event so the React app can react.
ipcRenderer.on('open-path', (_e, request: ShellRequest) => {
  shellRequest = request;
  currentWorkspacePath = request.path;
  window.dispatchEvent(new CustomEvent('svn-open-path', { detail: request }));
});
