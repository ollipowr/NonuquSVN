import type {
  HostAdapter,
  HostStorage,
  ExecOptions,
  ExecResult,
  RestoreMode,
  RestoreResult,
  SnapshotEntryInput,
  SnapshotFileInput,
  SnapshotRecord,
} from '../src/host/types.js';

declare global {
  interface Window {
    svnHost: {
      getWorkspacePath(): string;
      getShellRequest(): import('../src/host/shellRequest').ShellRequest;
      exec(command: string, opts: { cwd: string; timeout?: number }): Promise<ExecResult>;
      execSvnArgs(args: string[], opts: { cwd: string; timeout?: number }): Promise<ExecResult>;
      getModificationTimes(paths: string[], cwd: string): Promise<Record<string, number>>;
      watchWorkspace?(cwd: string, onChange: () => void): () => void;
      storageGet(key: string): unknown;
      storageSet(key: string, value: unknown): Promise<void>;
      storageGetGlobal(key: string): unknown;
      storageSetGlobal(key: string, value: unknown): Promise<void>;
      openFile(path: string): Promise<void>;
      writeFile(absolutePath: string, content: string): Promise<void>;
      readFileBase64(absolutePath: string): Promise<string>;
      svnCatBase64(path: string, cwd: string): Promise<string>;
      notify(kind: 'info' | 'error', message: string): void;
      setWorkspacePath(path: string): void;
      chooseFolder(): Promise<string | null>;
      listSubfolders(dir: string): Promise<string[]>;
      getRecentFolders(): string[];
      addRecentFolder(path: string): void;
      svnBinaryPath(): string | null;
      appAction(action: 'quit' | 'reload' | 'devtools'): Promise<void>;
      zoom(delta: number): void;
      setTitleBarTheme(color: string, symbolColor: string): Promise<void>;
      appIconUrl(): string;
      devClearStorage(): Promise<void>;
      snapshotSave(entry: SnapshotEntryInput, files: SnapshotFileInput[]): Promise<SnapshotRecord>;
      snapshotList(workspace: string): Promise<SnapshotRecord[]>;
      snapshotRestore(id: string, files: string[], mode: RestoreMode): Promise<RestoreResult>;
      snapshotReadFile(id: string, path: string): Promise<string | null>;
    };
  }
}

function makeStorage(): HostStorage {
  return {
    get: <T>(key: string) => window.svnHost.storageGet(key) as T | undefined,
    set: (key, value) => window.svnHost.storageSet(key, value),
    getGlobal: <T>(key: string) => window.svnHost.storageGetGlobal(key) as T | undefined,
    setGlobal: (key, value) => window.svnHost.storageSetGlobal(key, value),
  };
}

export function createElectronAdapter(): HostAdapter {
  const storage = makeStorage();
  return {
    get workspacePath() {
      return window.svnHost.getWorkspacePath();
    },
    set workspacePath(path: string) {
      window.svnHost.setWorkspacePath(path);
    },

    exec: async (command: string, opts: ExecOptions): Promise<ExecResult> => {
      return window.svnHost.exec(command, { cwd: opts.cwd, timeout: opts.timeout });
    },

    execSvnArgs: (args: string[], opts: ExecOptions) =>
      window.svnHost.execSvnArgs(args, { cwd: opts.cwd, timeout: opts.timeout }),

    getModificationTimes: (paths: string[], cwd: string) =>
      window.svnHost.getModificationTimes(paths, cwd),

    watchWorkspace: window.svnHost.watchWorkspace
      ? (cwd, onChange) => window.svnHost.watchWorkspace?.(cwd, onChange) ?? (() => {})
      : undefined,

    storage,

    openFile: (path: string) => {
      return window.svnHost.openFile(path);
    },

    writeFile: (absolutePath: string, content: string) => {
      return window.svnHost.writeFile(absolutePath, content);
    },

    readFileBase64: (absolutePath: string) => window.svnHost.readFileBase64(absolutePath),

    svnCatBase64: (path: string, cwd: string) => window.svnHost.svnCatBase64(path, cwd),

    notify: (kind, message) => {
      window.svnHost.notify(kind, message);
    },

    chooseFolder: () => window.svnHost.chooseFolder(),

    snapshot: (entry, files) => window.svnHost.snapshotSave(entry, files),
    listSnapshots: workspace => window.svnHost.snapshotList(workspace),
    restoreSnapshot: (id, files, mode) => window.svnHost.snapshotRestore(id, files, mode),
    readSnapshotFile: (id, path) => window.svnHost.snapshotReadFile(id, path),

    ai: null,
  };
}
