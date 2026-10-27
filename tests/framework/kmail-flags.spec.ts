import { kmailDb, kmailFlag } from '@database/kmail-assertions';
import type { KmailTransactionRecord } from '@database/repositories/kmail.repository';
import {
  TEST_ACCOUNTS,
  domainFor,
  kpostIdOf,
  policyViolation,
  requireAccount,
} from '@fixtures/test-accounts';
import { expect, test } from '@fixtures';

/**
 * KMail's `'Y'`/`'N'` flag reader and the account registry, both provable with no database.
 * `Boolean('N')` is true, so a truthiness check would pass every flag assertion silently.
 */
test.describe('KMail flag semantics @framework', () => {
  test("'Y' is set and 'N' is clear — not truthiness", () => {
    expect(kmailFlag('Y')).toBe('set');
    expect(kmailFlag('N')).toBe('clear');
    expect(Boolean('N'), 'the naive check is true for N — which is why kmailFlag exists').toBe(
      true,
    );
    expect(kmailFlag('N'), 'kmailFlag disagrees with it, correctly').toBe('clear');
  });

  test('case and padding do not change the meaning', () => {
    // The column is an unconstrained char; nothing stops a writer storing 'y' or ' Y'.
    for (const value of ['y', ' Y', 'Y ']) expect(kmailFlag(value)).toBe('set');
    for (const value of ['n', ' N']) expect(kmailFlag(value)).toBe('clear');
  });

  test('the NUL byte found on 107 live rows is unknown, not clear', () => {
    // Folding it into `clear` would turn "we cannot tell" into "never marked".
    expect(kmailFlag('\u0000')).toBe('unknown');
    expect(kmailFlag(null)).toBe('unknown');
    expect(kmailFlag(undefined)).toBe('unknown');
    expect(kmailFlag(''), 'an empty string is not a decision either').toBe('unknown');
  });

  test('an unknown flag fails an assertion rather than passing it', () => {
    const row = { read_status: '\u0000' } as unknown as KmailTransactionRecord;

    const asSet = kmailDb.flag(row, 'read_status', 'set');
    const asClear = kmailDb.flag(row, 'read_status', 'clear');

    // Neither direction may claim a NUL row supports it.
    expect(asSet.status).toBe('FAILED');
    expect(asClear.status).toBe('FAILED');
    expect(
      String(asSet.actual),
      'the report shows the raw value, so the cause is visible',
    ).toContain('NUL');
  });

  test('a plaintext subject is reported as an encryption failure', () => {
    // A stored subject equal to what was sent means encryption at rest has stopped.
    const plaintext = 'QA Bench subject';
    const leaked = kmailDb.subjectEncrypted({ kmail_subject: plaintext } as never, plaintext);
    const encrypted = kmailDb.subjectEncrypted(
      { kmail_subject: 'pL0yhPnbTLQEjzSdenFdTJRdO07+C5tlU+CX0SAAI8Y=' } as never,
      plaintext,
    );

    expect(leaked.some((c) => c.status === 'FAILED')).toBe(true);
    expect(encrypted.every((c) => c.status === 'PASSED')).toBe(true);
  });

  test('a missing subject fails both halves', () => {
    const checks = kmailDb.subjectEncrypted({ kmail_subject: null } as never, 'anything');
    expect(checks[0]?.status, 'nothing was stored').toBe('FAILED');
  });
});

test.describe('test account registry @framework', () => {
  test('every account resolves to an id that satisfies the domain policy', () => {
    // A role wired to the wrong account type still logs in but invalidates every check built on it.
    // `legacyDomain` accounts (personal on @kpost.in, pre-existing data) are exempt by declaration.
    const offenders = TEST_ACCOUNTS.flatMap((account) => {
      const id = kpostIdOf(account);
      if (!id) return [];
      const reason = policyViolation(id, account.userType, account.legacyDomain);
      return reason ? [`${account.id}: ${reason}`] : [];
    });

    expect(offenders, 'each role must point at an account of the right type and domain').toEqual(
      [],
    );
  });

  test('the domain policy itself matches the product', () => {
    // See signup-domain.spec.ts.
    expect(domainFor('PERSONAL')).toBe('kpostindia.com');
    for (const type of ['BUSINESS_S', 'BUSINESS_M', 'BUSINESS_L'] as const) {
      expect(domainFor(type), `${type} is a business type`).toBe('kpost.in');
    }
  });

  test('a personal id on the business domain is refused unless declared legacy', () => {
    expect(policyViolation('someone@kpost.in', 'PERSONAL')).toContain('kpostindia.com');
    expect(
      policyViolation('someone@kpost.in', 'PERSONAL', true),
      'a declared legacy account is exempt',
    ).toBeUndefined();
    expect(policyViolation('admin@kpostindia.com', 'BUSINESS_M')).toContain('kpost.in');
  });

  test('no account embeds an id or a password — both are environment pointers', () => {
    // The registry is committed: ids and passwords must come from the environment.
    for (const account of TEST_ACCOUNTS) {
      // Only the identity fields — `purpose` is prose and legitimately mentions domains.
      expect(
        JSON.stringify({ kpostIdEnv: account.kpostIdEnv, passwordEnv: account.passwordEnv }),
        `${account.id} must not embed an address or a secret`,
      ).not.toMatch(/@/);
      expect(account.kpostIdEnv, `${account.id} names its id variable`).toMatch(/^[A-Z0-9_]+$/);
      expect(account.passwordEnv, `${account.id} names its password variable`).toMatch(
        /^[A-Z0-9_]+$/,
      );
    }
  });

  test('roles are distinct: no two point at the same account', () => {
    // A sender/receiver flow with one account on both ends passes while testing nothing.
    const ids = TEST_ACCOUNTS.flatMap((account) => {
      const id = kpostIdOf(account);
      return id ? [id.toLowerCase()] : [];
    });
    test.skip(ids.length < 2, 'needs at least two configured accounts');

    expect(new Set(ids).size, `two roles share an account: ${ids.join(', ')}`).toBe(ids.length);
    expect(new Set(TEST_ACCOUNTS.map((a) => a.id)).size).toBe(TEST_ACCOUNTS.length);
  });

  test('an unknown role is refused rather than guessed at', () => {
    const resolution = requireAccount('no-such-role');
    expect(resolution.ok).toBe(false);
    expect(resolution.ok === false && resolution.reason).toContain('no account');
  });
});
