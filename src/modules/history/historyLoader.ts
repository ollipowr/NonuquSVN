import { parseSvnBlame, parseSvnLog, runSvn, svnCat } from '@nonu/svn';

export type HistoryQuery = {
  limit?: number;
  from?: string;
  to?: string;
  before?: string;
  revision?: string;
  verbose?: boolean;
};
export async function loadHistory(
  cwd: string,
  { limit, from, to, before, revision, verbose }: HistoryQuery,
  target?: string,
) {
  const args = ['log', '--xml'];
  if (verbose) {
    // `LogView` requests this only for the active revision.
    args.push('-v');
  }
  if (revision) {
    args.push('-r', `${revision}:${revision}`);
  } else if (before) {
    const upper = String(Math.max(1, Number(before) - 1));
    const lower = from ? `{${from}T00:00:00}` : '1';
    args.push('-r', `${upper}:${lower}`);
  } else if (from || to) {
    const upper = to ? `{${to}T23:59:59}` : 'HEAD';
    const lower = from ? `{${from}T00:00:00}` : '1';
    args.push('-r', `${upper}:${lower}`);
  }
  if (limit != null) args.push('-l', String(limit));
  if (target) args.push(target);
  const { stdout } = await runSvn(args, cwd);
  return parseSvnLog(stdout);
}

/** target includes its peg revision; range controls the history window. */
export async function loadFileHistory(
  cwd: string,
  target: string,
  revision = 'HEAD',
) {
  const { stdout } = await runSvn(
    ['log', '-l', '50', '--xml', '-r', revision + ':1', target],
    cwd,
  );
  return parseSvnLog(stdout);
}

/** Omitted revision preserves the existing working-copy blame/BASE-content behavior. */
export async function loadFileBlame(
  cwd: string,
  target: string,
  revision?: string,
) {
  const [blame, content] = await Promise.all([
    runSvn(
      ['blame', '--xml', ...(revision ? ['-r', revision] : []), target],
      cwd,
    ),
    revision
      ? runSvn(['cat', '-r', revision, target], cwd).then(
          (result) => result.stdout,
        )
      : svnCat(target, cwd),
  ]);
  return parseSvnBlame(blame.stdout, content);
}
