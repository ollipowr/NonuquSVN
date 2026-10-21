import { t } from '@nonu/app/i18n';
import { ContextMenu, type ContextMenuItem, Splitter } from '@nonu/components';
import { useDiffSplit } from '@nonu/hooks/useDiffSplit';
import React, {
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { nextChangeIndex } from './diffNavigation.js';
import './DiffEditor.css';
import {
  defaultKeymap,
  history,
  historyKeymap,
  insertTab,
} from '@codemirror/commands';
import {
  EditorState,
  type Extension,
  type Range,
  RangeSetBuilder,
  StateEffect,
  StateField,
} from '@codemirror/state';
import {
  Decoration,
  type DecorationSet,
  EditorView,
  GutterMarker,
  gutter,
  keymap,
  lineNumberMarkers,
  lineNumbers,
  lineNumberWidgetMarker,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from '@codemirror/view';
import {
  type DecodedFile,
  readEditableFile,
  readFileDecoded,
  writeFileEncoded,
} from '@nonu/stores';
import { highlightLine, languageForPath } from '@nonu/utils';
import {
  conflictExtension,
  conflictPositions,
  hasConflictMarkers,
} from './conflicts.js';

import { computeHunks, type Hunk, splitLines } from './diffHunks.js';

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  '#x27': "'",
  '#39': "'",
};

function hljsRanges(html: string): { from: number; to: number; cls: string }[] {
  const out: { from: number; to: number; cls: string }[] = [];
  const stack: { from: number; cls: string }[] = [];
  let pos = 0;
  const re =
    /<span class="([^"]*)">|<\/span>|&(amp|lt|gt|quot|#x27|#39);|[^<&]+|[<&]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    if (m[1] !== undefined) stack.push({ from: pos, cls: m[1] });
    else if (m[0] === '</span>') {
      const s = stack.pop();
      if (s && pos > s.from) out.push({ from: s.from, to: pos, cls: s.cls });
    } else if (m[2] !== undefined) pos += 1;
    else pos += m[0].length;
  }
  return out;
}

function highlightPlugin(lang: string | null): Extension {
  if (!lang) return [];
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = this.build(view);
      }
      update(u: ViewUpdate) {
        if (u.docChanged || u.viewportChanged)
          this.decorations = this.build(u.view);
      }
      build(view: EditorView): DecorationSet {
        const b = new RangeSetBuilder<Decoration>();
        for (const { from, to } of view.visibleRanges) {
          let pos = from;
          while (pos <= to) {
            const line = view.state.doc.lineAt(pos);
            if (line.length > 0 && line.length < 2000) {
              const ranges = hljsRanges(highlightLine(line.text, lang)).sort(
                (x, y) => x.from - y.from || y.to - x.to,
              );
              for (const r of ranges)
                b.add(
                  line.from + r.from,
                  line.from + r.to,
                  Decoration.mark({ class: r.cls }),
                );
            }
            pos = line.to + 1;
          }
        }
        return b.finish();
      }
    },
    { decorations: (v) => v.decorations },
  );
}

type Mode = 'inline' | 'split-right' | 'split-left';

class RowWidget extends WidgetType {
  constructor(
    readonly kind: 'del' | 'spacer',
    readonly text: string,
    readonly oldNo: number | null,
    readonly cls: string,
    readonly lang: string | null,
    readonly hunkIndex: number,
  ) {
    super();
  }
  eq(o: RowWidget) {
    return (
      o.kind === this.kind &&
      o.text === this.text &&
      o.cls === this.cls &&
      o.oldNo === this.oldNo &&
      o.hunkIndex === this.hunkIndex
    );
  }
  toDOM() {
    const el = document.createElement('div');
    el.className = `svn-cm-row ${this.kind === 'del' ? 'svn-diff-del' : 'svn-split-empty'} ${this.cls}`;
    el.dataset.diffHunk = String(this.hunkIndex);
    if (this.kind === 'del')
      el.innerHTML = highlightLine(this.text, this.lang) || ' ';
    return el;
  }
  ignoreEvent() {
    return true;
  }
}

class NumMarker extends GutterMarker {
  constructor(
    readonly label: string,
    readonly cls: string,
  ) {
    super();
    this.elementClass = cls;
  }
  eq(o: NumMarker) {
    return o.label === this.label && o.cls === this.cls;
  }
  toDOM() {
    return document.createTextNode(this.label);
  }
}

const setHunks = StateEffect.define<Hunk[]>();
const setFocus = StateEffect.define<number | null>();
const expandFold = StateEffect.define<number>();

const CONTEXT = 3;

/** Placeholder for a run of unchanged lines hidden in inline mode; click to expand. */
class FoldWidget extends WidgetType {
  constructor(
    readonly count: number,
    readonly from: number,
  ) {
    super();
  }
  eq(o: FoldWidget) {
    return o.count === this.count && o.from === this.from;
  }
  toDOM(view: EditorView) {
    const el = document.createElement('div');
    el.className = 'svn-cm-fold';
    el.textContent = t('foldUnchanged')(this.count);
    el.title = t('foldExpand');
    el.addEventListener('mousedown', (e) => {
      e.preventDefault();
      view.dispatch({ effects: expandFold.of(this.from) });
    });
    return el;
  }
  ignoreEvent() {
    return true;
  }
}

interface DiffState {
  hunks: Hunk[];
  focus: number | null;
  deco: DecorationSet;
  expanded: number[]; // fold start offsets the user opened
  lineCls: Map<number, string>; // doc line number -> change class (for gutters)
}

function buildState(
  doc: EditorState['doc'],
  hunks: Hunk[],
  focus: number | null,
  mode: Mode,
  oldL: string[],
  lang: string | null,
  expanded: number[],
): DiffState {
  const ranges: Range<Decoration>[] = [];
  const lineCls = new Map<number, string>();
  const lineStart = (idx: number) =>
    idx < doc.lines
      ? { pos: doc.line(idx + 1).from, side: -1 }
      : { pos: doc.length, side: 1 };
  hunks.forEach((h, hi) => {
    const f = focus === hi ? ' svn-change-focus' : '';
    // Rows in visual order, each tagged so first/last get the frame edges.
    type Row = {
      line?: number;
      widget?: RowWidget;
      at?: { pos: number; side: number };
    };
    const rows: Row[] = [];
    const widget = (kind: 'del' | 'spacer', oi: number) =>
      new RowWidget(
        kind,
        kind === 'del' ? (oldL[oi] ?? '') : '',
        kind === 'del' ? oi + 1 : null,
        '',
        lang,
        hi,
      );
    if (mode === 'inline') {
      for (let k = 0; k < h.del; k++)
        rows.push({ widget: widget('del', h.o + k), at: lineStart(h.n) });
      for (let k = 0; k < h.add; k++) rows.push({ line: h.n + k + 1 });
    } else if (mode === 'split-right') {
      for (let k = 0; k < h.add; k++) rows.push({ line: h.n + k + 1 });
      for (let k = 0; k < Math.max(0, h.del - h.add); k++)
        rows.push({ widget: widget('spacer', 0), at: lineStart(h.n + h.add) });
    } else {
      for (let k = 0; k < h.del; k++) rows.push({ line: h.o + k + 1 });
      for (let k = 0; k < Math.max(0, h.add - h.del); k++)
        rows.push({ widget: widget('spacer', 0), at: lineStart(h.o + h.del) });
    }
    const lineKind = mode === 'split-left' ? 'svn-diff-del' : 'svn-diff-add';
    rows.forEach((r, ri) => {
      const edge = `${ri === 0 ? ' svn-change-start' : ''}${ri === rows.length - 1 ? ' svn-change-end' : ''}${f}`;
      if (r.line !== undefined) {
        if (r.line > doc.lines) return;
        const cls = `${lineKind}${edge}`;
        lineCls.set(r.line, lineKind);
        ranges.push(
          Decoration.line({
            class: cls,
            attributes: { 'data-diff-hunk': String(hi) },
          }).range(doc.line(r.line).from),
        );
      } else if (r.widget && r.at) {
        const w = new RowWidget(
          r.widget.kind,
          r.widget.text,
          r.widget.oldNo,
          edge,
          lang,
          r.widget.hunkIndex,
        );
        ranges.push(
          Decoration.widget({ widget: w, block: true, side: r.at.side }).range(
            r.at.pos,
          ),
        );
      }
    });
  });
  if (mode === 'inline' && hunks.length > 0) {
    // Hide long runs of unchanged lines, keeping CONTEXT lines around each change.
    const keep = new Uint8Array(doc.lines + 1);
    for (const h of hunks) {
      for (
        let i = Math.max(0, h.n - CONTEXT);
        i < Math.min(doc.lines, h.n + h.add + CONTEXT);
        i++
      )
        keep[i] = 1;
    }
    let i = 0;
    while (i < doc.lines) {
      if (keep[i]) {
        i++;
        continue;
      }
      let j = i;
      while (j < doc.lines && !keep[j]) j++;
      if (j - i >= 2) {
        const from = doc.line(i + 1).from;
        if (!expanded.includes(from)) {
          ranges.push(
            Decoration.replace({
              widget: new FoldWidget(j - i, from),
              block: true,
            }).range(from, doc.line(j).to),
          );
        }
      }
      i = j;
    }
  }
  return {
    hunks,
    focus,
    expanded,
    deco: Decoration.set(ranges, true),
    lineCls,
  };
}

function diffField(
  mode: Mode,
  oldL: string[],
  lang: string | null,
  initial: Hunk[],
) {
  return StateField.define<DiffState>({
    create: (state) =>
      buildState(state.doc, initial, null, mode, oldL, lang, []),
    update(value, tr) {
      let hunks = value.hunks;
      let focus = value.focus;
      let expanded = value.expanded;
      let rebuild = false;
      for (const e of tr.effects) {
        if (e.is(setHunks)) {
          hunks = e.value;
          rebuild = true;
        } else if (e.is(expandFold)) {
          expanded = [...expanded, e.value];
          rebuild = true;
        } else if (e.is(setFocus)) {
          focus = e.value;
          rebuild = true;
        }
      }
      if (tr.docChanged) expanded = expanded.map((x) => tr.changes.mapPos(x));
      if (rebuild)
        return buildState(
          tr.state.doc,
          hunks,
          focus,
          mode,
          oldL,
          lang,
          expanded,
        );
      if (tr.docChanged)
        return { ...value, expanded, deco: value.deco.map(tr.changes) };
      return value;
    },
    provide: (f) => [
      EditorView.decorations.from(f, (v) => v.deco),
      EditorView.atomicRanges.of((view) => view.state.field(f).deco),
    ],
  });
}

const theme = EditorView.theme({
  '&': {
    height: '100%',
    backgroundColor: 'var(--nonu-bg)',
    color: 'var(--nonu-text)',
    fontSize: 'var(--nonu-text-md)',
    fontVariantLigatures: 'none',
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': {
    fontFamily: 'var(--nonu-font-mono, monospace)',
    lineHeight: '18px',
  },
  // Disable ligatures: programming fonts would merge `===` into one glyph.
  '.cm-content': { padding: '4px 0', caretColor: 'var(--nonu-text)' },
  '.cm-line': { padding: '0 12px 0 6px', height: '18px' },
  '.cm-cursor': { borderLeftColor: 'var(--nonu-text)' },
  '.cm-selectionBackground, &.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground':
    {
      background: 'color-mix(in srgb, var(--nonu-primary) 30%, transparent)',
    },
  // Opaque, so code scrolled horizontally passes under the gutter instead of through it.
  '.cm-gutters': {
    backgroundColor: 'var(--nonu-bg)',
    border: 'none',
    color: 'var(--nonu-text-faint)',
  },
  '.cm-gutterElement': {
    padding: '0 8px 0 4px',
    textAlign: 'right',
    boxSizing: 'border-box',
  },
  '.svn-cm-row': {
    height: '18px',
    padding: '0 12px 0 6px',
    whiteSpace: 'pre',
    width: 'max-content',
    minWidth: '100%',
    boxSizing: 'border-box',
  },
});

interface PaneProps {
  doc: string;
  mode: Mode;
  lang: string | null;
  oldL: string[];
  hunks: Hunk[];
  focus: number | null;
  readOnly?: boolean;
  conflict?: boolean;
  onDoc?: (text: string) => void;
  onSave?: () => void;
  onJump?: (dir: 'prev' | 'next') => boolean;
  onContextMenu?: (
    event: React.MouseEvent<HTMLDivElement>,
    view: EditorView,
  ) => void;
  onView: (view: EditorView | null) => void;
}

function DiffPane({
  doc,
  mode,
  lang,
  oldL,
  hunks,
  focus,
  readOnly,
  conflict,
  onDoc,
  onSave,
  onJump,
  onContextMenu,
  onView,
}: PaneProps) {
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const cb = useRef({ onDoc, onSave, onJump });
  cb.current = { onDoc, onSave, onJump };
  const initial = useRef({ hunks, focus });

  useEffect(() => {
    const field = diffField(mode, oldL, lang, initial.current.hunks);
    // lineNumberMarkers replaces the default label — pass the actual line number from the doc.
    const markerForLine = (
      doc: EditorState['doc'],
      lineNo: number,
      cls: string | undefined,
    ) => (cls ? new NumMarker(String(lineNo), cls) : null);
    const markerFor = (cls: string | undefined) =>
      cls ? new NumMarker('', cls) : null;
    const extensions: Extension[] = conflict
      ? [
          theme,
          highlightPlugin(lang),
          conflictExtension({ split: mode === 'split-right', lang }),
        ]
      : [
          theme,
          field,
          highlightPlugin(lang),
          lineNumbers(),
          lineNumberMarkers.compute([field], (s) => {
            const b = new RangeSetBuilder<GutterMarker>();
            const { lineCls } = s.field(field);
            const doc = s.doc;
            [...lineCls.keys()]
              .sort((x, y) => x - y)
              .forEach((n) => {
                if (n <= doc.lines)
                  b.add(
                    doc.line(n).from,
                    doc.line(n).from,
                    markerForLine(doc, n, lineCls.get(n))!,
                  );
              });
            return b.finish();
          }),
          lineNumberWidgetMarker.of((_v, w) =>
            w instanceof RowWidget && w.kind === 'del'
              ? new NumMarker(
                  w.oldNo !== null ? String(w.oldNo) : '',
                  'svn-diff-del',
                )
              : w instanceof RowWidget
                ? markerFor('svn-split-empty')
                : null,
          ),
        ];
    if (mode === 'inline' && !conflict) {
      // +/- sign column right of the (new) line numbers.
      extensions.push(
        gutter({
          class: 'svn-cm-sign',
          lineMarker: (v, line) => {
            const idx = v.state.doc.lineAt(line.from).number - 1;
            return v.state
              .field(field)
              .hunks.some((x) => idx >= x.n && idx < x.n + x.add)
              ? new NumMarker('+', 'svn-diff-add')
              : null;
          },
          widgetMarker: (_v, w) =>
            w instanceof RowWidget && w.kind === 'del'
              ? new NumMarker('-', 'svn-diff-del')
              : null,
          lineMarkerChange: (u) =>
            u.docChanged ||
            u.transactions.some((t) => t.effects.some((e) => e.is(setHunks))),
          initialSpacer: () => new NumMarker('+', ''),
        }),
      );
    }
    extensions.push(
      keymap.of([
        { key: 'Mod-ArrowUp', run: () => cb.current.onJump?.('prev') ?? false },
        {
          key: 'Mod-ArrowDown',
          run: () => cb.current.onJump?.('next') ?? false,
        },
      ]),
    );
    if (readOnly) {
      extensions.push(
        EditorState.readOnly.of(true),
        EditorView.editable.of(false),
      );
    } else {
      extensions.push(
        history(),
        keymap.of([
          {
            key: 'Mod-s',
            run: () => (cb.current.onSave?.(), true),
            preventDefault: true,
          },
          {
            key: 'Mod-ArrowUp',
            run: () => cb.current.onJump?.('prev') ?? false,
          },
          {
            key: 'Mod-ArrowDown',
            run: () => cb.current.onJump?.('next') ?? false,
          },
          { key: 'Tab', run: insertTab },
          ...defaultKeymap,
          ...historyKeymap,
        ]),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) cb.current.onDoc?.(u.state.doc.toString());
        }),
      );
    }
    const view = new EditorView({
      parent: host.current!,
      state: EditorState.create({ doc, extensions }),
    });
    viewRef.current = view;
    view.dispatch({ effects: setFocus.of(initial.current.focus) });
    onView(view);
    return () => {
      onView(null);
      view.destroy();
      viewRef.current = null;
    };
    // The editor is rebuilt when its identity-defining inputs change (file reload / language / mode).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, mode, lang, oldL, readOnly, conflict]);

  useEffect(() => {
    viewRef.current?.dispatch({ effects: setHunks.of(hunks) });
  }, [hunks]);
  useEffect(() => {
    viewRef.current?.dispatch({ effects: setFocus.of(focus) });
  }, [focus]);

  return (
    <div
      className="svn-cm-host"
      ref={host}
      onContextMenu={(event) => {
        if (viewRef.current) onContextMenu?.(event, viewRef.current);
      }}
    />
  );
}

export interface EditableDiffHandle {
  /** Centers the previous/next change block; returns false when there is none. */
  jump(dir: 'prev' | 'next'): boolean;
  /** Resolves false when the save failed (error is shown in the editor). */
  save(force?: boolean): Promise<boolean>;
  revert(): void;
  /** Writes the editor text to disk, runs `format`, and reloads the result without marking the file saved. */
  formatInPlace(format: (path: string) => Promise<void>): Promise<void>;
}

export interface EditableDiffState {
  dirty: boolean;
  saving: boolean;
  error: string | null;
  externalChanged: boolean;
}

interface Props {
  path: string;
  cwd: string;
  /** Last-write timestamp used to reuse content until the working copy changes. */
  cacheVersion: number;
  mode: 'inline' | 'split';
  /** Unversioned files have no BASE; skip fetching it. */
  unversioned?: boolean;
  syncScroll?: boolean;
  onStateChange: (s: EditableDiffState) => void;
  onSaved: () => void;
}

export const EditableDiff = React.forwardRef<EditableDiffHandle, Props>(
  function EditableDiff(
    {
      path,
      cwd,
      cacheVersion,
      mode,
      unversioned,
      syncScroll = true,
      onStateChange,
      onSaved,
    },
    ref,
  ) {
    const lang = languageForPath(path);
    const [files, setFiles] = useState<{
      base: string;
      work: string;
      crlf: boolean;
      enc: DecodedFile;
    } | null>(null);
    const [text, setText] = useState('');
    const [hunks, setHunks_] = useState<Hunk[]>([]);
    const split = useDiffSplit();
    const navigationIndex = useRef<number | null>(null);
    useEffect(() => {
      navigationIndex.current = null;
    }, [hunks, text]);
    const [focus, setFocus_] = useState<number | null>(null);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [externalChanged, setExternalChanged] = useState(false);
    const [menu, setMenu] = useState<{
      x: number;
      y: number;
      hunk: Hunk;
      side: 'base' | 'working';
    }>();
    const savedRef = useRef('');
    const textRef = useRef('');
    const mainView = useRef<EditorView | null>(null);
    const leftView = useRef<EditorView | null>(null);
    const lastScrolledPane = useRef<'left' | 'main'>('main');
    const previousSyncScroll = useRef(syncScroll);
    const debounce = useRef<number | undefined>(undefined);
    const formattingRef = useRef(false);
    const externalChangedRef = useRef(false);
    const externalFileRef = useRef<{
      base: string;
      work: string;
      crlf: boolean;
      enc: DecodedFile;
    } | null>(null);

    const dirty = files !== null && text !== savedRef.current;
    const dirtyRef = useRef(false);
    dirtyRef.current = dirty;
    externalChangedRef.current = externalChanged;

    useEffect(
      () => onStateChange({ dirty, saving, error, externalChanged }),
      [dirty, saving, error, externalChanged, onStateChange],
    );
    useEffect(
      () => () =>
        onStateChange({
          dirty: false,
          saving: false,
          error: null,
          externalChanged: false,
        }),
      [onStateChange],
    );

    // Clean editors reload automatically; dirty ones keep their buffer and need an explicit reload.
    useEffect(() => {
      if (formattingRef.current) return;
      let cancelled = false;
      (async () => {
        const loaded = await readEditableFile(
          path,
          cwd,
          String(cacheVersion),
          unversioned,
        );
        if (cancelled) return;
        const base = loaded.base.text;
        const workRaw = loaded.work;
        const crlf = workRaw.text.includes('\r\n');
        const work = workRaw.text.replace(/\r\n/g, '\n');
        const baseN = base.replace(/\r\n/g, '\n');
        const nextFile = { base: baseN, work, crlf, enc: workRaw };
        if (dirtyRef.current) {
          if (work !== savedRef.current) {
            externalFileRef.current = nextFile;
            setExternalChanged(true);
          } else {
            externalFileRef.current = null;
            setExternalChanged(false);
          }
          return;
        }
        externalFileRef.current = null;
        setExternalChanged(false);
        // Echo of our own save: keep editors, cursor and undo history.
        const lastSaved = savedRef.current;
        setFiles((prev) =>
          prev &&
          prev.base === baseN &&
          (prev.work === work || work === lastSaved)
            ? prev
            : nextFile,
        );
        savedRef.current = work;
        textRef.current = work;
        setText(work);
      })();
      return () => {
        cancelled = true;
      };
    }, [path, cwd, cacheVersion, unversioned]);

    const oldL = useMemo(() => (files ? splitLines(files.base) : []), [files]);

    useEffect(() => {
      if (!files) return;
      setHunks_(computeHunks(oldL, splitLines(files.work)));
      setFocus_(null);
    }, [files, oldL]);

    const onDoc = useCallback(
      (t: string) => {
        textRef.current = t;
        setText(t);
        window.clearTimeout(debounce.current);
        debounce.current = window.setTimeout(
          () => setHunks_(computeHunks(oldL, splitLines(t))),
          150,
        );
      },
      [oldL],
    );
    useEffect(() => () => window.clearTimeout(debounce.current), []);

    const hunkPos = (v: EditorView, h: Hunk) => {
      const d = v.state.doc;
      return h.n < d.lines ? d.line(h.n + 1).from : d.length;
    };

    const jump = useCallback(
      (dir: 'prev' | 'next') => {
        const v = mainView.current;
        if (!v) return false;
        const conflicts = conflictPositions(v.state);
        const positions = conflicts ?? hunks.map((h) => hunkPos(v, h));
        if (positions.length === 0) return false;
        const idx = nextChangeIndex(
          navigationIndex.current,
          positions.length,
          dir,
        );
        if (idx === null) return false;
        navigationIndex.current = idx;
        if (!conflicts) setFocus_(idx);
        v.dispatch({
          effects: EditorView.scrollIntoView(positions[idx], { y: 'center' }),
        });
        return true;
      },
      [hunks],
    );

    const save = useCallback(
      async (force = false) => {
        if (!files || textRef.current === savedRef.current) return true;
        if (externalChangedRef.current && !force) {
          setError(t('externalFileChanged') as string);
          return false;
        }
        setSaving(true);
        setError(null);
        try {
          const t = textRef.current;
          await writeFileEncoded(
            path,
            cwd,
            files.crlf ? t.replace(/\n/g, '\r\n') : t,
            files.enc,
          );
          savedRef.current = t;
          externalFileRef.current = null;
          setExternalChanged(false);
          setText(t);
          setSaving(false);
          onSaved();
          return true;
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err));
          setSaving(false);
          return false;
        }
      },
      [files, path, cwd, onSaved],
    );

    const reloadFromDisk = useCallback(() => {
      const v = mainView.current;
      const external = externalFileRef.current;
      if (!v || !external) return false;
      setFiles(external);
      savedRef.current = external.work;
      textRef.current = external.work;
      setText(external.work);
      v.dispatch({
        changes: { from: 0, to: v.state.doc.length, insert: external.work },
      });
      externalFileRef.current = null;
      setExternalChanged(false);
      setError(null);
      onSaved();
      return true;
    }, [onSaved]);

    const revert = useCallback(() => {
      if (reloadFromDisk()) return;
      const v = mainView.current;
      if (!v) return;
      v.dispatch({
        changes: { from: 0, to: v.state.doc.length, insert: savedRef.current },
      });
      setError(null);
    }, [reloadFromDisk]);

    const useBaseBlock = useCallback(
      (hunk: Hunk) => {
        const view = mainView.current;
        if (!view) return;
        const panes = [leftView.current?.scrollDOM, view.scrollDOM].filter(
          (pane): pane is HTMLElement => Boolean(pane),
        );
        const scrollPositions = panes.map((pane) => ({
          pane,
          top: pane.scrollTop,
          left: pane.scrollLeft,
        }));
        const current = view.state.doc.toString();
        const next = splitLines(current);
        next.splice(hunk.n, hunk.add, ...oldL.slice(hunk.o, hunk.o + hunk.del));
        const replacement = `${next.join('\n')}${next.length > 0 && current.endsWith('\n') ? '\n' : ''}`;
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: replacement },
        });
        const restoreScroll = () => {
          for (const { pane, top, left } of scrollPositions) {
            pane.scrollTop = top;
            pane.scrollLeft = left;
          }
        };
        view.contentDOM.focus({ preventScroll: true });
        restoreScroll();
        window.requestAnimationFrame(restoreScroll);
      },
      [oldL],
    );

    const openHunkMenu = useCallback(
      (event: React.MouseEvent<HTMLDivElement>, side: 'base' | 'working') => {
        if (mode !== 'split') return;
        const target = event.target as Element;
        const row = target.closest<HTMLElement>('[data-diff-hunk]');
        const hunkIndex = Number(row?.dataset.diffHunk);
        const hunk = Number.isInteger(hunkIndex) ? hunks[hunkIndex] : undefined;
        if (!hunk) return;
        event.preventDefault();
        setFocus_(hunkIndex);
        setMenu({ x: event.clientX, y: event.clientY, hunk, side });
      },
      [hunks, mode],
    );

    const formatInPlace = useCallback(
      async (format: (path: string) => Promise<void>) => {
        if (!files) return;
        formattingRef.current = true;
        setSaving(true);
        setError(null);
        try {
          const current = textRef.current;
          // Write current editor content to disk temporarily.
          await writeFileEncoded(
            path,
            cwd,
            files.crlf ? current.replace(/\n/g, '\r\n') : current,
            files.enc,
          );
          // Run the external formatter on the file.
          await format(path);
          // Read back the formatted result.
          const formatted = await readFileDecoded(path, cwd);
          const formattedN = formatted.text.replace(/\r\n/g, '\n');
          // Restore the saved version before releasing the format lock, so the load effect never sees the temp state.
          await writeFileEncoded(
            path,
            cwd,
            files.crlf
              ? savedRef.current.replace(/\n/g, '\r\n')
              : savedRef.current,
            files.enc,
          );
          // Push formatted text into the editor without touching savedRef.
          textRef.current = formattedN;
          setText(formattedN);
          const v = mainView.current;
          if (v)
            v.dispatch({
              changes: { from: 0, to: v.state.doc.length, insert: formattedN },
            });
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err));
        } finally {
          formattingRef.current = false;
          setSaving(false);
        }
      },
      [files, path, cwd],
    );

    useImperativeHandle(ref, () => ({ jump, save, revert, formatInPlace }), [
      jump,
      save,
      revert,
      formatInPlace,
    ]);

    // Reconnecting aligns to the last independently scrolled pane.
    useEffect(() => {
      if (mode !== 'split') return;
      const main = mainView.current?.scrollDOM;
      const left = leftView.current?.scrollDOM;
      if (!main || !left) return;
      const onMainScroll = () => {
        lastScrolledPane.current = 'main';
      };
      const onLeftScroll = () => {
        lastScrolledPane.current = 'left';
      };
      main.addEventListener('scroll', onMainScroll);
      left.addEventListener('scroll', onLeftScroll);
      return () => {
        main.removeEventListener('scroll', onMainScroll);
        left.removeEventListener('scroll', onLeftScroll);
      };
    }, [mode]);

    useEffect(() => {
      const wasSyncing = previousSyncScroll.current;
      previousSyncScroll.current = syncScroll;
      if (mode !== 'split' || !syncScroll) return;
      const a = mainView.current?.scrollDOM;
      const b = leftView.current?.scrollDOM;
      if (!a || !b) return;
      if (!wasSyncing) {
        const source = lastScrolledPane.current === 'left' ? b : a;
        const target = source === a ? b : a;
        target.scrollTop = source.scrollTop;
        target.scrollLeft = source.scrollLeft;
      }
      let lock = false;
      const link = (from: HTMLElement, to: HTMLElement) => () => {
        if (lock) {
          lock = false;
          return;
        }
        if (from.scrollTop !== to.scrollTop) {
          lock = true;
          to.scrollTop = from.scrollTop;
        }
      };
      const fa = link(a, b);
      const fb = link(b, a);
      a.addEventListener('scroll', fa);
      b.addEventListener('scroll', fb);
      return () => {
        a.removeEventListener('scroll', fa);
        b.removeEventListener('scroll', fb);
      };
    });

    if (!files) return <div className="svn-diff-hint">{t('loading')}</div>;

    const conflict = hasConflictMarkers(files.work);
    const main = (
      <DiffPane
        conflict={conflict}
        doc={files.work}
        mode={mode === 'split' ? 'split-right' : 'inline'}
        lang={lang}
        oldL={oldL}
        hunks={hunks}
        focus={focus}
        onDoc={onDoc}
        onSave={() => void save()}
        onJump={jump}
        onContextMenu={(event) => openHunkMenu(event, 'working')}
        onView={(v) => {
          mainView.current = v;
        }}
      />
    );
    if (mode === 'inline' || conflict)
      return <div className="svn-diff-body svn-cm-wrap">{main}</div>;
    return (
      <>
        <div
          className="svn-split svn-cm-split svn-diff-resizable"
          style={split.style}
        >
          <div className="svn-split-pane svn-cm-wrap">
            <DiffPane
              doc={files.base}
              mode="split-left"
              onJump={jump}
              lang={lang}
              oldL={oldL}
              hunks={hunks}
              focus={focus}
              readOnly
              onContextMenu={(event) => openHunkMenu(event, 'base')}
              onView={(v) => {
                leftView.current = v;
              }}
            />
          </div>
          <Splitter direction="h" onMouseDown={split.onMouseDown} />
          <div className="svn-split-pane svn-cm-wrap">{main}</div>
        </div>
        {menu && (
          <ContextMenu
            x={menu.x}
            y={menu.y}
            onClose={() => setMenu(undefined)}
            items={
              [
                {
                  label: t(
                    menu.side === 'base' ? 'useThisBlock' : 'useOtherBlock',
                  ) as string,
                  icon: menu.side === 'base' ? 'arrow_forward' : 'arrow_back',
                  onClick: () => useBaseBlock(menu.hunk),
                },
                ...(menu.side === 'working'
                  ? [
                      {
                        label: t('keepThisBlock') as string,
                        icon: 'check_circle',
                        onClick: () => mainView.current?.focus(),
                      },
                    ]
                  : []),
                { separator: true },
                ...(menu.side === 'base'
                  ? [
                      {
                        label: t('copyThisBlock') as string,
                        icon: 'content_copy',
                        onClick: () =>
                          void navigator.clipboard?.writeText(
                            oldL
                              .slice(menu.hunk.o, menu.hunk.o + menu.hunk.del)
                              .join('\n'),
                          ),
                      },
                      {
                        label: t('copyOtherBlock') as string,
                        icon: 'copy_all',
                        onClick: () =>
                          void navigator.clipboard?.writeText(
                            splitLines(
                              mainView.current?.state.doc.toString() ?? '',
                            )
                              .slice(menu.hunk.n, menu.hunk.n + menu.hunk.add)
                              .join('\n'),
                          ),
                      },
                    ]
                  : [
                      {
                        label: t('copyThisBlock') as string,
                        icon: 'content_copy',
                        onClick: () =>
                          void navigator.clipboard?.writeText(
                            splitLines(
                              mainView.current?.state.doc.toString() ?? '',
                            )
                              .slice(menu.hunk.n, menu.hunk.n + menu.hunk.add)
                              .join('\n'),
                          ),
                      },
                      {
                        label: t('copyOtherBlock') as string,
                        icon: 'copy_all',
                        onClick: () =>
                          void navigator.clipboard?.writeText(
                            oldL
                              .slice(menu.hunk.o, menu.hunk.o + menu.hunk.del)
                              .join('\n'),
                          ),
                      },
                    ]),
              ] satisfies ContextMenuItem[]
            }
          />
        )}
      </>
    );
  },
);
