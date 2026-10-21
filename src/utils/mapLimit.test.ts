import { expect, it } from 'vitest';

import { mapLimit } from './mapLimit.js';

it('keeps input order and honours the concurrency limit', async () => {
  let running = 0;
  let peak = 0;
  const result = await mapLimit([1, 2, 3, 4], 2, async (value) => {
    running++;
    peak = Math.max(peak, running);
    await new Promise((resolve) => setTimeout(resolve, 1));
    running--;
    return value * 10;
  });
  expect(result).toEqual([10, 20, 30, 40]);
  expect(peak).toBeLessThanOrEqual(2);
});

it('handles an empty list', async () => {
  expect(await mapLimit([], 3, async () => 1)).toEqual([]);
});
