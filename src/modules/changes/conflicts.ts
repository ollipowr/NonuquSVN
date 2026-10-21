import {
  EditorState,
  type Extension,
  Facet,
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
  lineNumbers,
  type Panel,
  showPanel,
  WidgetType,
} from '@codemirror/view';
import { t } from '@nonu/app/i18n';
import { highlightLine } from '@nonu/utils';

export interface ConflictBlock {
  /** Line of `<<<<<<<`. */
  start: number;
  /** Line of `|||||||` (diff3 base section) or -1. */
  base: number;
  /** Line of `=======`. */
  sep: number;
  /** Line of `>>>>>>>`. */
  end: number;
  mineLabel: string;
  baseLabel: string;
  theirsLabel: string;
}

const RE_START = /^<{7}(?: (.*))?$/;
const RE_BASE = /^\|{7}(?: (.*))?$/;
const RE_SEP = /^={7}\s*$/;
const RE_END = /^>{7}(?: (.*))?$/;

export function parseConflicts(lines: string[]): ConflictBlock[] {
  const out: ConflictBlock[] = [];
  let cur: {
    start: number;
    base: number;
    sep: number;
    mine: string;
    baseL: string;
  } | null = null;
  lines.forEach((raw, i) => {
    const line = raw.replace(/\r$/, '');
    let m: RegExpExecArray | null;
    if ((m = RE_START.exec(line))) {
      cur = {
        start: i,
        base: -1,
        sep: -1,
        mine: (m[1] ?? '').trim(),
        baseL: '',
      };
    } else if (cur && cur.sep < 0 && cur.base < 0 && (m = RE_BASE.exec(line))) {
      cur.base = i;
      cur.baseL = (m[1] ?? '').trim();
    } else if (cur && cur.sep < 0 && RE_SEP.test(line)) {
      cur.sep = i;
    } else if (cur && cur.sep >= 0 && (m = RE_END.exec(line))) {
      out.push({
        start: cur.start,
        base: cur.base,
        sep: cur.sep,
        end: i,
        mineLabel: cur.mine,
        baseLabel: cur.baseL,
        theirsLabel: (m[1] ?? '').trim(),
      });
      cur = null;
    }
  });
  return out;
}

export function hasConflictMarkers(text: string): boolean {
  return parseConflicts(text.split('\n')).length > 0;
}

type Choice = 'mine' | 'theirs' | 'both' | 'both-rev';

const toggleRaw = StateEffect.define<number>(); // start-line offset of the block
const toggleBase = StateEffect.define<number>(); // same, for showing the diff3 base section

interface CState {
  blocks: ConflictBlock[];
  raw: number[]; // doc offsets (line starts) of blocks shown with raw markers
  bases: number[]; // doc offsets (line starts) of blocks whose base section is shown
  deco: DecorationSet;
  /** Gutter label per 1-based doc line (index 0 unused); null = no number. */
  nums: ({
    n: number;
    side: 'mine' | 'theirs' | 'base' | null;
    split?: { rows: number };
  } | null)[];
}

const clean = (l: string) => l.replace(/\r$/, '');

function sectionLines(
  doc: EditorState['doc'],
  from: number,
  to: number,
): string[] {
  const r: string[] = [];
  for (let i = from; i <= to; i++) r.push(clean(doc.line(i + 1).text));
  return r;
}

function chosenText(
  doc: EditorState['doc'],
  b: ConflictBlock,
  c: Choice,
): string[] {
  const mine = sectionLines(
    doc,
    b.start + 1,
    (b.base >= 0 ? b.base : b.sep) - 1,
  );
  const theirs = sectionLines(doc, b.sep + 1, b.end - 1);
  if (c === 'mine') return mine;
  if (c === 'theirs') return theirs;
  return c === 'both' ? [...mine, ...theirs] : [...theirs, ...mine];
}

function resolveChange(doc: EditorState['doc'], b: ConflictBlock, c: Choice) {
  const from = doc.line(b.start + 1).from;
  const endLine = doc.line(b.end + 1);
  const hasNext = b.end + 1 < doc.lines;
  const lines = chosenText(doc, b, c);
  return {
    from,
    to: hasNext ? endLine.to + 1 : endLine.to,
    insert: lines.length ? lines.join('\n') + (hasNext ? '\n' : '') : '',
  };
}

/** diff3 base section with at least one real line (an empty base is not worth showing). */
const hasBaseContent = (b: ConflictBlock) =>
  b.base >= 0 && b.sep - b.base - 1 > 0;

const isWord = (ch: string | undefined) => !!ch && /\w/.test(ch);

/** Offsets (within the joined texts) of the differing middle part, snapped to word boundaries. */
function wordDiff(
  a: string,
  b: string,
): { a: [number, number]; b: [number, number] } | null {
  let p = 0;
  while (p < a.length && p < b.length && a[p] === b[p]) p++;
  while (p > 0 && isWord(a[p - 1]) && (isWord(a[p]) || isWord(b[p]))) p--;
  let s = 0;
  while (
    s < a.length - p &&
    s < b.length - p &&
    a[a.length - 1 - s] === b[b.length - 1 - s]
  )
    s++;
  while (
    s > 0 &&
    isWord(a[a.length - s]) &&
    (isWord(a[a.length - s - 1]) || isWord(b[b.length - s - 1]))
  )
    s--;
  const ra: [number, number] = [p, a.length - s];
  const rb: [number, number] = [p, b.length - s];
  if (ra[0] >= ra[1] && rb[0] >= rb[1]) return null;
  return { a: ra, b: rb };
}

class BlockWidget extends WidgetType {
  constructor(
    readonly kind:
      | 'head'
      | 'raw-head'
      | 'sep'
      | 'base'
      | 'base-hidden'
      | 'tail',
    readonly label: string,
    readonly extra: number,
    readonly hasBase = false,
    readonly noLabel = false,
  ) {
    super();
  }
  eq(o: BlockWidget) {
    return (
      o.kind === this.kind &&
      o.label === this.label &&
      o.extra === this.extra &&
      o.hasBase === this.hasBase &&
      o.noLabel === this.noLabel
    );
  }
  toDOM(view: EditorView) {
    const el = document.createElement('div');
    el.className = `svn-conflict-row svn-conflict-${this.kind}`;
    if (this.kind === 'base-hidden') el.style.display = 'none';
    const find = () => {
      const pos = view.posAtDOM(el);
      const st = view.state.field(conflictField);
      return st.blocks.find(
        (b) =>
          view.state.doc.line(b.start + 1).from <= pos &&
          pos <= view.state.doc.line(b.end + 1).to,
      );
    };
    const btn = (
      text: string,
      title: string,
      cls: string,
      run: (b: ConflictBlock) => void,
    ) => {
      const bt = document.createElement('button');
      bt.className = `svn-conflict-btn ${cls}`;
      bt.textContent = text;
      bt.title = title;
      bt.addEventListener('mousedown', (e) => {
        e.preventDefault();
        const b = find();
        if (b) run(b);
      });
      el.appendChild(bt);
    };
    const apply = (c: Choice) => (b: ConflictBlock) =>
      view.dispatch({ changes: resolveChange(view.state.doc, b, c) });
    const label = (text: string, cls: string) => {
      const s = document.createElement('span');
      s.className = `svn-conflict-label ${cls}`;
      s.textContent = text;
      el.appendChild(s);
    };
    if (this.kind === 'head') {
      if (!this.noLabel)
        label(
          `${t('conflictMine')}${this.label ? ` (${this.label})` : ''}`,
          'svn-conflict-label-mine',
        );
      const sp = document.createElement('span');
      sp.className = 'svn-conflict-spacer';
      el.appendChild(sp);
      btn(
        t('conflictMineBtn'),
        t('conflictMineTitle'),
        'svn-conflict-btn-mine',
        apply('mine'),
      );
      btn(
        t('conflictIncomingBtn'),
        t('conflictIncomingTitle'),
        'svn-conflict-btn-theirs',
        apply('theirs'),
      );
      btn(
        t('conflictBothBtn'),
        t('conflictBothMineFirstTitle'),
        'svn-conflict-btn-both',
        apply('both'),
      );
      btn(
        t('conflictBothRevBtn'),
        t('conflictBothIncomingFirstTitle'),
        'svn-conflict-btn-both-rev',
        apply('both-rev'),
      );
      if (this.hasBase)
        btn(
          this.extra ? `${t('conflictBase')} ✓` : t('conflictBase'),
          t('conflictBaseToggleTitle'),
          '',
          (b) =>
            view.dispatch({
              effects: toggleBase.of(view.state.doc.line(b.start + 1).from),
            }),
        );
      btn(t('conflictEditBtn'), t('conflictRawTitle'), '', (b) =>
        view.dispatch({
          effects: toggleRaw.of(view.state.doc.line(b.start + 1).from),
        }),
      );
    } else if (this.kind === 'raw-head') {
      label(t('conflictRawView'), 'svn-conflict-label-raw');
      const sp = document.createElement('span');
      sp.className = 'svn-conflict-spacer';
      el.appendChild(sp);
      btn(t('conflictViewBtn'), t('conflictBackToView'), '', (b) =>
        view.dispatch({
          effects: toggleRaw.of(view.state.doc.line(b.start + 1).from),
        }),
      );
    } else if (this.kind === 'sep') {
      label(
        `${t('conflictIncoming')}${this.label ? ` (${this.label})` : ''}`,
        'svn-conflict-label-theirs',
      );
    } else if (this.kind === 'base') {
      label(
        `${t('conflictBase')}${this.label ? ` (${this.label})` : ''}`,
        'svn-conflict-label-base',
      );
    }
    return el;
  }
  ignoreEvent() {
    return true;
  }
}

interface ConflictOpts {
  split: boolean;
  lang: string | null;
}
const conflictOpts = Facet.define<ConflictOpts, ConflictOpts>({
  combine: (v) => v[0] ?? { split: false, lang: null },
});

const escapeHtml = (t: string) =>
  t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Wraps the text between character offsets [from, to) of `root` in `<span class=cls>`, keeping inner markup (syntax colors). */
function wrapRange(root: HTMLElement, from: number, to: number, cls: string) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const hits: [Text, number, number][] = [];
  let pos = 0;
  for (
    let n = walker.nextNode() as Text | null;
    n;
    n = walker.nextNode() as Text | null
  ) {
    const len = n.data.length;
    const s = Math.max(from - pos, 0);
    const e = Math.min(to - pos, len);
    if (e > s) hits.push([n, s, e]);
    pos += len;
  }
  for (const [n, s, e] of hits) {
    const mid = n.splitText(s);
    mid.splitText(e - s);
    const span = document.createElement('span');
    span.className = cls;
    mid.replaceWith(span);
    span.appendChild(mid);
  }
}

/** Side-by-side rendering of one whole conflict block (meine | eingehende Änderungen). */
class SplitWidget extends WidgetType {
  constructor(
    readonly mine: string[],
    readonly theirs: string[],
    readonly mineLabel: string,
    readonly theirsLabel: string,
    readonly lang: string | null,
    readonly base: string[] | null,
    readonly hasBase: boolean,
    readonly baseLabel: string,
  ) {
    super();
  }
  eq(o: SplitWidget) {
    return (
      o.hasBase === this.hasBase &&
      (o.base?.join('\n') ?? null) === (this.base?.join('\n') ?? null) &&
      o.mineLabel === this.mineLabel &&
      o.theirsLabel === this.theirsLabel &&
      o.lang === this.lang &&
      o.mine.join('\n') === this.mine.join('\n') &&
      o.theirs.join('\n') === this.theirs.join('\n')
    );
  }
  toDOM(view: EditorView) {
    const el = document.createElement('div');
    el.className = 'svn-conflict-split';
    el.appendChild(
      new BlockWidget('head', '', this.base ? 1 : 0, this.hasBase, true).toDOM(
        view,
      ),
    );
    const d =
      this.mine.length && this.theirs.length
        ? wordDiff(this.mine.join('\n'), this.theirs.join('\n'))
        : null;
    const col = (
      lines: string[],
      cls: string,
      range: [number, number] | undefined,
      title: string,
      labelCls: string,
    ) => {
      const c = document.createElement('div');
      c.className = 'svn-conflict-col ' + cls;
      const h = document.createElement('div');
      h.className = `svn-conflict-col-head ${labelCls}`;
      h.textContent = title;
      c.appendChild(h);
      let off = 0;
      for (const l of lines) {
        const row = document.createElement('div');
        row.className = 'svn-conflict-split-line';
        const a = range ? Math.max(range[0] - off, 0) : 0;
        const b = range ? Math.min(range[1] - off, l.length) : 0;
        row.innerHTML = highlightLine(l, this.lang) || ' ';
        if (range && b > a) wrapRange(row, a, b, cls + '-word');
        c.appendChild(row);
        off += l.length + 1;
      }
      if (!lines.length) {
        const row = document.createElement('div');
        row.className = 'svn-conflict-split-line svn-conflict-split-empty';
        row.textContent = t('conflictEmptySide');
        c.appendChild(row);
      }
      return c;
    };
    const grid = document.createElement('div');
    grid.className = 'svn-conflict-grid';
    const named = (t: string, l: string) => (l ? `${t} (${l})` : t);
    grid.append(
      col(
        this.mine,
        'svn-conflict-mine',
        d?.a,
        named(t('conflictMine'), this.mineLabel),
        'svn-conflict-label-mine',
      ),
    );
    if (this.base) {
      grid.append(
        col(
          this.base,
          'svn-conflict-base-col',
          undefined,
          named(t('conflictBase'), this.baseLabel),
          'svn-conflict-label-base',
        ),
      );
      grid.style.gridTemplateColumns = '1fr 1fr 1fr';
    }
    grid.append(
      col(
        this.theirs,
        'svn-conflict-theirs',
        d?.b,
        named(t('conflictIncoming'), this.theirsLabel),
        'svn-conflict-label-theirs',
      ),
    );
    el.appendChild(grid);
    return el;
  }
  ignoreEvent() {
    return true;
  }
}

function build(state: EditorState, raw: number[], bases: number[]): CState {
  const { split, lang } = state.facet(conflictOpts);
  const doc = state.doc;
  const lines: string[] = [];
  for (let i = 1; i <= doc.lines; i++) lines.push(doc.line(i).text);
  const blocks = parseConflicts(lines);
  const ranges: Range<Decoration>[] = [];
  const line = (i: number) => doc.line(i + 1);

  // Inside a block, mine and theirs both restart at its first number so changed lines line up.
  const nums: CState['nums'] = new Array(doc.lines + 1).fill(null);
  {
    let n = 1;
    let ln = 1; // 1-based doc line
    for (const b of blocks) {
      for (; ln <= b.start; ln++) nums[ln] = { n: n++, side: null };
      const mineEnd0 = (b.base >= 0 ? b.base : b.sep) - 1;
      if (raw.includes(line(b.start).from)) {
        for (; ln <= b.end + 1; ln++) nums[ln] = { n: n++, side: null };
        continue;
      }
      const showBase = hasBaseContent(b) && bases.includes(line(b.start).from);
      if (split) {
        const rows = Math.max(
          mineEnd0 - b.start,
          b.end - 1 - b.sep,
          showBase ? b.sep - b.base - 1 : 0,
          0,
        );
        nums[b.start + 1] = { n, side: null, split: { rows } };
      } else {
        if (showBase)
          for (let i = b.base + 1; i < b.sep; i++)
            nums[i + 1] = { n: n + i - b.base - 1, side: 'base' };
        for (let i = b.start + 1; i <= mineEnd0; i++)
          nums[i + 1] = { n: n + i - b.start - 1, side: 'mine' };
        for (let i = b.sep + 1; i <= b.end - 1; i++)
          nums[i + 1] = { n: n + i - b.sep - 1, side: 'theirs' };
      }
      n += Math.max(mineEnd0 - b.start, 0);
      ln = b.end + 2;
    }
    for (; ln <= doc.lines; ln++) nums[ln] = { n: n++, side: null };
  }

  for (const b of blocks) {
    const isRaw = raw.includes(line(b.start).from);
    const mineEnd = (b.base >= 0 ? b.base : b.sep) - 1;
    const markerCls = Decoration.line({ class: 'svn-conflict-marker' });
    if (split && !isRaw) {
      const w = new SplitWidget(
        sectionLines(doc, b.start + 1, mineEnd),
        sectionLines(doc, b.sep + 1, b.end - 1),
        b.mineLabel,
        b.theirsLabel,
        lang,
        hasBaseContent(b) && bases.includes(line(b.start).from)
          ? sectionLines(doc, b.base + 1, b.sep - 1)
          : null,
        hasBaseContent(b),
        b.baseLabel,
      );
      ranges.push(
        Decoration.replace({ widget: w, block: true }).range(
          line(b.start).from,
          line(b.end).to,
        ),
      );
      continue;
    }
    if (isRaw) {
      ranges.push(
        Decoration.widget({
          widget: new BlockWidget('raw-head', '', 0),
          block: true,
          side: -1,
        }).range(line(b.start).from),
      );
      for (const i of [b.start, b.sep, b.end, ...(b.base >= 0 ? [b.base] : [])])
        ranges.push(markerCls.range(line(i).from));
    } else {
      ranges.push(
        Decoration.replace({
          widget: new BlockWidget(
            'head',
            b.mineLabel,
            hasBaseContent(b) && bases.includes(line(b.start).from) ? 1 : 0,
            hasBaseContent(b),
          ),
          block: true,
        }).range(line(b.start).from, line(b.start).to),
      );
      if (hasBaseContent(b) && bases.includes(line(b.start).from)) {
        ranges.push(
          Decoration.replace({
            widget: new BlockWidget('base', b.baseLabel, -1),
            block: true,
          }).range(line(b.base).from, line(b.base).to),
        );
        for (let i = b.base + 1; i < b.sep; i++)
          ranges.push(
            Decoration.line({ class: 'svn-conflict-base-line' }).range(
              line(i).from,
            ),
          );
      } else if (b.base >= 0) {
        ranges.push(
          Decoration.replace({
            widget: new BlockWidget('base-hidden', '', 0),
            block: true,
          }).range(line(b.base).from, line(b.sep - 1).to),
        );
      }
      ranges.push(
        Decoration.replace({
          widget: new BlockWidget('sep', b.theirsLabel, 0),
          block: true,
        }).range(line(b.sep).from, line(b.sep).to),
      );
      ranges.push(
        Decoration.replace({
          widget: new BlockWidget('tail', '', 0),
          block: true,
        }).range(line(b.end).from, line(b.end).to),
      );
    }
    for (let i = b.start + 1; i <= mineEnd; i++)
      ranges.push(
        Decoration.line({ class: 'svn-conflict-mine' }).range(line(i).from),
      );
    for (let i = b.sep + 1; i <= b.end - 1; i++)
      ranges.push(
        Decoration.line({ class: 'svn-conflict-theirs' }).range(line(i).from),
      );

    // Word-level highlight between the two sides.
    if (mineEnd > b.start && b.end - 1 > b.sep) {
      const a = sectionLines(doc, b.start + 1, mineEnd).join('\n');
      const t = sectionLines(doc, b.sep + 1, b.end - 1).join('\n');
      const d = wordDiff(a, t);
      if (d) {
        const aBase = line(b.start + 1).from;
        const tBase = line(b.sep + 1).from;
        if (d.a[1] > d.a[0])
          ranges.push(
            Decoration.mark({ class: 'svn-conflict-word-mine' }).range(
              aBase + d.a[0],
              aBase + d.a[1],
            ),
          );
        if (d.b[1] > d.b[0])
          ranges.push(
            Decoration.mark({ class: 'svn-conflict-word-theirs' }).range(
              tBase + d.b[0],
              tBase + d.b[1],
            ),
          );
      }
    }
  }
  return { blocks, raw, bases, deco: Decoration.set(ranges, true), nums };
}

export const conflictField = StateField.define<CState>({
  create: (state) => build(state, [], []),
  update(value, tr) {
    let raw = value.raw;
    let bases = value.bases;
    let rebuild = tr.docChanged;
    if (tr.docChanged) {
      raw = raw.map((x) => tr.changes.mapPos(x));
      bases = bases.map((x) => tr.changes.mapPos(x));
    }
    for (const e of tr.effects) {
      if (e.is(toggleRaw)) {
        raw = raw.includes(e.value)
          ? raw.filter((x) => x !== e.value)
          : [...raw, e.value];
        rebuild = true;
      } else if (e.is(toggleBase)) {
        bases = bases.includes(e.value)
          ? bases.filter((x) => x !== e.value)
          : [...bases, e.value];
        rebuild = true;
      }
    }
    return rebuild ? build(tr.state, raw, bases) : value;
  },
  provide: (f) => [
    EditorView.decorations.from(f, (v) => v.deco),
    EditorView.atomicRanges.of((view) => view.state.field(f).deco),
  ],
});

/** Top bar: "Konflikt x von y", prev/next and bulk resolution. */
function conflictPanel(view: EditorView): Panel {
  const dom = document.createElement('div');
  dom.className = 'svn-conflict-bar';
  const info = document.createElement('span');
  info.className = 'svn-conflict-info';

  const mk = (text: string, title: string, cls: string, run: () => void) => {
    const b = document.createElement('button');
    b.className = `svn-conflict-btn ${cls}`;
    b.textContent = text;
    b.title = title;
    b.addEventListener('mousedown', (e) => {
      e.preventDefault();
      run();
    });
    return b;
  };
  const blocks = () => view.state.field(conflictField).blocks;
  const all = (c: Choice) => {
    const bs = blocks();
    if (!bs.length) return;
    view.dispatch({
      changes: bs.map((b) => resolveChange(view.state.doc, b, c)),
    });
  };

  const allMine = mk(
    t('conflictAllMine'),
    t('conflictAllMineTitle'),
    'svn-conflict-btn-mine',
    () => all('mine'),
  );
  const allTheirs = mk(
    t('conflictAllIncoming'),
    t('conflictAllIncomingTitle'),
    'svn-conflict-btn-theirs',
    () => all('theirs'),
  );
  const sp = document.createElement('span');
  sp.className = 'svn-conflict-spacer';
  dom.append(info, sp, allMine, allTheirs);

  const refresh = () => {
    const n = blocks().length;
    if (n === 0) {
      info.textContent = t('conflictAllResolved');
      info.className = 'svn-conflict-info svn-conflict-done';
    } else {
      info.textContent = t('conflictOpen')(n);
      info.className = 'svn-conflict-info';
    }
    for (const el of [allMine, allTheirs])
      el.style.display = n === 0 ? 'none' : '';
  };
  refresh();
  return {
    dom,
    top: true,
    update: (u) => (u.docChanged ? refresh() : undefined),
  };
}

/** Start offsets of all open conflict blocks, or null when the conflict extension is not active. */
export function conflictPositions(state: EditorState): number[] | null {
  const f = state.field(conflictField, false);
  return f ? f.blocks.map((b) => state.doc.line(b.start + 1).from) : null;
}

class ConflictLineNum extends GutterMarker {
  constructor(
    readonly label: string,
    readonly side: 'mine' | 'theirs' | 'base' | null,
    readonly n = 0,
    readonly split?: { rows: number },
  ) {
    super();
    this.elementClass = side ? `svn-conflict-num-${side}` : '';
  }
  eq(o: ConflictLineNum) {
    return (
      o.label === this.label &&
      o.side === this.side &&
      o.n === this.n &&
      o.split?.rows === this.split?.rows
    );
  }
  toDOM() {
    if (!this.split) return document.createTextNode(this.label);
    // Mirrors the SplitWidget rows: one grey number per row, as many rows as the longer side.
    const rows = this.split.rows;
    const wrap = document.createElement('div');
    wrap.className = 'svn-conflict-num-split';
    for (let k = 0; k < rows; k++) {
      const r = document.createElement('div');
      r.textContent = String(this.n + k);
      wrap.appendChild(r);
    }
    return wrap;
  }
}

const conflictLineNumbers = gutter({
  class: 'cm-lineNumbers',
  lineMarker(view, line) {
    const e =
      view.state.field(conflictField).nums[
        view.state.doc.lineAt(line.from).number
      ];
    return new ConflictLineNum(
      e ? String(e.n) : '',
      e?.side ?? null,
      e?.n,
      e?.split,
    );
  },
  // Block-replaced ranges (split view) reach the gutter as widgets, not as lines.
  widgetMarker(view, widget, block) {
    if (!(widget instanceof SplitWidget)) return null;
    const e =
      view.state.field(conflictField).nums[
        view.state.doc.lineAt(block.from).number
      ];
    return e?.split ? new ConflictLineNum('', null, e.n, e.split) : null;
  },
  lineMarkerChange: (u) =>
    u.docChanged ||
    u.transactions.some((t) =>
      t.effects.some((e) => e.is(toggleRaw) || e.is(toggleBase)),
    ),
  initialSpacer: () => new ConflictLineNum('0', null),
});

export function conflictExtension(opts: ConflictOpts): Extension {
  return [
    conflictOpts.of(opts),
    conflictField,
    showPanel.of(conflictPanel),
    conflictLineNumbers,
  ];
}
