import { app, BrowserWindow, Menu, ipcMain, dialog, shell, safeStorage } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { exec, execFile, spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { parseShellRequest } from '../src/host/shellRequest';

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
  process.exit(0);
}

let mainWindow: BrowserWindow | null = null;
const workspaceWatchers = new Map<number, fs.FSWatcher>();
const workspaceWatchTimers = new Map<number, NodeJS.Timeout>();

function stopWorkspaceWatcher(webContentsId: number) {
  workspaceWatchers.get(webContentsId)?.close();
  workspaceWatchers.delete(webContentsId);
  const timer = workspaceWatchTimers.get(webContentsId);
  if (timer) clearTimeout(timer);
  workspaceWatchTimers.delete(webContentsId);
}

function getAppIconPath(): string {
  if (app.isPackaged) return path.join(process.resourcesPath, 'icon.ico');
  return path.join(app.getAppPath(), 'build-resources', 'icon.ico');
}

function getAppIconSvgPath(): string {
  if (app.isPackaged) return path.join(process.resourcesPath, 'icon.svg');
  return path.join(app.getAppPath(), 'build-resources', 'icon.svg');
}

// CLI argument: `svn-client.exe <folder-path>`
let shellRequest = parseShellRequest(process.argv.slice(app.isPackaged ? 1 : 2));

const storageFile = path.join(app.getPath('userData'), 'svn-client-storage.json');
let storageData: Record<string, unknown> = {};

function loadStorage() {
  try {
    if (fs.existsSync(storageFile)) {
      storageData = JSON.parse(fs.readFileSync(storageFile, 'utf8'));
    }
  } catch {
    storageData = {};
  }
}

function flushStorage() {
  try {
    fs.writeFileSync(storageFile, JSON.stringify(storageData, null, 2), 'utf8');
  } catch (e) {
    console.error('[storage] flush failed', e);
  }
}

loadStorage();

const RECENT_KEY = '__recent__';
function getRecentFolders(): string[] {
  return (storageData[RECENT_KEY] as string[] | undefined) ?? [];
}
function addRecentFolder(folder: string) {
  const recent = getRecentFolders().filter(f => f !== folder);
  recent.unshift(folder);
  storageData[RECENT_KEY] = recent.slice(0, 10);
  flushStorage();
}

const SVN_PATH_KEY = '__svnBinaryPath__';
function getSvnBinaryPath(): string | null {
  return (storageData[SVN_PATH_KEY] as string | undefined) ?? null;
}

async function runCommand(
  command: string,
  cwd: string,
  timeout = 60000,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  // Detect `svn ...` commands and reroute to the configured binary if set.
  let cmd = command;
  const svnPath = getSvnBinaryPath();
  if (svnPath && command.startsWith('svn ')) {
    cmd = `"${svnPath}" ${command.slice(4)}`;
  }

  // exec() quotes correctly for cmd.exe; execFile('cmd', ['/c', cmd]) escapes inner quotes in a way cmd.exe misparses.
  return new Promise(resolve => {
    exec(
      cmd,
      { cwd, timeout, maxBuffer: 20 * 1024 * 1024, windowsHide: true, encoding: 'utf8' },
      (err, stdout, stderr) => {
        if (!err) return resolve({ stdout, stderr, exitCode: 0 });
        const e = err as NodeJS.ErrnoException & { code?: number | string };
        resolve({
          stdout: stdout ?? '',
          stderr: stderr || e.message,
          exitCode: typeof e.code === 'number' ? e.code : 1,
        });
      },
    );
  });
}

const TITLEBAR_HEIGHT = 36;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 640,
    minHeight: 400,
title: 'NonuquSVN',
    icon: getAppIconPath(),
    backgroundColor: '#1a1a1a',
    // Native frame is hidden: the renderer draws the title bar, the OS only paints the window buttons.
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#1a1a1a', symbolColor: '#b3b3b3', height: TITLEBAR_HEIGHT },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    // __dirname is dist-standalone/main/standalone/; renderer output lives in dist-standalone/renderer/
    mainWindow.loadFile(path.join(__dirname, '..', '..', 'renderer', 'index.html'));
  }
  if (process.env.SVN_CLIENT_DEBUG) mainWindow.webContents.openDevTools();
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    console.error('[renderer] process gone:', details.reason);
  });
  mainWindow.webContents.on('did-fail-load', (_e, code, desc, url) => {
    console.error(`[renderer] load failed ${code} ${desc} ${url}`);
  });
  mainWindow.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    console.log(`[renderer:${level}] ${message} (${sourceId}:${line})`);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null); // no native File/Edit menu
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('second-instance', (_event, argv) => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
  // Packaged and dev builds share the argv offset, so the second instance parses the same way.
  const request = parseShellRequest(argv.slice(app.isPackaged ? 1 : 2));
  if (request.path) {
    shellRequest = request;
    mainWindow?.webContents.send('open-path', request);
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});


// Synchronous handlers (used by preload before React renders)
ipcMain.on('get-arg-path-sync', e => { e.returnValue = shellRequest.path; });
ipcMain.on('get-shell-request-sync', e => { e.returnValue = shellRequest; });
ipcMain.on('get-recent-folders-sync', e => { e.returnValue = getRecentFolders(); });
ipcMain.on('get-app-icon-url-sync', e => { e.returnValue = pathToFileURL(getAppIconSvgPath()).toString(); });
// Whole storage snapshot so the renderer can answer synchronous reads locally.
ipcMain.on('storage-snapshot-sync', e => { e.returnValue = storageData; });
ipcMain.on('get-svn-binary-path-sync', e => { e.returnValue = getSvnBinaryPath(); });

ipcMain.handle('set-titlebar-theme', (_e, color: string, symbolColor: string) => {
  // setTitleBarOverlay only exists on Windows/Linux.
  mainWindow?.setTitleBarOverlay?.({ color, symbolColor, height: TITLEBAR_HEIGHT });
});

ipcMain.handle('app-action', (_e, action: 'quit' | 'reload' | 'devtools') => {
  if (action === 'quit') app.quit();
  else if (action === 'reload') mainWindow?.webContents.reload();
  else mainWindow?.webContents.toggleDevTools();
});

ipcMain.handle('get-arg-path', () => shellRequest.path);

  ipcMain.handle('exec', async (_e, command: string, opts: { cwd: string; timeout?: number }) => {
    return runCommand(command, opts.cwd, opts.timeout);
  });

  // Argv-based svn invocation: no shell, so credentials need no quoting at all.
  ipcMain.handle('exec-svn-args', (_e, args: string[], opts: { cwd: string; timeout?: number }) => {
    if (!Array.isArray(args) || args.some(a => typeof a !== 'string')) {
      return { stdout: '', stderr: 'Invalid svn arguments', exitCode: 1 };
    }
    return new Promise<{ stdout: string; stderr: string; exitCode: number }>(resolve => {
      execFile(
        getSvnBinaryPath() ?? 'svn',
        args,
        { cwd: opts.cwd, timeout: opts.timeout ?? 60000, maxBuffer: 20 * 1024 * 1024, windowsHide: true, encoding: 'utf8' },
        (err, stdout, stderr) => {
          if (!err) return resolve({ stdout, stderr, exitCode: 0 });
          const e = err as NodeJS.ErrnoException & { code?: number | string };
          resolve({
            stdout: stdout ?? '',
            stderr: stderr || e.message,
            exitCode: typeof e.code === 'number' ? e.code : 1,
          });
        },
      );
    });
  });

  ipcMain.handle('get-modification-times', async (_e, paths: string[], cwd: string) => {
    const root = path.resolve(cwd);
    const result: Record<string, number> = {};
    await Promise.all(paths.map(async relativePath => {
      const resolved = path.resolve(root, relativePath);
      // Only stat entries inside the requested workspace. This IPC endpoint
      // deliberately accepts relative SVN paths, never arbitrary file paths.
      if (resolved !== root && !resolved.startsWith(root + path.sep)) return;
      try {
        result[relativePath.replace(/\\/g, '/')] = (await fs.promises.stat(resolved)).mtimeMs;
      } catch {
        // Deleted or unreadable entries are expected while status is refreshed.
      }
    }));
    return result;
  });

ipcMain.handle('watch-workspace', (event, cwd: string) => {
  const webContentsId = event.sender.id;
  stopWorkspaceWatcher(webContentsId);
  const root = path.resolve(cwd);
  try {
    if (!fs.statSync(root).isDirectory()) return false;
  } catch {
    return false;
  }

  let watcher: fs.FSWatcher;
  try {
    watcher = fs.watch(root, { recursive: true }, (_kind, filename) => {
      const relativePath = filename?.toString().replace(/\\/g, '/');
      if (!relativePath || relativePath.split('/').includes('.svn')) return;
      const previous = workspaceWatchTimers.get(webContentsId);
      if (previous) clearTimeout(previous);
      workspaceWatchTimers.set(
        webContentsId,
        setTimeout(() => {
          workspaceWatchTimers.delete(webContentsId);
          if (!event.sender.isDestroyed())
            event.sender.send('workspace-files-changed', root);
        }, 180),
      );
    });
  } catch (error) {
    console.warn('[workspace watcher] unavailable:', error);
    return false;
  }
  watcher.on('error', error => {
    console.warn('[workspace watcher] stopped:', error.message);
    stopWorkspaceWatcher(webContentsId);
  });
  workspaceWatchers.set(webContentsId, watcher);
  event.sender.once('destroyed', () => stopWorkspaceWatcher(webContentsId));
  return true;
});

ipcMain.handle('unwatch-workspace', event => {
  stopWorkspaceWatcher(event.sender.id);
});

ipcMain.handle('storage-get', (_e, key: string) => storageData[key]);

ipcMain.handle('storage-set', (_e, key: string, value: unknown) => {
  storageData[key] = value;
  flushStorage();
});

ipcMain.handle('storage-get-global', (_e, key: string) => {
  const globalData = (storageData['__global__'] as Record<string, unknown> | undefined) ?? {};
  return globalData[key];
});

ipcMain.handle('storage-set-global', (_e, key: string, value: unknown) => {
  if (!storageData['__global__']) storageData['__global__'] = {};
  (storageData['__global__'] as Record<string, unknown>)[key] = value;
  flushStorage();
});

ipcMain.handle('open-file', async (_e, filePath: string) => {
  const stat = await fs.promises.stat(filePath);
  const error = await shell.openPath(filePath);
  if (!error) return;
  // Some Windows installations have no association for source-code extensions.
  if (process.platform === 'win32' && stat.isFile()) {
    const child = spawn('notepad.exe', [filePath], {
      detached: true,
      windowsHide: false,
      stdio: 'ignore',
    });
    await new Promise<void>((resolve, reject) => {
      child.once('spawn', resolve);
      child.once('error', reject);
    });
    child.unref();
    return;
  }
  throw new Error(error);
});

ipcMain.handle('write-file', async (_e, absolutePath: string, content: string) => {
  await fs.promises.writeFile(absolutePath, content, 'utf8');
});

ipcMain.handle('read-file-base64', async (_e, absolutePath: string) => {
  return (await fs.promises.readFile(absolutePath)).toString('base64');
});

ipcMain.handle('svn-cat-base64', async (_e, filePath: string, cwd: string) => {
  const binary = getSvnBinaryPath() ?? 'svn';
  return new Promise<string>((resolve, reject) => {
    const child = spawn(binary, ['cat', '-r', 'BASE', '--non-interactive', filePath], {
      cwd,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const output: Buffer[] = [];
    const errors: Buffer[] = [];
    child.stdout.on('data', chunk => output.push(Buffer.from(chunk)));
    child.stderr.on('data', chunk => errors.push(Buffer.from(chunk)));
    child.once('error', reject);
    child.once('close', code => {
      if (code === 0) resolve(Buffer.concat(output).toString('base64'));
      else reject(new Error(Buffer.concat(errors).toString('utf8').trim() || `svn cat failed (exit ${code ?? 'unknown'})`));
    });
  });
});

ipcMain.handle('notify', (_e, kind: string, message: string) => {
  if (mainWindow) {
    mainWindow.webContents.send('notify-toast', { kind, message });
  }
});

ipcMain.handle('list-subfolders', async (_e, dir: string) =>
  (await fs.promises.readdir(dir, { withFileTypes: true }))
    .filter((d) => d.isDirectory())
    .map((d) => path.join(dir, d.name)),
);

ipcMain.handle('choose-folder', async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Select SVN Working Copy Folder',
  });
  return result.canceled ? null : result.filePaths[0] ?? null;
});

ipcMain.handle('get-recent-folders', () => getRecentFolders());

ipcMain.handle('add-recent-folder', (_e, folder: string) => {
  addRecentFolder(folder);
});

ipcMain.handle('get-svn-binary-path', () => getSvnBinaryPath());

// Credential storage via safeStorage
ipcMain.handle('save-credential', (_e, account: string, secret: string) => {
  if (!safeStorage.isEncryptionAvailable()) {
    storageData[`__cred__${account}`] = secret;
  } else {
    storageData[`__cred__${account}`] = safeStorage.encryptString(secret).toString('base64');
  }
  flushStorage();
});

ipcMain.handle('load-credential', (_e, account: string) => {
  const raw = storageData[`__cred__${account}`] as string | undefined;
  if (!raw) return null;
  if (!safeStorage.isEncryptionAvailable()) return raw;
  try {
    return safeStorage.decryptString(Buffer.from(raw, 'base64'));
  } catch {
    return null;
  }
});

ipcMain.handle('dev-clear-storage', () => {
  storageData = {};
  try {
    if (fs.existsSync(storageFile)) {
      fs.unlinkSync(storageFile);
    }
  } catch (e) {
    console.error('[dev-clear-storage] failed to delete file', e);
  }
  return true;
});
