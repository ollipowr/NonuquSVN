/** A changed region: `del` old lines starting at `o` were replaced by `add` new lines starting at `n` (0-based). */
export interface Hunk {
  o: number;
  del: number;
  n: number;
  add: number;
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
  if (found < 0) return [{ o: 0, del: N, n: 0, add: M }];

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
      cur = { o: m.sx, del: 0, n: m.sy, add: 0 };
      hunks.push(cur);
    }
    if (m.del) cur.del++;
    else cur.add++;
    lastX = m.ex;
    lastY = m.ey;
  }
  return hunks;
}
