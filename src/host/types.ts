export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface ExecOptions {
  cwd: string;
  timeout?: number;
}

/** Storage abstraction — mirrors the subset used by the panel. */
export interface HostStorage {
  get<T>(key: string): T | undefined;
  set(key: string, value: unknown): Promise<void>;
  getGlobal<T>(key: string): T | undefined;
  setGlobal(key: string, value: unknown): Promise<void>;
}

export interface SnapshotEntryInput {
  command: string;
  workingCopy: string;
}

export interface SnapshotFileInput {
  path: string;
  statusBefore: string;
  /** Base64 content before the command; null when the file did not exist. */
  content: string | null;
}

interface SnapshotFile {
  path: string;
  statusBefore: string;
  hash: string | null;
}

export interface SnapshotRecord {
  id: string;
  time: string;
  /** Command with passwords masked. */
  command: string;
  workingCopy: string;
  files: SnapshotFile[];
}

/** `overwrite` replaces existing files; `missing-only` keeps them; `copy` writes differing files beside the original; `check` writes nothing and reports differing files as conflicts. */
export type RestoreMode = 'overwrite' | 'missing-only' | 'copy' | 'check';

export interface RestoreResult {
  restored: string[];
  /** Existing files that differ from the snapshot (only reported in `check` mode). */
  conflicts: string[];
  skipped: string[];
  /** Files that failed to restore; the others are still processed. */
  failed: string[];
}

export interface AiProvider {
  sendPrompt(opts: {
    prompt: string;
    sessionName: string;
    provider: string;
    model?: string;
  }): Promise<{ response: string }>;
  listModels(): Promise<{ id: string; name: string; provider: string }[]>;
}

/** The host APIs the SVN panel uses. The Electron adapter implements this. */
export type StorageCleanupId = 'http-cache' | 'code-cache' | 'reflog';

export interface StorageCleanupItem {
  id: StorageCleanupId;
  bytes: number;
}

export interface StorageCleanupResult {
  id: StorageCleanupId;
  error?: string;
}

export interface HostAdapter {
  /** Absolute path of the current workspace / working directory. */
  workspacePath: string;

  /** Run an arbitrary shell command and return its output. */
  exec(command: string, opts: ExecOptions): Promise<ExecResult>;

  /** Run SVN with an argv array, bypassing the platform shell. */
  execSvnArgs?(args: string[], opts: ExecOptions): Promise<ExecResult>;

  /** Reads modification times without a platform shell. Optional: without it the list has no mtime sorting. */
  getModificationTimes?(
    paths: string[],
    cwd: string,
  ): Promise<Record<string, number>>;

  /** Observes working-copy changes. Hosts may coalesce events and should ignore `.svn`. */
  watchWorkspace?(cwd: string, onChange: () => void): () => void;

  /** Persistent key-value storage scoped to the current workspace + a global namespace. */
  storage: HostStorage;

  /** Opens a file in the host editor or file manager (Electron: the default app via `shell.openPath`). */
  openFile(path: string): void | Promise<void>;

  /** Writes a file at the given absolute path. */
  writeFile(absolutePath: string, content: string): Promise<void>;

  /** Read a file as base64 without starting a shell process. */
  readFileBase64(absolutePath: string): Promise<string>;

  /** Read the pristine SVN BASE version as base64 without shell encoding loss. */
  svnCatBase64(path: string, cwd: string): Promise<string>;

  /** Shows a toast; a no-op is acceptable in both adapters. */
  notify(kind: 'info' | 'error', message: string): void;

  /** Open a native folder picker and return the chosen path, or null if cancelled. */
  chooseFolder?(): Promise<string | null>;

  /** Stores the file contents taken before a command, deduplicated by hash. */
  snapshot?(
    entry: SnapshotEntryInput,
    files: SnapshotFileInput[],
  ): Promise<SnapshotRecord>;

  /** Lists the stored snapshots of a workspace, newest first. */
  listSnapshots?(workspace: string): Promise<SnapshotRecord[]>;

  restoreSnapshot?(
    id: string,
    files: string[],
    mode: RestoreMode,
  ): Promise<RestoreResult>;

  /** Base64 content of one file stored in a snapshot; null when it was not stored. */
  readSnapshotFile?(id: string, path: string): Promise<string | null>;

  /** Sizes of the app data that can be cleared from settings. */
  storageCleanupItems?(): Promise<StorageCleanupItem[]>;

  runStorageCleanup?(ids: StorageCleanupId[]): Promise<StorageCleanupResult[]>;

  /** Deletes all saved app state and restarts the app. */
  resetAllData?(): Promise<void>;

  ai: AiProvider | null;
}
