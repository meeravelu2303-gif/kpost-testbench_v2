import { ROOT_DIR } from '@config/constants';
import { expect, test } from '@fixtures';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import {
  allowedTransitionsFrom as accountTransitions,
  canTransition as accountCanTransition,
} from '../../src/test-data/accounts/index';
import { canTransition as resourceCanTransition } from '../../src/test-data/index';

/**
 * Boundary guards from the Phase 4H architecture review.
 *
 * These pin two boundaries the review found unguarded. They are deliberately narrow: the review
 * concluded that the repository's other boundaries are already enforced elsewhere
 * (`state-model.spec.ts` keeps the ledger vocabulary out of application state;
 * `account-registry.spec.ts` keeps `AccountPool`/`ResourceLedger` out of the registry;
 * `actor-model.spec.ts` keeps permissions out of actors), so nothing is duplicated here.
 */

const flowFiles = (): string[] => {
  const dir = path.join(ROOT_DIR, 'src', 'flows');
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.ts')) out.push(full);
    }
  };
  walk(dir);
  return out;
};

// ---------------------------------------------------------------------------------------------
// 1. Flows → validation-engine: bounded, and pinned so it cannot widen unnoticed
// ---------------------------------------------------------------------------------------------

test.describe('boundaries: flows → engine @framework', () => {
  test('the flow layer reaches into the engine for exactly one type, type-only', () => {
    /*
     * The Flow model sits ABOVE execution, so importing from the engine is a direction inversion.
     * The review left it in place because it is a single, runtime-erased vocabulary import
     * (`ExchangePhase` = precondition | action | cleanup) with no lower-level module that owns
     * shared vocabulary today — inventing one now would be the speculative abstraction the review
     * was told not to build.
     *
     * What this guard buys: the inversion cannot QUIETLY widen. The moment a flow file imports a
     * second engine symbol, or imports a value rather than a type, this fails — which is the point
     * at which the shared-vocabulary module stops being speculative and becomes justified.
     */
    const engineImports = flowFiles().flatMap((file) => {
      const rel = path.relative(ROOT_DIR, file).split(path.sep).join('/');
      return [
        ...readFileSync(file, 'utf8').matchAll(/(import|export)[^;]*?from\s*'(@engine\/[^']+)'/g),
      ].map((match) => ({ rel, statement: match[0].replace(/\s+/g, ' ').trim() }));
    });

    // Collected, then asserted — no branch in the test body decides what counts.
    const valueImports = engineImports.filter(
      ({ statement }) => !statement.includes('import type') && !/\{ *type /.test(statement),
    );
    const otherSymbols = engineImports.filter(
      ({ statement }) => !statement.includes('ExchangePhase'),
    );

    expect(valueImports, 'src/flows must import from @engine type-only').toEqual([]);
    expect(otherSymbols, 'src/flows may import ONLY ExchangePhase from @engine').toEqual([]);
    // And the one permitted import must actually still be there, or this guard proves nothing.
    expect(engineImports, 'the bounded flows → engine import still exists').toHaveLength(1);
  });

  test('no other declarative layer depends on the engine at all', () => {
    // states / actors / state-observation / state-calibration must not acquire the same inversion.
    const offenders = ['actors', 'states', 'state-observation', 'state-calibration'].flatMap(
      (layer) => {
        const dir = path.join(ROOT_DIR, 'src', layer);
        return readdirSync(dir, { withFileTypes: true, recursive: true })
          .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
          .filter((entry) =>
            readFileSync(path.join(entry.parentPath ?? dir, entry.name), 'utf8').includes(
              '@engine/',
            ),
          )
          .map((entry) => `src/${layer}/${entry.name}`);
      },
    );
    expect(offenders, 'only src/flows may reach the engine, and only for ExchangePhase').toEqual(
      [],
    );
  });
});

// ---------------------------------------------------------------------------------------------
// 2. test-data barrel: no silent shadowing between the two transition vocabularies
// ---------------------------------------------------------------------------------------------

test.describe('boundaries: test-data barrel @framework', () => {
  test('the barrel re-exports accounts by name, never with `export *`', () => {
    /*
     * `resource-record` and `accounts/account-record` both export `canTransition` and
     * `allowedTransitionsFrom`. With `export * from './accounts/index'`, ES semantics let the
     * explicit resource exports win and silently DROP the account pair — a caller reaching for it
     * here got the resource-lifecycle function instead, complaining about states they never named.
     */
    const barrel = readFileSync(path.join(ROOT_DIR, 'src', 'test-data', 'index.ts'), 'utf8');
    expect(barrel, 'a wildcard re-export reintroduces the silent shadow').not.toMatch(
      /export\s+\*\s+from/,
    );
  });

  test('the two transition vocabularies stay separate and both remain reachable', () => {
    // Resource lifecycle — via the test-data barrel.
    expect(resourceCanTransition('REGISTERED', 'CLEANUP_PENDING')).toBe(true);
    expect(resourceCanTransition('CLEANED', 'CLEANUP_PENDING')).toBe(false);

    // Account lifecycle — via the accounts barrel, which is where it belongs.
    expect(accountCanTransition('CREATED', 'ACTIVE')).toBe(true);
    expect(accountCanTransition('CLEANED', 'ACTIVE')).toBe(false);
    expect(accountTransitions('RETIRED')).toEqual([]);
  });

  test('the colliding helpers are deliberately not surfaced by the parent barrel', async () => {
    // Importing them from `src/test-data` must remain impossible, so the ambiguity cannot return.
    const barrel = (await import('../../src/test-data/index')) as Record<string, unknown>;
    const accounts = (await import('../../src/test-data/accounts/index')) as Record<
      string,
      unknown
    >;

    expect(typeof accounts.canTransition, 'accounts barrel owns the account pair').toBe('function');
    /*
     * Both must be FUNCTIONS and they must be DIFFERENT ones. Asserting only that they differ would
     * also pass if the parent barrel exported nothing at all — a vacuous green of exactly the kind
     * this repository has been repairing.
     */
    expect(typeof barrel.canTransition, 'the resource pair is still exported here').toBe(
      'function',
    );
    expect(barrel.canTransition).not.toBe(accounts.canTransition);
    expect(barrel.AccountRegistry, 'the registry itself is still re-exported').toBeTruthy();
  });
});
