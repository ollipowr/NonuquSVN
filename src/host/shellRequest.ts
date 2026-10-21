/** Navigation only: shell commands never perform SVN writes automatically. */
export type ShellView = 'changes' | 'logs' | 'repo';
export interface ShellRequest {
  path: string;
  view?: ShellView;
}

export function parseShellRequest(args: string[]): ShellRequest {
  const views: Record<string, ShellView> = {
    '--log': 'logs',
    '--changes': 'changes',
    '--branches': 'changes',
    '--repo': 'repo',
  };
  let view: ShellView | undefined;
  let path = '';
  for (const arg of args) {
    if (Object.prototype.hasOwnProperty.call(views, arg)) view = views[arg];
    else if (!arg.startsWith('-') && !path) path = arg;
  }
  return { path, view };
}
