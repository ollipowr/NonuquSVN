import type { HostAdapter } from '@nonu/host/types';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';

const nav = vi.hoisted(() => ({ props: {} as Record<string, any> }));
const bar = vi.hoisted(() => ({ props: {} as Record<string, any> }));
vi.mock('@nonu/components', () => ({
  ActivityBar: (props: Record<string, any>) => {
    nav.props = props;
    return null;
  },
  ContextMenu: () => null,
  useNavExpanded: () => ({ expanded: true, toggle: () => {}, error: '' }),
}));
vi.mock('@nonu/modules/home/StartPage', () => ({ StartPage: () => null }));
vi.mock('@nonu/modules/settings/SettingsPanel', () => ({
  SvnSettingsPanel: () => null,
}));
vi.mock('@nonu/svn', () => ({
  buildCheckoutArgs: vi.fn(),
  detectSvnRepo: vi.fn().mockResolvedValue({ isWorkingCopy: false }),
}));

const workspace = vi.hoisted(() => ({
  props: {} as Record<string, any>,
  mounts: 0,
}));
vi.mock('@nonu/modules/workspace/WorkspaceView', async () => {
  const { useEffect } = await import('react');
  return {
    WorkspaceView: (props: Record<string, any>) => {
      workspace.props = props;
      useEffect(() => {
        workspace.mounts++;
      }, []);
      return null;
    },
  };
});
vi.mock('@nonu/modules/workspace/WorkspaceBar', () => ({
  WorkspaceBar: (props: Record<string, any>) => {
    bar.props = props;
    return null;
  },
}));

it('routes cold and repeated Explorer launches without remounting the current workspace', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  window.svnHost = {
    getShellRequest: () => ({ path: 'C:\\working copy', view: 'logs' }),
    storageGetGlobal: () => undefined,
    storageSetGlobal: vi.fn(),
    setTitleBarTheme: vi.fn(),
    getRecentFolders: () => [],
    addRecentFolder: vi.fn(),
  } as unknown as Window['svnHost'];
  const { App } = await import('./App');
  const adapter = {
    workspacePath: 'C:\\working copy',
    storage: {
      get: () => undefined,
      set: async () => {},
      getGlobal: () => undefined,
      setGlobal: async () => {},
    },
  } as unknown as HostAdapter;
  const element = document.createElement('div');
  document.body.append(element);
  const root = createRoot(element);
  try {
    await act(async () => root.render(<App adapter={adapter} />));
    expect(workspace.props.initialView).toBe('logs');
    expect(workspace.props.shellViewRequest).toEqual({ view: 'logs' });
    expect(typeof workspace.props.onHome).toBe('function');
    expect(workspace.mounts).toBe(1);
    for (const view of ['changes', 'merge', 'repo', 'logs', 'logs']) {
      await act(async () => {
        window.dispatchEvent(
          new CustomEvent('svn-open-path', {
            detail: { path: 'C:\\working copy', view },
          }),
        );
      });
      expect(workspace.props.shellViewRequest).toEqual({ view });
      expect(workspace.mounts).toBe(1);
    }
    await act(async () => workspace.props.onViewChange('changes'));
    expect(workspace.props.shellViewRequest).toBeUndefined();
    await act(async () => {
      window.dispatchEvent(
        new CustomEvent('svn-open-path', {
          detail: { path: 'C:\\other copy', view: 'repo' },
        }),
      );
    });
    expect(adapter.workspacePath).toBe('C:\\other copy');
    expect(workspace.props.initialView).toBe('repo');
    expect(workspace.mounts).toBe(2);
    await act(async () => workspace.props.onHome());
    expect(adapter.workspacePath).toBe('C:\\other copy');
    expect(nav.props.active).toBe('start');
    expect(nav.props.views.map((view: { id: string }) => view.id)).toEqual([
      'changes',
      'logs',
      'repo',
    ]);
    await act(async () => nav.props.onChange('logs'));
    expect(workspace.props.initialView).toBe('logs');
    expect(workspace.mounts).toBe(3);
  } finally {
    await act(async () => root.unmount());
    element.remove();
  }
});

it('has no hidden home link on the title bar icon', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  window.svnHost = {
    getShellRequest: () => ({ path: '' }),
    storageGetGlobal: () => undefined,
    storageSetGlobal: vi.fn(),
    setTitleBarTheme: vi.fn(),
    getRecentFolders: () => [],
    addRecentFolder: vi.fn(),
  } as unknown as Window['svnHost'];
  const { App } = await import('./App');
  const adapter = {
    workspacePath: '',
    storage: {
      get: () => undefined,
      set: async () => {},
      getGlobal: () => undefined,
      setGlobal: async () => {},
    },
  } as unknown as HostAdapter;
  const element = document.createElement('div');
  document.body.append(element);
  const root = createRoot(element);
  try {
    await act(async () => root.render(<App adapter={adapter} />));
    expect(element.querySelector('.svn-titlebar-app-icon-btn')).toBeNull();
    expect(element.querySelector('.svn-titlebar-app-icon')).not.toBeNull();
  } finally {
    act(() => root.unmount());
    element.remove();
  }
});

it('enables project tabs on Start and opens branches without a previously open working copy', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  window.svnHost = {
    getShellRequest: () => ({ path: '' }),
    storageGetGlobal: () => undefined,
    storageSetGlobal: vi.fn(),
    setTitleBarTheme: vi.fn(),
    getRecentFolders: () => [],
    addRecentFolder: vi.fn(),
  } as unknown as Window['svnHost'];
  const saved = {
    version: 1,
    activeProjectId: 'p',
    projects: [{ id: 'p', name: 'Portal', workspaceIds: ['w'] }],
    workspaces: [
      {
        id: 'w',
        projectId: 'p',
        name: 'dev',
        svnUrl: 'svn://example/dev',
        localPath: 'C:/portal/dev',
        kind: 'branch',
      },
    ],
  };
  const adapter = {
    workspacePath: '',
    storage: {
      get: () => undefined,
      set: async () => {},
      getGlobal: (key: string) =>
        key === 'nonuqu.projects.v1' ? saved : undefined,
      setGlobal: async () => {},
    },
  } as unknown as HostAdapter;
  const { App } = await import('./App');
  const element = document.createElement('div');
  document.body.append(element);
  const root = createRoot(element);
  try {
    await act(async () => root.render(<App adapter={adapter} />));
    expect(nav.props.active).toBe('start');
    expect(
      nav.props.views
        .filter((view: { group?: string }) => view.group !== 'workspace')
        .every((view: { disabled?: boolean }) => !view.disabled),
    ).toBe(true);
    expect(
      nav.props.views.map((view: { id: string }) => view.id),
    ).not.toContain('branches');
    expect(bar.props.onManageBranches).toBeUndefined();
    expect(adapter.workspacePath).toBe('');
    expect(nav.props.active).toBe('start');
  } finally {
    await act(async () => root.unmount());
    element.remove();
  }
});

it('opens the last working copy on start when enabled', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  window.svnHost = {
    getShellRequest: () => ({ path: '' }),
    storageGetGlobal: () => undefined,
    storageSetGlobal: vi.fn(),
    setTitleBarTheme: vi.fn(),
    getRecentFolders: () => [],
    addRecentFolder: vi.fn(),
  } as unknown as Window['svnHost'];
  const { detectSvnRepo } = await import('@nonu/svn');
  vi.mocked(detectSvnRepo).mockResolvedValue({ isWorkingCopy: true });
  const store = {
    get: () => undefined,
    set: async () => {},
    getGlobal: (key: string) =>
      key === 'svn.settings'
        ? { openLastOnStart: true }
        : key === 'nonuqu.projects.v1'
          ? {
              version: 1,
              projects: [{ id: 'p', name: 'P', workspaceIds: ['w'] }],
              workspaces: [
                {
                  id: 'w',
                  projectId: 'p',
                  name: 'dev',
                  svnUrl: 'u',
                  localPath: 'C:\\last',
                  kind: 'trunk',
                  lastOpenedAt: 3,
                },
              ],
            }
          : undefined,
    setGlobal: async () => {},
  };
  const { App } = await import('./App');
  const adapter = {
    workspacePath: '',
    storage: store,
  } as unknown as HostAdapter;
  const element = document.createElement('div');
  document.body.append(element);
  const root = createRoot(element);
  try {
    await act(async () => root.render(<App adapter={adapter} />));
    await act(async () => {
      await Promise.resolve();
    });
    expect(adapter.workspacePath).toBe('C:\\last');
  } finally {
    act(() => root.unmount());
    element.remove();
  }
});

it('guards context changes and does not switch when project storage fails', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  window.svnHost = {
    getShellRequest: () => ({ path: '' }),
    storageGetGlobal: () => undefined,
    storageSetGlobal: vi.fn(),
    setTitleBarTheme: vi.fn(),
    getRecentFolders: () => [],
    addRecentFolder: vi.fn(),
  } as unknown as Window['svnHost'];
  const saved = {
    version: 1,
    activeProjectId: 'old',
    projects: [
      { id: 'old', name: 'Old', workspaceIds: [] },
      { id: 'next', name: 'Next', workspaceIds: ['w'] },
    ],
    workspaces: [
      {
        id: 'w',
        projectId: 'next',
        name: 'dev',
        svnUrl: 'svn://example/dev',
        localPath: 'C:/next',
        kind: 'branch',
      },
    ],
  };
  const setGlobal = vi.fn().mockRejectedValue(new Error('disk full'));
  const adapter = {
    workspacePath: 'C:/old',
    storage: {
      get: () => undefined,
      set: async () => {},
      getGlobal: (k: string) =>
        k === 'nonuqu.projects.v1' ? saved : undefined,
      setGlobal,
    },
  } as unknown as HostAdapter;
  const { App } = await import('./App');
  const element = document.createElement('div');
  document.body.append(element);
  const root = createRoot(element);
  try {
    await act(async () => root.render(<App adapter={adapter} />));
    setGlobal.mockClear();
    let proceed: (() => void) | undefined;
    await act(async () =>
      workspace.props.onChrome({
        guard: (next: () => void) => {
          proceed = next;
        },
      }),
    );
    await act(async () =>
      window.dispatchEvent(
        new CustomEvent('svn-open-path', {
          detail: { path: 'C:/next', preserveView: true },
        }),
      ),
    );
    expect(adapter.workspacePath).toBe('C:/old');
    expect(setGlobal).not.toHaveBeenCalled();
    await act(async () => proceed?.());
    expect(adapter.workspacePath).toBe('C:/old');
    expect(saved.activeProjectId).toBe('old');
    expect(element.querySelector('[role="alert"]')?.textContent).toContain(
      'disk full',
    );
  } finally {
    await act(async () => root.unmount());
    element.remove();
  }
});
it('opens a project without a local working copy through search navigation', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  window.svnHost = {
    getShellRequest: () => ({ path: '' }),
    storageGetGlobal: () => undefined,
    storageSetGlobal: vi.fn(),
    setTitleBarTheme: vi.fn(),
    getRecentFolders: () => [],
    addRecentFolder: vi.fn(),
  } as unknown as Window['svnHost'];
  let saved = {
    version: 1,
    projects: [{ id: 'empty', name: 'Empty', workspaceIds: [] }],
    workspaces: [],
  };
  const adapter = {
    workspacePath: '',
    storage: {
      get: () => undefined,
      set: async () => {},
      getGlobal: (k: string) =>
        k === 'nonuqu.projects.v1' ? saved : undefined,
      setGlobal: async (k: string, value: unknown) => {
        if (k === 'nonuqu.projects.v1') saved = value as typeof saved;
      },
    },
  } as unknown as HostAdapter;
  const { App } = await import('./App');
  const element = document.createElement('div');
  document.body.append(element);
  const root = createRoot(element);
  try {
    await act(async () => root.render(<App adapter={adapter} />));
    await act(async () =>
      window.dispatchEvent(
        new CustomEvent('svn-open-project', { detail: { projectId: 'empty' } }),
      ),
    );
    expect(nav.props.active).toBe('start');
    expect(adapter.workspacePath).toBe('');
  } finally {
    await act(async () => root.unmount());
    element.remove();
  }
});
