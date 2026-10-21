import type { SvnRepoInfo } from '@nonu/svn';

const normalizeLocal = (path: string) =>
  path.replace(/\\/g, '/').replace(/\/+$/, '');

function checkoutUrlFor(
  repo: SvnRepoInfo | null,
  cwd?: string,
): string | undefined {
  if (repo?.workingCopyUrl) return repo.workingCopyUrl;
  if (!repo?.url || !repo.root || !cwd) return repo?.url;
  const root = normalizeLocal(repo.root).toLocaleLowerCase();
  const workspace = normalizeLocal(cwd);
  const workspaceLower = workspace.toLocaleLowerCase();
  if (workspaceLower !== root && !workspaceLower.startsWith(`${root}/`))
    return repo.url;
  const levels = workspace.slice(root.length).split('/').filter(Boolean).length;
  const parsed = new URL(repo.url);
  const segments = parsed.pathname.split('/').filter(Boolean);
  if (levels > segments.length) return repo.url;
  parsed.pathname = `/${segments.slice(0, segments.length - levels).join('/')}`;
  return parsed.toString().replace(/\/$/, '');
}

/** Map a repository-rooted log path relative to the working-copy root. */
export function localLogPath(
  path: string,
  repo: SvnRepoInfo | null,
  cwd?: string,
): string | null {
  const checkoutUrl = checkoutUrlFor(repo, cwd);
  if (!checkoutUrl || !repo?.repositoryRoot) return null;
  const root = repo.repositoryRoot.replace(/\/+$/, '');
  const url = checkoutUrl.replace(/\/+$/, '');
  if (url !== root && !url.startsWith(`${root}/`)) return null;
  const prefix = decodeURIComponent(url.slice(root.length));
  if (path !== prefix && !path.startsWith(`${prefix}/`)) return null;
  const relative = path.slice(prefix.length).replace(/^\/+/, '');
  if (
    relative.split('/').some((part) => part === '..' || part === '.') ||
    relative.includes('\\')
  )
    return null;
  return relative || '.';
}

/** Resolve a repository log path to its absolute location in the local checkout. */
export function absoluteLocalLogPath(
  path: string,
  repo: SvnRepoInfo | null,
  cwd?: string,
): string | null {
  const relative = localLogPath(path, repo, cwd);
  if (relative === null || !repo?.root) return null;
  const separator = repo.root.includes('\\') ? '\\' : '/';
  const root = repo.root.replace(/[\\/]+$/, '');
  if (relative === '.') return root;
  return `${root}${separator}${relative.replaceAll('/', separator)}`;
}

/** Peg revisions keep history actions valid after later moves or deletions. */
export function logFileTarget(
  path: string,
  revision: string,
  action?: string,
  repositoryRoot?: string,
) {
  const atRevision =
    action === 'D' ? String(Math.max(0, Number(revision) - 1)) : revision;
  const encodedPath = path
    .replace(/^\/+/, '')
    .split('/')
    .map(encodeURIComponent)
    .join('/');
  // `^/` breaks under cmd.exe escaping on some hosts, so pass the repository URL.
  const root = repositoryRoot?.replace(/\/+$/, '');
  const targetPath = root ? `${root}/${encodedPath}` : `^/${encodedPath}`;
  return { target: `${targetPath}@${atRevision}`, revision: atRevision };
}
