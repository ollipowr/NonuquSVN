import { setPanelHost } from '@nonu/stores';
import { describe, expect, it, vi } from 'vitest';
import { runSvn } from './svn';

describe('runSvn', () => {
  it('passes commit messages with ampersands through the argv host path', async () => {
    const execSvnArgs = vi.fn().mockResolvedValue({
      stdout: 'Committed revision 12.\n',
      stderr: '',
      exitCode: 0,
    });
    setPanelHost({ execSvnArgs } as never);

    await expect(
      runSvn(['commit', '-m', 'Fix parser & preserve message'], 'C:\\work'),
    ).resolves.toEqual({
      stdout: 'Committed revision 12.\n',
      stderr: '',
    });

    expect(execSvnArgs).toHaveBeenCalledWith(
      ['commit', '-m', 'Fix parser & preserve message', '--non-interactive'],
      { cwd: 'C:\\work', timeout: 60000 },
    );
  });
});
