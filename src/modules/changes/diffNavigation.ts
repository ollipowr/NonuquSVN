export function nextChangeIndex(
  current: number | null,
  count: number,
  direction: 'prev' | 'next',
): number | null {
  if (count === 0) return null;
  if (current === null || current >= count)
    return direction === 'next' ? 0 : count - 1;
  return (current + (direction === 'next' ? 1 : -1) + count) % count;
}
