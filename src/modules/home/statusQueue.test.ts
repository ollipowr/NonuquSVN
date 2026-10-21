import { expect, it } from 'vitest';

import { createQueue } from './statusQueue.js';

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

const gate = () => {
  let release!: () => void;
  const promise = new Promise<void>((r) => {
    release = r;
  });
  return { promise, release };
};

it('runs at most `limit` jobs at once and each key once', async () => {
  const started: string[] = [];
  const gates = new Map<string, ReturnType<typeof gate>>();
  const q = createQueue((k) => {
    started.push(k);
    const g = gate();
    gates.set(k, g);
    return g.promise;
  }, 2);
  q.enqueue(['a', 'b', 'c', 'a']);
  expect(started).toEqual(['a', 'b']);
  gates.get('a')!.release();
  await tick();
  expect(started).toEqual(['a', 'b', 'c']);
  q.enqueue(['a']);
  expect(started).toEqual(['a', 'b', 'c']);
});

it('lets priority keys jump ahead, including ones already waiting', async () => {
  const started: string[] = [];
  const gates: ReturnType<typeof gate>[] = [];
  const q = createQueue((k) => {
    started.push(k);
    const g = gate();
    gates.push(g);
    return g.promise;
  }, 1);
  q.enqueue(['a', 'b', 'c', 'd']);
  q.enqueue(['d', 'x'], true);
  gates[0].release();
  await tick();
  expect(started).toEqual(['a', 'd']);
  gates[1].release();
  await tick();
  expect(started).toEqual(['a', 'd', 'x']);
});

it('keeps going after a failing job', async () => {
  const done: string[] = [];
  const q = createQueue(async (k) => {
    if (k === 'bad') throw new Error('boom');
    done.push(k);
  }, 1);
  q.enqueue(['bad', 'ok']);
  await new Promise((r) => setTimeout(r, 0));
  expect(done).toEqual(['ok']);
});

it('starts nothing after cancel', async () => {
  const started: string[] = [];
  const g = gate();
  const q = createQueue((k) => {
    started.push(k);
    return g.promise;
  }, 1);
  q.enqueue(['a', 'b']);
  q.cancel();
  g.release();
  await tick();
  q.enqueue(['c']);
  expect(started).toEqual(['a']);
});
