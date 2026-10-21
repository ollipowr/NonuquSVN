import type { ProjectStore } from '@nonu/modules/projects/projects';

/** Last two parts of the SVN URL path ("branches/2609"), so the end stays visible. */
export function branchPath(svnUrl: string): string {
  const parts = svnUrl
    .replace(/^[a-z+]+:\/\/[^/]*/i, '')
    .split('/')
    .filter(Boolean);
  return (parts.length > 2 ? '…/' : '') + parts.slice(-2).join('/');
}

export interface SwitcherRow {
  projectId: string;
  projectName: string;
  workspaceId: string;
  name: string;
  localPath: string;
  branch?: string;
  kind: ProjectStore['workspaces'][number]['kind'];
}

/** Local working copies grouped by project, restricted to the selected project. */
export function switcherRows(
  store: ProjectStore,
  projectId?: string,
): SwitcherRow[] {
  return store.projects
    .filter((p) => !projectId || p.id === projectId)
    .flatMap((p) =>
      store.workspaces
        .filter((w) => w.projectId === p.id && w.localPath && !w.hidden)
        .map((w) => ({
          projectId: p.id,
          projectName: p.name,
          workspaceId: w.id,
          name: w.name,
          branch: branchPath(w.svnUrl),
          kind: w.kind,
          localPath: w.localPath as string,
        })),
    );
}
