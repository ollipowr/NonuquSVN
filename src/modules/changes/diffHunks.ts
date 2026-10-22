export interface WordSpan {
  a: [number, number];
  b: [number, number];
}

/** A changed region: `del` old lines starting at `o` were replaced by `add` new lines starting at `n` (0-based). `words[k]` is the changed part of the k-th paired line. */
export interface Hunk {
  o: number;
  del: number;
  n: number;
  add: number;
  words: (WordSpan | null)[];
}

const isWord = (ch: string | undefined) => !!ch && /\w/.test(ch);

/** Offsets of the differing middle part of two lines, snapped to word boundaries. */
export function wordDiff(a: string, b: string): WordSpan | null {
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

export const splitLines = (t: string): string[] => {
  const lines = t.split(/\r?\n/);
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
};

// shortcut: Myers search stops after MAX_EDITS edits, beyond that the whole file shows as one block, raise the cap if huge rewrites need line-level hunks
const MAX_EDITS = 2000;

/** Myers O(ND) diff over lines. Keeps changes at their real positions even when they are spread over the whole file. */
export function computeHunks(a: string[], b: string[]): Hunk[] {
  const N = a.length;
  const M = b.length;
  const max = Math.min(N + M, MAX_EDITS);
  const off = max + 1;
  const v = new Int32Array(2 * max + 3);
  // trace[d] holds v for diagonals -d..d after d edits, so backtracking needs no full copies
  const trace: Int32Array[] = [];
  let found = -1;
  for (let d = 0; d <= max && found < 0; d++) {
    for (let k = -d; k <= d; k += 2) {
      let x =
        k === -d || (k !== d && v[off + k - 1] < v[off + k + 1])
          ? v[off + k + 1]
          : v[off + k - 1] + 1;
      let y = x - k;
      while (x < N && y < M && a[x] === b[y]) {
        x++;
        y++;
      }
      v[off + k] = x;
      if (x >= N && y >= M) {
        found = d;
        break;
      }
    }
    trace.push(v.slice(off - d, off + d + 1));
  }
  if (found < 0) return [{ o: 0, del: N, n: 0, add: M, words: [] }];

  const at = (d: number, k: number) => trace[d][k + d];
  const moves: {
    sx: number;
    sy: number;
    ex: number;
    ey: number;
    del: boolean;
  }[] = [];
  let x = N;
  let y = M;
  for (let d = found; d > 0; d--) {
    const k = x - y;
    const prevK =
      k === -d || (k !== d && at(d - 1, k - 1) < at(d - 1, k + 1))
        ? k + 1
        : k - 1;
    const px = at(d - 1, prevK);
    const py = px - prevK;
    while (x > px && y > py) {
      x--;
      y--;
    }
    moves.push({ sx: px, sy: py, ex: x, ey: y, del: x - px === 1 });
    x = px;
    y = py;
  }

  // Consecutive edits without unchanged lines between them form one hunk.
  moves.reverse();
  const hunks: Hunk[] = [];
  let cur: Hunk | null = null;
  let lastX = -1;
  let lastY = -1;
  for (const m of moves) {
    if (!cur || m.sx !== lastX || m.sy !== lastY) {
      cur = { o: m.sx, del: 0, n: m.sy, add: 0, words: [] };
      hunks.push(cur);
    }
    if (m.del) cur.del++;
    else cur.add++;
    lastX = m.ex;
    lastY = m.ey;
  }
  for (const h of hunks)
    for (let k = 0; k < Math.min(h.del, h.add); k++)
      h.words.push(wordDiff(a[h.o + k], b[h.n + k]));
  return hunks;
}
