export interface Queue {
  /** Each key runs once per queue. `priority` moves not yet started keys to the front. */
  enqueue(keys: string[], priority?: boolean): void;
  cancel(): void;
}

export function createQueue(
  run: (key: string) => Promise<void>,
  limit: number,
): Queue {
  const waiting: string[] = [];
  const seen = new Set<string>();
  let running = 0;
  let stopped = false;

  const pump = () => {
    while (!stopped && running < limit && waiting.length) {
      const key = waiting.shift() as string;
      running++;
      run(key)
        .catch(() => {})
        .finally(() => {
          running--;
          pump();
        });
    }
  };

  return {
    enqueue(keys, priority = false) {
      if (stopped) return;
      const fresh: string[] = [];
      for (const key of keys) {
        const at = waiting.indexOf(key);
        if (at >= 0) {
          if (priority) {
            waiting.splice(at, 1);
            fresh.push(key);
          }
        } else if (!seen.has(key)) {
          seen.add(key);
          fresh.push(key);
        }
      }
      if (priority) waiting.unshift(...fresh);
      else waiting.push(...fresh);
      pump();
    },
    cancel() {
      stopped = true;
      waiting.length = 0;
    },
  };
}
