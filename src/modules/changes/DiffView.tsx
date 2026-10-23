import { t } from '@nonu/app/i18n';
import { Button, Splitter } from '@nonu/components';
import { useDiffSplit } from '@nonu/hooks/useDiffSplit';
import { highlightLine, languageForPath } from '@nonu/utils';
import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
} from 'react';
import { wrapRange } from './conflicts.js';
import { wordDiff } from './diffHunks.js';
import { nextChangeIndex } from './diffNavigation.js';
import {
  type DiffHeaders,
  DiffPairHead,
  DiffPaneHead,
} from './RevisionHeadline.js';

const isChangeCls = (cls?: string) =>
  cls === 'svn-diff-add' || cls === 'svn-diff-del';

/** Row indices shown on the old and new side of one display row; -1 leaves that side empty. */
type SplitUnit = [number, number];

export function pairSplitRows(rows: { cls: string }[]): SplitUnit[] {
  const out: SplitUnit[] = [];
  for (let i = 0; i < rows.length; ) {
    if (!isChangeCls(rows[i].cls)) {
      out.push([i, i]);
      i++;
      continue;
    }
    let dels = i;
    while (rows[dels]?.cls === 'svn-diff-del') dels++;
    let adds = dels;
    while (rows[adds]?.cls === 'svn-diff-add') adds++;
    for (let k = 0; k < Math.max(dels - i, adds - dels); k++)
      out.push([i + k < dels ? i + k : -1, dels + k < adds ? dels + k : -1]);
    i = adds;
  }
  return out;
}

type Mark = { range: [number, number]; cls: string };
type Row = {
  cls: string;
  o: string;
  n: string;
  sign: string;
  body: string;
  plain: boolean;
  marks?: Mark;
};

/** Shared chrome for editable and read-only diff editors. */
export function DiffHeader({
  path,
  children,
  readOnly = false,
  emptyLabel = '',
  rootName,
}: {
  path: string | null;
  children?: React.ReactNode;
  readOnly?: boolean;
  emptyLabel?: string;
  rootName?: string;
}) {
  return (
    <div className="svn-diff-head">
      <span className="svn-diff-head-text" title={path ?? undefined}>
        {path ? (
          <>
            {path === '.' ? (
              <span className="svn-crumb-name">{rootName ?? path}</span>
            ) : (
              <>
                <span className="svn-crumb-name">
                  {path.split(/[\\/]/).pop()}
                </span>
                <span className="svn-crumb-dir">
                  {path.replace(/[\\/]?[^\\/]*$/, '')}
                </span>
              </>
            )}
          </>
        ) : (
          emptyLabel
        )}
      </span>
      {children}
      {readOnly && (
        <span
          className="material-symbols-outlined svn-diff-readonly"
          title={t('diffReadOnly') as string}
          aria-label={t('diffReadOnly') as string}
        >
          lock
        </span>
      )}
    </div>
  );
}

/** Shared navigation and layout controls for all diff editors. */
export function DiffControls({
  mode,
  onModeChange,
  onJump,
  syncScroll = true,
  onSyncScrollChange,
  splitDisabled = false,
}: {
  mode: 'inline' | 'split';
  onModeChange: (mode: 'inline' | 'split') => void;
  onJump: (direction: 'prev' | 'next') => void;
  syncScroll?: boolean;
  onSyncScrollChange?: (enabled: boolean) => void;
  splitDisabled?: boolean;
}) {
  return (
    <>
      <div
        className="svn-mode-toggle"
        role="group"
        aria-label={t('diffNavigation') as string}
      >
        <Button
          variant="mode"
          title={t('prevChange') as string}
          aria-label={t('prevChange') as string}
          onClick={() => onJump('prev')}
        >
          <span className="material-symbols-outlined">arrow_upward</span>
        </Button>
        <Button
          variant="mode"
          title={t('nextChange') as string}
          aria-label={t('nextChange') as string}
          onClick={() => onJump('next')}
        >
          <span className="material-symbols-outlined">arrow_downward</span>
        </Button>
      </div>
      {mode === 'split' && onSyncScrollChange && (
        <Button
          variant="mode"
          active={syncScroll}
          aria-pressed={syncScroll}
          title={t('syncDiffScroll') as string}
          aria-label={t('syncDiffScroll') as string}
          onClick={() => onSyncScrollChange(!syncScroll)}
        >
          <span className="material-symbols-outlined">sync_alt</span>
        </Button>
      )}
      <div
        className="svn-mode-toggle"
        role="group"
        aria-label={t('diffViewMode') as string}
      >
        <Button
          variant="mode"
          active={mode === 'inline'}
          aria-pressed={mode === 'inline'}
          title={t('inlineDiff') as string}
          aria-label={t('inlineDiff') as string}
          onClick={() => onModeChange('inline')}
        >
          <span className="material-symbols-outlined">view_agenda</span>
        </Button>
        <Button
          variant="mode"
          active={mode === 'split'}
          aria-pressed={mode === 'split'}
          disabled={splitDisabled}
          title={t('splitDiff') as string}
          aria-label={t('splitDiff') as string}
          onClick={() => onModeChange('split')}
        >
          <span className="material-symbols-outlined">vertical_split</span>
        </Button>
      </div>
    </>
  );
}

/** Renders a unified diff with old/new line numbers and syntax highlighting. */
export type DiffViewHandle = { jump: (direction: 'prev' | 'next') => boolean };
export const DiffView = forwardRef<
  DiffViewHandle,
  {
    text: string;
    path: string | null;
    mode?: 'inline' | 'split';
    hideHunks?: boolean;
    hideMetadata?: boolean;
    headers?: DiffHeaders;
    syncScroll?: boolean;
  }
>(function DiffView(
  {
    text,
    path,
    mode = 'inline',
    hideHunks = false,
    hideMetadata = false,
    headers,
    syncScroll = true,
  },
  ref,
) {
  const split = useDiffSplit();
  const navigationIndex = useRef<number | null>(null);
  useEffect(() => {
    navigationIndex.current = null;
  }, [text, path]);
  const lang = languageForPath(path);
  const host = useRef<HTMLDivElement>(null);
  const lastScrolledPane = useRef<'old' | 'new'>('new');
  const previousSyncScroll = useRef(syncScroll);
  const rows = useMemo(() => {
    let oldN = 0;
    let newN = 0;
    let inHunk = false;
    const rows: Row[] = text.split('\n').flatMap((line): Row | Row[] => {
      const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)/.exec(line);
      if (hunk) {
        oldN = parseInt(hunk[1], 10);
        newN = parseInt(hunk[2], 10);
        inHunk = true;
        return hideHunks
          ? []
          : [
              {
                cls: 'svn-diff-hunk',
                o: '',
                n: '',
                sign: '',
                body: line,
                plain: true,
              },
            ];
      }
      if (!inHunk || line.startsWith('\\')) {
        const isSvnMetadata = /^(Index:|=+$|--- |\+\+\+ )/.test(line.trimEnd());
        return hideMetadata && !inHunk && isSvnMetadata
          ? []
          : [
              {
                cls: 'svn-diff-meta',
                o: '',
                n: '',
                sign: '',
                body: line,
                plain: true,
              },
            ];
      }
      if (line.startsWith('+')) {
        return {
          cls: 'svn-diff-add',
          o: '',
          n: String(newN++),
          sign: '+',
          body: line.slice(1),
          plain: false,
        };
      }
      if (line.startsWith('-')) {
        return {
          cls: 'svn-diff-del',
          o: String(oldN++),
          n: '',
          sign: '-',
          body: line.slice(1),
          plain: false,
        };
      }
      return {
        cls: '',
        o: String(oldN++),
        n: String(newN++),
        sign: '',
        body: line.slice(1),
        plain: false,
      };
    });
    for (let i = 0; i < rows.length; ) {
      if (rows[i].cls !== 'svn-diff-del') {
        i++;
        continue;
      }
      let dels = i;
      while (rows[dels]?.cls === 'svn-diff-del') dels++;
      let adds = dels;
      while (rows[adds]?.cls === 'svn-diff-add') adds++;
      for (let p = 0; p < Math.min(dels - i, adds - dels); p++) {
        const w = wordDiff(rows[i + p].body, rows[dels + p].body);
        if (!w) continue;
        rows[i + p].marks = { range: w.a, cls: 'svn-diff-word-del' };
        rows[dels + p].marks = { range: w.b, cls: 'svn-diff-word-add' };
      }
      i = adds;
    }
    return rows;
  }, [text, hideHunks, hideMetadata]);
  // Split view pairs each deleted line with its added counterpart so both panes share row heights.
  const units = useMemo(
    () =>
      mode === 'split'
        ? pairSplitRows(rows)
        : rows.map((_, i): SplitUnit => [i, i]),
    [rows, mode],
  );
  const jump = useCallback(
    (direction: 'prev' | 'next') => {
      const root = host.current;
      if (!root) return false;
      const isChangeUnit = (unit: SplitUnit | undefined) =>
        !!unit &&
        ((unit[0] >= 0 && isChangeCls(rows[unit[0]].cls)) ||
          (unit[1] >= 0 && isChangeCls(rows[unit[1]].cls)));
      const starts = units.flatMap((unit, index) =>
        isChangeUnit(unit) && !isChangeUnit(units[index - 1]) ? [index] : [],
      );
      const index = nextChangeIndex(
        navigationIndex.current,
        starts.length,
        direction,
      );
      if (index === null) return false;
      navigationIndex.current = index;
      root
        .querySelectorAll('.svn-change-focus')
        .forEach((el) => el.classList.remove('svn-change-focus'));
      const panes =
        mode === 'split'
          ? Array.from(root.querySelectorAll<HTMLElement>('.svn-split-pane'))
          : [root];
      for (const pane of panes) {
        const target =
          pane.querySelectorAll<HTMLElement>('.svn-line')[starts[index]];
        if (!target) continue;
        pane.scrollTop +=
          target.getBoundingClientRect().top -
          pane.getBoundingClientRect().top -
          pane.clientHeight / 2 +
          target.offsetHeight / 2;
        for (
          let unit = starts[index];
          unit < units.length && isChangeUnit(units[unit]);
          unit++
        ) {
          pane
            .querySelectorAll<HTMLElement>('.svn-line')
            [unit]?.classList.add('svn-change-focus');
        }
      }
      return true;
    },
    [rows, units, mode],
  );
  useImperativeHandle(ref, () => ({ jump }), [jump]);
  useEffect(() => {
    const wasSyncing = previousSyncScroll.current;
    previousSyncScroll.current = syncScroll;
    if (mode !== 'split' || !syncScroll || wasSyncing) return;
    const panes =
      host.current?.querySelectorAll<HTMLElement>('.svn-split-pane');
    if (!panes || panes.length !== 2) return;
    const source = lastScrolledPane.current === 'old' ? panes[0] : panes[1];
    const target = source === panes[0] ? panes[1] : panes[0];
    target.scrollTop = source.scrollTop;
    target.scrollLeft = source.scrollLeft;
  }, [mode, syncScroll]);
  const handleSyncScroll = (
    event: React.UIEvent<HTMLDivElement>,
    side: 'old' | 'new',
  ) => {
    lastScrolledPane.current = side;
    if (!syncScroll) return;
    const pane = event.currentTarget;
    const other = Array.from(
      host.current?.querySelectorAll<HTMLElement>('.svn-split-pane') ?? [],
    ).find((item) => item !== pane);
    if (other && other.scrollTop !== pane.scrollTop)
      other.scrollTop = pane.scrollTop;
    if (other && other.scrollLeft !== pane.scrollLeft)
      other.scrollLeft = pane.scrollLeft;
  };
  if (!text) {
    return <div className="svn-diff-body" />;
  }
  const emptySide = (u: number) => (
    <div key={`e${u}`} className="svn-line svn-split-empty">
      &nbsp;
    </div>
  );
  const line = (r: (typeof rows)[number], i: number, side?: 'old' | 'new') => {
    const lineNumbers =
      side === 'old' ? (
        <span className="svn-ln">{r.o}</span>
      ) : side === 'new' ? (
        <span className="svn-ln">{r.n}</span>
      ) : (
        <>
          <span className="svn-ln">{r.o}</span>
          <span className="svn-ln">{r.n}</span>
        </>
      );
    return (
      <div
        key={i}
        className={`svn-line ${r.cls}${isChangeCls(r.cls) && !isChangeCls(rows[i - 1]?.cls) ? ' svn-change-start' : ''}${isChangeCls(r.cls) && !isChangeCls(rows[i + 1]?.cls) ? ' svn-change-end' : ''}`}
      >
        {lineNumbers}
        <span className="svn-sign">{r.sign}</span>
        {r.plain ? (
          <span className="svn-code-text">{r.body || ' '}</span>
        ) : (
          <Code line={r.body} lang={lang} marks={r.marks} />
        )}
      </div>
    );
  };
  return (
    <div
      ref={host}
      style={split.style}
      className={`svn-diff-body${mode === 'split' ? ' svn-diff-body--split svn-diff-resizable' : ''}`}
      tabIndex={0}
      onKeyDown={(event) => {
        if ((event.ctrlKey || event.metaKey) && event.key === 'ArrowUp') {
          event.preventDefault();
          event.stopPropagation();
          jump('prev');
        }
        if ((event.ctrlKey || event.metaKey) && event.key === 'ArrowDown') {
          event.preventDefault();
          jump('next');
        }
      }}
    >
      {mode === 'split' ? (
        <>
          <div
            className="svn-split-pane"
            onScroll={(event) => handleSyncScroll(event, 'old')}
          >
            {headers?.old && <DiffPaneHead info={headers.old} />}
            {units.map(([l], u) =>
              l >= 0 ? line(rows[l], l, 'old') : emptySide(u),
            )}
          </div>
          <Splitter direction="h" onMouseDown={split.onMouseDown} />
          <div
            className="svn-split-pane"
            onScroll={(event) => handleSyncScroll(event, 'new')}
          >
            {headers && <DiffPaneHead info={headers.new} />}
            {units.map(([, r], u) =>
              r >= 0 ? line(rows[r], r, 'new') : emptySide(u),
            )}
          </div>
        </>
      ) : (
        <>
          {headers && <DiffPairHead headers={headers} />}
          {rows.map((r, i) => line(r, i))}
        </>
      )}
    </div>
  );
});

function Code({
  line,
  lang,
  marks,
}: {
  line: string;
  lang: string | null;
  marks?: Mark;
}) {
  const html = useMemo(() => {
    const el = document.createElement('span');
    el.innerHTML = highlightLine(line, lang) || ' ';
    if (marks) wrapRange(el, marks.range[0], marks.range[1], marks.cls);
    return el.innerHTML;
  }, [line, lang, marks]);
  return (
    <span
      className="svn-code-text"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
