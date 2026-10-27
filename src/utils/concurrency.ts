/**
 * Simultaneous execution for the concurrency validators. Every task is built first and released
 * from one barrier (a plain `Promise.all(map)` staggers them); `dispatchSkewMs` lets a too-spread
 * burst be inconclusive.
 */

/** One task's result. Rejections are captured, never thrown: one failure must not hide the rest. */
export interface SettledOutcome<T> {
  index: number;
  status: 'fulfilled' | 'rejected';
  value?: T;
  error?: Error;
  /** Milliseconds from barrier release to dispatch — how simultaneous the burst really was. */
  dispatchOffsetMs: number;
  durationMs: number;
}

export interface BurstResult<T> {
  outcomes: readonly SettledOutcome<T>[];
  /** Spread between the first and last dispatch. Small means the requests truly overlapped. */
  dispatchSkewMs: number;
  /** Wall-clock time from release until the last task settled. */
  totalMs: number;
}

interface Barrier {
  wait(): Promise<void>;
  release(): void;
}

function createBarrier(): Barrier {
  let release = (): void => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { wait: () => gate, release: () => release() };
}

const asError = (cause: unknown): Error =>
  cause instanceof Error ? cause : new Error(String(cause));

/**
 * Runs `task` `count` times, released from the same tick; `task` gets its index to vary one field.
 */
export async function runSimultaneously<T>(
  count: number,
  task: (index: number) => Promise<T>,
): Promise<BurstResult<T>> {
  if (count < 1) throw new Error(`runSimultaneously needs at least 1 task, got ${count}`);

  const barrier = createBarrier();
  // Assigned just before release, so every continuation sees the real release instant.
  let releasedAt = 0;
  // Built before the barrier opens, so setup cost does not stagger the dispatches.
  const pending = Array.from({ length: count }, (_, index) =>
    (async (): Promise<SettledOutcome<T>> => {
      await barrier.wait();
      const dispatchedAt = performance.now();
      try {
        const value = await task(index);
        return {
          index,
          status: 'fulfilled',
          value,
          dispatchOffsetMs: dispatchedAt - releasedAt,
          durationMs: performance.now() - dispatchedAt,
        };
      } catch (cause) {
        return {
          index,
          status: 'rejected',
          error: asError(cause),
          dispatchOffsetMs: dispatchedAt - releasedAt,
          durationMs: performance.now() - dispatchedAt,
        };
      }
    })(),
  );

  releasedAt = performance.now();
  barrier.release();
  const outcomes = await Promise.all(pending);
  const totalMs = Math.round(performance.now() - releasedAt);

  const offsets = outcomes.map((o) => o.dispatchOffsetMs);
  const dispatchSkewMs = Math.round(Math.max(...offsets) - Math.min(...offsets));

  return { outcomes, dispatchSkewMs, totalMs };
}

/** The tasks that completed, in dispatch order. */
export function fulfilled<T>(result: BurstResult<T>): T[] {
  return result.outcomes.flatMap((o) =>
    o.status === 'fulfilled' && o.value !== undefined ? [o.value] : [],
  );
}

/** The tasks that threw — a transport failure, not an HTTP error status. */
export function rejected<T>(result: BurstResult<T>): Error[] {
  return result.outcomes.flatMap((o) => (o.error ? [o.error] : []));
}
