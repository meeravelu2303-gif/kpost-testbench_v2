/**
 * Simultaneous execution, for the concurrency validators.
 *
 * ## Why this is not `Promise.all(tasks.map(fn))`
 *
 * A race only reproduces when the requests are genuinely in flight together. Mapping over an array
 * starts each task as the iteration reaches it, so on a loaded machine the first request can be
 * answered before the last one is even built — and the endpoint never sees two writes at once. The
 * bug then does not reproduce, the bench reports PASSED, and the race ships.
 *
 * So every task is built first and parked on a shared barrier; releasing the barrier dispatches all
 * of them from the same tick. `dispatchSkewMs` records how far apart they actually left, and a burst
 * too spread out to prove anything is reported as inconclusive rather than as a pass — a concurrency
 * check that quietly degrades into a sequential one is worse than no check, because it looks green.
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
 * Runs `task` `count` times, all released from the same tick.
 *
 * `task` receives its index so a caller can vary one field per request (two different devices, two
 * different payloads) while still dispatching them together.
 */
export async function runSimultaneously<T>(
  count: number,
  task: (index: number) => Promise<T>,
): Promise<BurstResult<T>> {
  if (count < 1) throw new Error(`runSimultaneously needs at least 1 task, got ${count}`);

  const barrier = createBarrier();
  /*
   * Hoisted above the closures that read it. It is assigned synchronously before the barrier is
   * released, so every continuation below observes the real release instant rather than 0.
   */
  let releasedAt = 0;
  /*
   * Built before the barrier opens: constructing a promise runs `task` up to its first await, so
   * doing this after release would stagger the dispatches by exactly the setup cost we are trying
   * to eliminate.
   */
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
