import type { HostAdapter } from '@nonu/host/types';
import type { FormatterRule } from '@nonu/modules/settings/settings';

const SCAN_RULES: Array<{ glob: string; cmd: string }> = [
  { glob: 'biome.json', cmd: 'npx biome format --write .' },
  { glob: '.prettierrc', cmd: 'npx prettier --write .' },
  { glob: '.prettierrc.json', cmd: 'npx prettier --write .' },
  { glob: '.prettierrc.js', cmd: 'npx prettier --write .' },
  { glob: '.prettierrc.cjs', cmd: 'npx prettier --write .' },
  { glob: '.prettierrc.mjs', cmd: 'npx prettier --write .' },
  { glob: '.prettierrc.yaml', cmd: 'npx prettier --write .' },
  { glob: '.prettierrc.yml', cmd: 'npx prettier --write .' },
  { glob: 'prettier.config.js', cmd: 'npx prettier --write .' },
  { glob: 'prettier.config.cjs', cmd: 'npx prettier --write .' },
  { glob: 'prettier.config.mjs', cmd: 'npx prettier --write .' },
  { glob: '*.csproj', cmd: 'dotnet format' },
  { glob: '*.sln', cmd: 'dotnet format' },
  { glob: 'Cargo.toml', cmd: 'cargo fmt' },
  { glob: '.php-cs-fixer.php', cmd: 'php-cs-fixer fix' },
  { glob: '.php-cs-fixer.dist.php', cmd: 'php-cs-fixer fix' },
  { glob: '.clang-format', cmd: 'clang-format -i' },
];

function toPosix(p: string): string {
  return p.replace(/\\/g, '/');
}

function toRelative(absPath: string, root: string): string {
  const rel = toPosix(absPath).replace(toPosix(root).replace(/\/?$/, '/'), '');
  return rel || '.';
}

export async function scanFormatterRules(
  host: HostAdapter,
): Promise<FormatterRule[]> {
  const cwd = host.workspacePath;
  if (!cwd) return [];

  const found = new Map<string, FormatterRule>();

  for (const rule of SCAN_RULES) {
    const script =
      `powershell -NoProfile -NonInteractive -Command ` +
      `"Get-ChildItem -Path . -Filter '${rule.glob}' -Recurse -Depth 4 ` +
      `-ErrorAction SilentlyContinue | ForEach-Object { $_.DirectoryName } | Select-Object -Unique"`;
    try {
      const res = await host.exec(script, { cwd, timeout: 10000 });
      if (res.exitCode !== 0 || !res.stdout.trim()) continue;
      for (const line of res.stdout.trim().split(/\r?\n/)) {
        const dir = line.trim();
        if (!dir) continue;
        const relDir = toRelative(dir, cwd);
        if (!found.has(dir)) {
          found.set(dir, { path: relDir, cmd: rule.cmd, enabled: true });
        }
      }
    } catch {
      // host may not support PowerShell — skip silently
    }
  }

  return Array.from(found.values()).sort((a, b) =>
    a.path.localeCompare(b.path),
  );
}

export function findFormatterRule(
  rules: FormatterRule[],
  filePath: string,
): FormatterRule | null {
  const normPath = toPosix(filePath);
  const enabledRules = rules.filter((r) => r.enabled && r.cmd.trim());
  let best: FormatterRule | null = null;
  for (const rule of enabledRules) {
    const rulePrefix = toPosix(rule.path === '.' ? '' : rule.path);
    const matches =
      rulePrefix === '' ||
      normPath.startsWith(rulePrefix + '/') ||
      normPath === rulePrefix;
    if (matches && (!best || rule.path.length > best.path.length)) {
      best = rule;
    }
  }
  return best;
}

export async function runFormatterRules(
  rules: FormatterRule[],
  committedPaths: string[],
  host: HostAdapter,
): Promise<void> {
  const cwd = host.workspacePath;
  const enabledRules = rules.filter((r) => r.enabled && r.cmd.trim());
  if (!enabledRules.length || !committedPaths.length) return;

  const normPaths = committedPaths.map(toPosix);

  const dirsToRun = new Map<string, FormatterRule>();
  for (const filePath of normPaths) {
    let best: FormatterRule | null = null;
    for (const rule of enabledRules) {
      const rulePrefix = toPosix(rule.path === '.' ? '' : rule.path);
      const matches =
        rulePrefix === '' ||
        filePath.startsWith(rulePrefix + '/') ||
        filePath === rulePrefix;
      if (matches && (!best || rule.path.length > best.path.length)) {
        best = rule;
      }
    }
    if (best) dirsToRun.set(best.path, best);
  }

  for (const rule of dirsToRun.values()) {
    const execCwd =
      rule.path === '.' ? cwd : `${cwd}/${rule.path}`.replace(/\//g, '\\');
    const res = await host.exec(rule.cmd.trim(), {
      cwd: execCwd,
      timeout: 60000,
    });
    if (res.exitCode !== 0) {
      throw new Error(
        `Formatter (${rule.path}): ${res.stderr.trim() || res.stdout.trim() || 'formatter failed'}`,
      );
    }
  }
}
