import { t } from '@nonu/app/i18n';
import type { SvnSettings } from '@nonu/modules/settings/settings';
import {
  getPanelHost,
  loadSnapshot,
  notifyUser,
  saveSnapshot,
} from '@nonu/stores';
import { commandTooLong, runSvn, type SvnChange } from '@nonu/svn';

/** Commit-message generation runs at module level: the job keeps going when the panel unmounts. */
export interface GenLogEntry {
  kind: 'info' | 'success' | 'error';
  text: string;
  ts: number;
}

export interface GenJob {
  status: 'running' | 'done' | 'error';
  log: GenLogEntry[];
  /** True once a mounted panel has shown the outcome. */
  acked: boolean;
}

const jobs = new Map<string, GenJob>();
const listeners = new Set<() => void>();

export function getJob(cwd: string): GenJob | undefined {
  return jobs.get(cwd);
}

export function ackJob(cwd: string) {
  const job = jobs.get(cwd);
  if (job && job.status !== 'running') job.acked = true;
}

/** Subscribes a mounted panel. Returns the unsubscribe function. */
export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

const notify = () => listeners.forEach((fn) => fn());

function log(job: GenJob, kind: GenLogEntry['kind'], text: string) {
  job.log.push({ kind, text, ts: Date.now() });
  notify();
}

export function composeMessage(
  existing: string,
  generated: string,
  mode: SvnSettings['aiMessageMode'],
): string {
  return mode === 'append' && existing.trim()
    ? `${existing.trimEnd()}\n\n${generated}`
    : generated;
}

function buildPrompt(
  settings: SvnSettings,
  files: string,
  diff: string,
): string {
  const opts = [
    `language: ${settings.aiLanguage}`,
    `conventional: ${settings.aiConventional ? 'yes' : 'no'}`,
    `body: ${settings.aiBody ? 'yes' : 'no'}`,
  ].join(', ');
  return `Options: ${opts}\n\nFiles:\n${files}\n\nDiff:\n${diff}`;
}

export function startGeneration(
  cwd: string,
  changes: SvnChange[],
  settings: SvnSettings,
): boolean {
  if (jobs.get(cwd)?.status === 'running' || changes.length === 0) return false;
  const job: GenJob = { status: 'running', log: [], acked: false };
  jobs.set(cwd, job);
  log(job, 'info', (t('genStarted') as (n: number) => string)(changes.length));

  void (async () => {
    try {
      const paths = changes.map((c) => c.path);
      let diff: string;
      if (commandTooLong(paths)) {
        diff = '(too many files; diff omitted)';
      } else {
        try {
          diff = (await runSvn(['diff', ...paths], cwd)).stdout;
        } catch {
          diff = '(diff unavailable)';
        }
      }
      if (diff.length > settings.aiMaxDiffChars) {
        diff = diff.slice(0, settings.aiMaxDiffChars) + '\n… (diff truncated)';
      }
      const files = changes.map((c) => `${c.code} ${c.path}`).join('\n');
      const model = settings.aiModel || undefined;
      log(
        job,
        'info',
        (t('genDiffCollected') as (chars: number, model: string) => string)(
          diff.length,
          model ?? '',
        ),
      );

      const ai = getPanelHost()?.ai;
      if (!ai) throw new Error('AI service not available');
      const fullPrompt = `${settings.aiRules}\n\n---\n\n${buildPrompt(settings, files, diff)}`;
      const { response } = await ai.sendPrompt({
        prompt: fullPrompt,
        sessionName: 'SVN commit message',
        provider: settings.aiProvider,
        ...(model ? { model } : {}),
      });
      let cleaned = response.trim();
      // Remove markdown code fences
      cleaned = cleaned
        .replace(/^```[a-z]*\n/i, '')
        .replace(/\n```$/i, '')
        .trim();
      // Remove common preamble patterns
      cleaned = cleaned
        .replace(/^here'?s?\s+(?:the\s+)?(?:commit\s+)?message.*?:\s*/i, '')
        .replace(
          /^here'?s?\s+(?:the\s+)?(?:a\s+)?(?:commit\s+)?message.*?:\n*/i,
          '',
        )
        .replace(/^the\s+(?:commit\s+)?message.*?:\s*/i, '')
        .replace(/^my\s+(?:suggested\s+)?(?:commit\s+)?message.*?:\s*/i, '')
        .replace(/^\*\*commit message\*\*\n*/i, '')
        .replace(/^commit message:\n*/i, '')
        .replace(/^message:\n*/i, '')
        .trim();
      // Remove trailing explanation patterns
      cleaned = cleaned
        .replace(/\n+(?:this|it|the message|the commit)\s+.*$/is, '')
        .replace(/\n+(?:---+|===+).*$/s, '')
        .trim();
      if (!cleaned) throw new Error(t('genEmpty') as string);

      // Write into the snapshot so the message is there even if the panel is closed.
      const snap = loadSnapshot(cwd);
      if (snap)
        saveSnapshot(cwd, {
          ...snap,
          message: composeMessage(
            snap.message,
            cleaned,
            settings.aiMessageMode,
          ),
        });
      job.status = 'done';
      const watched = listeners.size > 0;
      log(
        job,
        'success',
        (t('genSuccess') as (msg: string) => string)(cleaned),
      );
      if (!watched) notifyUser('info', t('genNotifySuccess') as string);
    } catch (err) {
      job.status = 'error';
      const text = err instanceof Error ? err.message : String(err);
      const watched = listeners.size > 0;
      log(job, 'error', `✨ ${text}`);
      if (!watched)
        notifyUser(
          'error',
          (t('genNotifyFail') as (text: string) => string)(text),
        );
    }
  })();
  return true;
}
