import { type Locale, setLocale } from '@nonu/app/i18n';
import type { HostStorage } from '@nonu/host/types';

export const COMMIT_MESSAGE_RULES = `You are a commit message generator. Your ONLY job is to output the commit message text.

CRITICAL: Do not explain, do not preface, do not add any text before or after the message. Just the message.
CRITICAL: Do not use markdown code fences. Do not say "Here's" or "Here is" or anything like that.

Input: List of files with SVN status codes (M modified, A added, D deleted), then a unified diff.
Task: Write ONE commit message for these changes.

Style:
- First line: imperative, max 72 chars, no period. Use prefix if it fits: feat:, fix:, refactor:, docs:, chore:, test:, style:
- If substantial: add blank line + 2-5 bullet points (- ) explaining WHY, not file-by-file listing
- German if code/UI is German, else English
- Only mention added/deleted files when relevant

OUTPUT FORMAT: Just the message. Nothing else. No intro text.
`;

export interface FormatterRule {
  path: string;
  cmd: string;
  enabled: boolean;
}

export type DefaultSelection = 'all' | 'withNew' | 'modified' | 'none';

/** Whether a change is ticked when the file list first loads. */
export function isPreselected(
  change: { status: string; committable: boolean },
  mode: DefaultSelection,
): boolean {
  if (mode === 'none') return false;
  if (mode === 'withNew')
    return change.committable || change.status === 'unversioned';
  if (mode === 'modified') return change.status === 'modified';
  return change.committable;
}

export interface SvnSettings {
  aiProvider: 'claude-code' | 'claude' | 'openai';
  aiModel: string;
  aiLanguage: 'auto' | 'de' | 'en';
  aiConventional: boolean;
  aiBody: boolean;
  aiMaxDiffChars: number;
  aiMessageMode: 'replace' | 'append';
  autoOpenOutput: boolean;
  defaultSelection: DefaultSelection;
  /** Seconds between remote update checks; 0 = only when the panel opens. */
  updateCheckSeconds: number;
  /** Refresh the file list when files change on disk or the window regains focus. */
  autoRefresh: boolean;
  rememberView: boolean;
  /** Open the last working copy at startup instead of the start page. */
  openLastOnStart: boolean;
  /** Only one project exists: hide the global Projects entry in the nav rail. */
  singleProject: boolean;
  aiRules: string;
  uiLanguage: Locale;
  formatterRules: FormatterRule[];
}

export const DEFAULT_SETTINGS: SvnSettings = {
  aiProvider: 'claude-code',
  aiModel: 'claude-code:haiku',
  aiLanguage: 'auto',
  aiConventional: true,
  aiBody: true,
  aiMaxDiffChars: 60000,
  aiMessageMode: 'replace',
  autoOpenOutput: true,
  defaultSelection: 'all',
  rememberView: true,
  openLastOnStart: true,
  singleProject: false,
  updateCheckSeconds: 30,
  autoRefresh: true,
  aiRules: COMMIT_MESSAGE_RULES,
  uiLanguage: 'de',
  formatterRules: [],
};

const SETTINGS_KEY = 'svn.settings';

export function loadSettings(storage: HostStorage): SvnSettings {
  const raw =
    storage.getGlobal<Partial<SvnSettings> & { formatterCmd?: string }>(
      SETTINGS_KEY,
    ) ?? {};
  const merged: SvnSettings = { ...DEFAULT_SETTINGS, ...raw };
  if (
    !merged.formatterRules?.length &&
    (raw as { formatterCmd?: string }).formatterCmd
  ) {
    merged.formatterRules = [
      {
        path: '.',
        cmd: (raw as { formatterCmd: string }).formatterCmd,
        enabled: true,
      },
    ];
  }
  setLocale(merged.uiLanguage);
  return merged;
}

export function saveSettings(
  storage: HostStorage,
  settings: SvnSettings,
): Promise<void> {
  return storage.setGlobal(SETTINGS_KEY, settings);
}
