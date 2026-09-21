import { AUTH_PROFILES } from '@config/auth-profile';
import type { Principal } from '@config/auth.config';
import {
  AccountPool,
  AccountPoolError,
  accountPool,
  currentSlot,
  currentSlotIndex,
  lazyPrincipals,
  slotPrincipals,
} from '../../src/test-data/index';
import { expect, test } from '@fixtures';

/**
 * Guards for Phase 2 §17.3 — the account pool and session isolation.
 *
 * Entirely offline: the pool is a pure partition over configured principals, so nothing here logs
 * in, contacts a host, or reads a credential it then prints.
 *
 * The invariant that matters: **two logical slots never receive the same session account.** A KPost
 * account allows one active session, so a shared account means two workers signing each other out —
 * 401s that look like application defects.
 */

/** A synthetic inventory, so capacity can be tested at sizes this environment does not have. */
function fakePrincipals(count: number, role: 'USER' | 'COMPANY_ADMIN' = 'USER'): Principal[] {
  return Array.from({ length: count }, (_, index) => ({
    key: role === 'USER' ? `personal-${index + 1}` : `business-${index + 1}`,
    role,
    username: `qa${index + 1}@example.invalid`,
    password: 'super-secret-value',
    userType: role === 'USER' ? 'PERSONAL' : 'BUSINESS_M',
  }));
}

const poolOf = (count: number): AccountPool => AccountPool.fromPrincipals(fakePrincipals(count));

test.describe('account pool: inventory @framework', () => {
  test('inventory comes from configured principals, not a constant', () => {
    expect(poolOf(6).inventory()).toHaveLength(6);
    expect(poolOf(10).inventory()).toHaveLength(10);
    expect(poolOf(20).inventory()).toHaveLength(20);
    // Growing the inventory needs no code change here — that is the whole point.
    expect(poolOf(20).capacityFor(4)).toBe(5);
  });

  test('only PERSONAL user accounts are session accounts; business tiers are named', () => {
    const pool = AccountPool.fromPrincipals([
      ...fakePrincipals(2),
      ...fakePrincipals(1, 'COMPANY_ADMIN'),
    ]);
    expect(pool.inventory()).toEqual(['personal-1', 'personal-2']);
    expect(pool.named('business-1').role).toBe('COMPANY_ADMIN');
  });

  test('an unavailable named account fails clearly — a configuration gap, not a defect', () => {
    const pool = poolOf(2);
    expect(() => pool.named('business-m')).toThrow(AccountPoolError);
    expect(() => pool.named('business-m')).toThrow(/No configured account with key "business-m"/);
    expect(() => pool.named('business-m')).toThrow(/configuration gap, not a defect/);
    expect(pool.has('business-m')).toBe(false);
  });

  test('an empty inventory refuses rather than handing out nothing', () => {
    expect(() => AccountPool.fromPrincipals([]).slot(0, 1)).toThrow(AccountPoolError);
  });
});

test.describe('account pool: slot allocation @framework', () => {
  test('slot 0 and slot 1 resolve deterministically and never overlap', () => {
    const pool = poolOf(6);
    const slot0 = pool.slot(0, 3);
    const slot1 = pool.slot(1, 3);

    expect(slot0.keys()).toEqual(['personal-1', 'personal-2', 'personal-3']);
    expect(slot1.keys()).toEqual(['personal-4', 'personal-5', 'personal-6']);

    const overlap = slot0.keys().filter((key) => slot1.keys().includes(key));
    expect(overlap, 'slot 0 ∩ slot 1 must be empty').toEqual([]);
  });

  test('every supported slot pair is disjoint, for every partition size', () => {
    const pool = poolOf(12);
    for (const size of [1, 2, 3, 4, 6]) {
      const slots = Array.from({ length: pool.capacityFor(size) }, (_, index) =>
        pool.slot(index, size).keys(),
      );
      const seen = new Set<string>();
      for (const keys of slots) {
        for (const key of keys) {
          expect(seen.has(key), `"${key}" handed to two slots at size ${size}`).toBe(false);
          seen.add(key);
        }
      }
    }
  });

  test('the same slot always receives the same accounts', () => {
    const pool = poolOf(6);
    expect(pool.slot(1, 2).keys()).toEqual(pool.slot(1, 2).keys());
    expect(poolOf(6).slot(1, 2).keys()).toEqual(pool.slot(1, 2).keys());
  });

  test('asking for a position the slot does not own fails clearly', () => {
    const slot = poolOf(6).slot(0, 2);
    expect(() => slot.session(2)).toThrow(AccountPoolError);
    expect(() => slot.session(2)).toThrow(/owns 2 session account\(s\)/);
    expect(() => slot.principals(3)).toThrow(/3 requested/);
  });

  test('a negative or non-integer slot index is refused', () => {
    expect(() => poolOf(6).slot(-1, 2)).toThrow(/non-negative integer/);
    expect(() => poolOf(6).slot(1.5, 2)).toThrow(/non-negative integer/);
  });
});

test.describe('account pool: capacity @framework', () => {
  test('capacity is floor(inventory / accounts-per-slot)', () => {
    expect(poolOf(6).capacityFor(4)).toBe(1);
    expect(poolOf(6).capacityFor(3)).toBe(2);
    expect(poolOf(6).capacityFor(2)).toBe(3);
    expect(poolOf(10).capacityFor(4)).toBe(2);
    expect(poolOf(20).capacityFor(4)).toBe(5);
  });

  test('over-capacity is REFUSED with the arithmetic — never silently clamped', () => {
    const pool = poolOf(6);
    expect(() => pool.assertCapacity(4, 4)).toThrow(AccountPoolError);
    expect(() => pool.assertCapacity(4, 4)).toThrow(/Account capacity exceeded/);
    expect(() => pool.assertCapacity(4, 4)).toThrow(/Requested logical slots: 4/);
    expect(() => pool.assertCapacity(4, 4)).toThrow(/Configured account capacity: 1/);
    expect(() => pool.assertCapacity(4, 4)).toThrow(/refused to prevent session collision/);
  });

  test('a slot beyond capacity is refused rather than wrapping around to slot 0', () => {
    const pool = poolOf(6);
    expect(() => pool.slot(2, 4)).toThrow(/Account capacity exceeded/);
    // The dangerous alternative would be silently reusing slot 0's accounts.
    expect(pool.slot(0, 4).keys()).not.toEqual([]);
  });

  test('supported capacity succeeds at each documented inventory size', () => {
    expect(poolOf(6).slot(0, 4).keys()).toHaveLength(4);
    expect(poolOf(10).slot(1, 4).keys()).toHaveLength(4);
    expect(poolOf(20).slot(4, 4).keys()).toHaveLength(4);
  });
});

test.describe('account pool: slot identity @framework', () => {
  test('the slot comes from TEST_PARALLEL_INDEX, not the worker index', () => {
    expect(currentSlotIndex({ TEST_PARALLEL_INDEX: '2' })).toBe(2);
    // A replaced worker keeps its slot: workerIndex must not decide ownership.
    expect(currentSlotIndex({ TEST_PARALLEL_INDEX: '1', TEST_WORKER_INDEX: '9' })).toBe(1);
    expect(currentSlotIndex({ TEST_WORKER_INDEX: '9' }), 'no parallel index → slot 0').toBe(0);
    expect(currentSlotIndex({})).toBe(0);
    expect(currentSlotIndex({ TEST_PARALLEL_INDEX: 'nonsense' })).toBe(0);
  });

  test('neither the run id nor a timestamp takes part in ownership', () => {
    const before = poolOf(6).slot(0, 2).keys();
    process.env.TEST_RUN_ID = 'run-a-different-one';
    const after = poolOf(6).slot(0, 2).keys();
    expect(after).toEqual(before);
  });
});

test.describe('account pool: credential safety @framework', () => {
  test('a serialized account carries no password and no username', () => {
    const account = poolOf(2).slot(0, 1).session(0);
    const serialized = JSON.stringify(account);
    expect(serialized).not.toContain('super-secret-value');
    expect(serialized).not.toContain('@example.invalid');
    expect(JSON.parse(serialized)).toEqual({
      key: 'personal-1',
      role: 'USER',
      userType: 'PERSONAL',
    });
  });

  test('a serialized slot lists keys only', () => {
    const slot = poolOf(6).slot(0, 3);
    const serialized = JSON.stringify(slot);
    expect(serialized).not.toContain('super-secret-value');
    expect(JSON.parse(serialized)).toEqual({
      slot: 0,
      accounts: ['personal-1', 'personal-2', 'personal-3'],
    });
  });

  test('spreading an account does not copy its credentials out', () => {
    const account = poolOf(2).slot(0, 1).session(0);
    expect(JSON.stringify({ ...account })).not.toContain('super-secret-value');
    // …while the executor can still reach them deliberately.
    expect(account.principal.password).toBe('super-secret-value');
  });

  test('pool errors name accounts by key and never quote a credential', () => {
    const pool = poolOf(2);
    const message = (() => {
      try {
        pool.assertCapacity(9, 2);
        return '';
      } catch (error) {
        return (error as Error).message;
      }
    })();
    expect(message).toContain('Account capacity exceeded');
    expect(message).not.toContain('super-secret-value');
    expect(message).not.toContain('@example.invalid');
  });

  test('an account-pool failure is a distinct, non-application error type', () => {
    // §19: a capacity/configuration failure must never read as an endpoint defect.
    const error = new AccountPoolError('x');
    expect(error.name).toBe('AccountPoolError');
    expect(error).toBeInstanceOf(Error);
  });
});

test.describe('account pool: backward compatibility @framework', () => {
  test('slot 0 resolves to exactly the accounts the migrated specs used before', () => {
    /*
     * The compatibility contract. Katchup used personal/victim/personal-3/personal-4 and Kall used
     * the first three; both now ask the pool. If this order ever changes, a live lifecycle would
     * silently start driving different accounts — so it is pinned here.
     */
    const configured = AUTH_PROFILES.kpost.principals
      .filter((p) => p.role === 'USER' && (p.userType ?? 'PERSONAL') === 'PERSONAL')
      .map((p) => p.key);
    const expected = configured.slice(0, 4);
    expect(accountPool.slot(0, 4).keys()).toEqual(expected);
    expect(accountPool.slot(0, 3).keys()).toEqual(expected.slice(0, 3));
  });

  test('the legacy principal lookup and slot 0 agree, account for account', () => {
    const legacy = (key: string): Principal | undefined =>
      AUTH_PROFILES.kpost.principals.find((p) => p.key === key);
    const slot0 = accountPool.slot(0, 4);
    for (const [position, account] of slot0.sessions.entries()) {
      expect(account.principal, `position ${position}`).toBe(legacy(account.key));
    }
  });

  test('currentSlot() uses this process’ slot and the profile-declared size', () => {
    const slot = currentSlot();
    expect(slot.index).toBe(currentSlotIndex());
    expect(slot.keys().length).toBeGreaterThan(0);
    expect(slot.keys()).toEqual(accountPool.slot(slot.index, slot.size).keys());
  });
});

// ---------------------------------------------------------------------------------------------
// Lazy resolution (Phase 4I-B) — allocation unchanged, the REQUEST deferred to first use
// ---------------------------------------------------------------------------------------------

test.describe('account pool: lazy principals @framework', () => {
  /*
   * Playwright imports every spec in a project's testDir before `--grep` selects any of them, so
   * failable work at module scope breaks the run for the specs that WERE selected. Resolving four
   * session accounts at the top of the Katchup spec collapsed the whole `kmail` profile — which
   * allocates two, correctly, because two is what KMail needs — with
   * `AccountPoolError: Slot 0 owns 2 session account(s); 4 requested`.
   *
   * These pin the repair's two halves: nothing is requested until a test touches a principal, and
   * when it does, it gets exactly what an eager `currentSlot().principals(n)` would have given it.
   */

  test('nothing is requested until a principal is actually used', () => {
    let calls = 0;
    const principals = lazyPrincipals((count) => {
      calls += 1;
      return fakePrincipals(count);
    }, 3);

    expect(calls, 'creating the views resolves nothing').toBe(0);
    expect(principals).toHaveLength(3);
    expect(principals[0]?.key, 'the first read resolves').toBe('personal-1');
    expect(calls).toBe(1);
  });

  test('one resolution is shared by every view, however many are read', () => {
    let calls = 0;
    const principals = lazyPrincipals((count) => {
      calls += 1;
      return fakePrincipals(count);
    }, 4);

    expect(principals.map((principal) => principal.key)).toEqual([
      'personal-1',
      'personal-2',
      'personal-3',
      'personal-4',
    ]);
    expect(calls, 'four principals, one slot request').toBe(1);
  });

  test('a view is indistinguishable from the principal it stands for', () => {
    // The executor reads fields, spreads and stringifies principals; all three must be unchanged.
    const [real] = fakePrincipals(1);
    const [view] = lazyPrincipals(() => fakePrincipals(1), 1);

    expect(view?.username).toBe(real?.username);
    expect(Object.keys(view as object).sort()).toEqual(Object.keys(real as object).sort());
    expect({ ...(view as object) }).toEqual({ ...(real as object) });
    expect(JSON.stringify(view)).toBe(JSON.stringify(real));
    expect('password' in (view as object)).toBe(true);
  });

  test('a shared principal cannot be mutated through a view', () => {
    const [view] = lazyPrincipals(() => fakePrincipals(1), 1);
    // Non-strict assignment through a `set` trap returning false throws in ESM/strict code.
    expect(() => {
      (view as unknown as Record<string, unknown>).password = 'tampered';
    }).toThrow();
    expect(view?.password).toBe('super-secret-value');
  });

  test('an under-capacity slot still fails — at use, with the pool’s own message', () => {
    const principals = lazyPrincipals(
      (count) => AccountPool.fromPrincipals(fakePrincipals(2)).slot(0, 2).principals(count),
      4,
    );
    // Deferred, not softened: creating the views is silent, reading one raises the real error.
    expect(() => principals[0]?.key).toThrow(AccountPoolError);
    expect(() => principals[0]?.key).toThrow(/Slot 0 owns 2 session account\(s\); 4 requested/);
  });

  test('slotPrincipals allocates exactly what currentSlot().principals would', () => {
    const eager = currentSlot().principals(2);
    const lazy = slotPrincipals(2);
    expect(lazy.map((principal) => principal.key)).toEqual(eager.map((principal) => principal.key));
    expect(lazy.map((principal) => principal.username)).toEqual(
      eager.map((principal) => principal.username),
    );
  });

  test('a nonsensical count fails immediately, not at first use', () => {
    expect(() => lazyPrincipals(() => [], 0)).toThrow(/positive integer/);
    expect(() => lazyPrincipals(() => [], 1.5)).toThrow(/positive integer/);
  });
});
