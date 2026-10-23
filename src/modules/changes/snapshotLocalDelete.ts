import type { HostAdapter, SnapshotFileInput } from '@nonu/host/types';

const psQuote = (value: string) => `'${value.replace(/'/g, "''")}'`;

/** Snapshots files under `paths`, folders included, before a delete outside svn. */
export async function snapshotLocalDelete(
  host: HostAdapter,
  cwd: string,
  paths: string[],
): Promise<string> {
  if (!host.snapshot) throw new Error('Snapshot store unavailable.');
  const base = cwd.replace(/[\\/]+$/, '');
  const files: SnapshotFileInput[] = [];
  for (const p of paths) {
    const abs = `${base}\\${p.replace(/\//g, '\\')}`;
    const listed = await host.exec(
      `powershell -NoProfile -Command "(Get-ChildItem -LiteralPath ${psQuote(abs)} -Recurse -File -Force).FullName"`,
      { cwd },
    );
    if (listed.exitCode !== 0) {
      throw new Error(listed.stderr.trim() || `Could not list ${p}.`);
    }
    for (const full of listed.stdout.split(/\r?\n/).map((l) => l.trim())) {
      if (!full) continue;
      files.push({
        path: full.slice(base.length + 1),
        statusBefore: '?',
        content: await host.readFileBase64(full),
      });
    }
  }
  const record = await host.snapshot(
    { command: `delete local ${paths.join(' ')}`, workingCopy: cwd },
    files,
  );
  return record.id;
}
