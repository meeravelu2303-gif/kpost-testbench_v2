import type { Principal } from '@config/auth.config';

/**
 * Principals that resolve on first USE instead of at module load.
 *
 * ## The failure this exists to remove
 *
 * Playwright LOADS every spec file in a project's `testDir` before it applies `--grep`. A spec that
 * the filter will discard is still imported, so any failable work at module scope breaks the whole
 * run — including for the specs that were selected.
 *
 * `tests/api/kpost/katchup/feature.spec.ts` resolved four session accounts at module scope. Under
 * the `kmail` run profile a slot owns two (`accounts.sessionPerWorker: 2`, which is KMail's real
 * need), so importing the Katchup spec threw `AccountPoolError: Slot 0 owns 2 session account(s); 4
 * requested` — and `npm run bench -- --profile kmail` collected **nothing at all**, for a spec it
 * was never going to run.
 *
 * ## Why laziness rather than a bigger slot
 *
 * Raising KMail's `sessionPerWorker` would state that the KMail mode needs four accounts, which is
 * false, and passing an explicit size per spec (`currentSlot(4)`) would let two slots of different
 * sizes overlap — `slot 0 × 4 = [0,4)` against `slot 1 × 2 = [2,4)` — which is precisely the
 * positional-partition invariant the pool exists to guarantee. Neither is acceptable.
 *
 * Deferring the request changes no allocation at all. The same `currentSlot().principals(count)`
 * call runs, against the same slot, returning the same accounts in the same order — just at the
 * moment a test first touches one. A spec that never runs never asks, and a spec that DOES run
 * under a mode that cannot supply its accounts still fails with the pool's own message, naming the
 * slot and the count. The error moves; it is never softened, and never swallowed.
 *
 * ## Transparency
 *
 * Each element is a read-only forwarding view of the real `Principal` — a plain object of
 * primitives — so property access, `{...principal}`, `Object.keys`, `JSON.stringify` and the
 * executor's `auth: { principal }` all behave exactly as they did. Nothing is copied, cached in a
 * second place, logged or persisted: the view holds no field of its own, and every read goes
 * straight to the object the pool handed back. Writes are refused, because a test must not be able
 * to mutate a shared principal.
 */
export function lazyPrincipals(
  resolve: (count: number) => Principal[],
  count: number,
): Principal[] {
  if (!Number.isInteger(count) || count < 1) {
    throw new Error(`lazyPrincipals needs a positive integer count (got ${String(count)}).`);
  }

  // Resolved once, on the first property access by ANY of the views, so every view in one call
  // sees the same slot resolution — never one request per principal.
  let resolved: Principal[] | undefined;
  const all = (): Principal[] => (resolved ??= resolve(count));
  const at = (index: number): Principal => {
    const principal = all()[index];
    if (!principal) {
      // Unreachable while `principals(count)` returns `count` entries or throws; stated rather than
      // silently producing `undefined` if that ever changes.
      throw new Error(`Slot resolution returned no principal at position ${String(index)}.`);
    }
    return principal;
  };

  return Array.from(
    { length: count },
    (_unused, index) =>
      new Proxy({} as Principal, {
        get: (_target, property) => Reflect.get(at(index), property) as unknown,
        has: (_target, property) => Reflect.has(at(index), property),
        ownKeys: (_target) => Reflect.ownKeys(at(index)),
        getOwnPropertyDescriptor: (_target, property) => {
          const descriptor = Reflect.getOwnPropertyDescriptor(at(index), property);
          // A proxy may only report a non-configurable property that the TARGET also has, and the
          // target is empty — so the descriptor is reported configurable. Spread and `Object.keys`
          // need this to agree with `ownKeys`, or they throw a TypeError.
          return descriptor && { ...descriptor, configurable: true };
        },
        set: () => false,
        deleteProperty: () => false,
      }),
  );
}
