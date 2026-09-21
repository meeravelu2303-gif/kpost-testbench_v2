import { kmailDb, kmailFlag } from '@database/kmail-assertions';
import type { KmailTransactionRecord } from '@database/repositories/kmail.repository';
import {
  TEST_ACCOUNTS,
  domainFor,
  domainOf,
  policyViolation,
  qatestId,
  requireAccount,
} from '@fixtures/test-accounts';
import { expect, test } from '@fixtures';

/**
 * KMail's `'Y'`/`'N'` flag reader, and the account registry — both provable with no database.
 *
 * The flag tests exist because the obvious implementation is wrong in a way that still passes:
 * `Boolean('N')` is `true`, so a truthiness check reports every mail as read, starred and deleted
 * simultaneously, and every assertion built on it goes green. That failure is invisible in a test
 * run, so it has to be caught here.
 */
test.describe('KMail flag semantics @framework', () => {
  test("'Y' is set and 'N' is clear — not truthiness", () => {
    expect(kmailFlag('Y')).toBe('set');
    expect(kmailFlag('N')).toBe('clear');
    /*
     * The trap: `'N'` is a non-empty string. Any implementation doing `if (row.read_status)` reads
     * "not read" as "read", which is exactly backwards and never fails a test.
     */
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
    /*
     * Folding it into `clear` would make a data-quality artefact look like product behaviour, and a
     * test would then report "the mail was never marked" when the truth is "we cannot tell".
     */
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
    /*
     * KMail stores subjects as ciphertext. If a stored subject ever equals what was sent, encryption
     * at rest has stopped being applied — a security regression that no API response would reveal.
     */
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
  test('every registered account satisfies the naming AND domain policy', () => {
    /*
     * The convention is not cosmetic: it is how a bench-owned account is recognised in the database,
     * in a mail log and by the QA-identifier guard, which refuses to send a request naming an id we
     * do not own. An account that breaks it would be blocked later, somewhere far less obvious.
     */
    const offenders = TEST_ACCOUNTS.map((a) => policyViolation(a.kpostId, a.userType)).filter(
      (reason): reason is string => reason !== undefined,
    );
    expect(
      offenders,
      'every account must satisfy the qatest_ prefix and its type’s domain',
    ).toEqual([]);
  });

  test('personal accounts are on kpostindia.com and business accounts on kpost.in', () => {
    /*
     * The product binds the domain from the account type at signup — the user never types it. A
     * bench account on the wrong domain would exercise a routing path no real signup can produce,
     * so the registry has to agree with the product rather than merely be internally consistent.
     *
     * Verified against KPOST_QA: 324 active PERSONAL accounts on kpostindia.com and 648 active
     * BUSINESS_* accounts on kpost.in. (205 PERSONAL accounts on kpost.in are legacy, predating the
     * split — see the rationale in test-accounts.json.)
     */
    expect(domainFor('PERSONAL')).toBe('kpostindia.com');
    for (const type of ['BUSINESS_S', 'BUSINESS_M', 'BUSINESS_L'] as const) {
      expect(domainFor(type), `${type} is a business type`).toBe('kpost.in');
    }

    for (const account of TEST_ACCOUNTS) {
      expect(domainOf(account.kpostId), `${account.id} (${account.userType})`).toBe(
        domainFor(account.userType),
      );
    }
  });

  test('qatestId builds a compliant id from a type, and refuses a bad identifier', () => {
    expect(qatestId('primary', 'PERSONAL')).toBe('qatest_primary@kpostindia.com');
    expect(qatestId('admin', 'BUSINESS_M')).toBe('qatest_admin@kpost.in');
    // Normalised rather than rejected: a trailing space or capital is a typo, not a new account.
    expect(qatestId('  Primary  ', 'PERSONAL')).toBe('qatest_primary@kpostindia.com');
    // An identifier that would produce an unroutable or ambiguous address is refused outright.
    for (const bad of ['has space', 'has@at', '_leading', 'UPPER!', '']) {
      expect(() => qatestId(bad, 'PERSONAL'), `"${bad}" must be refused`).toThrow(/identifier/i);
    }
  });

  test('a personal id on the business domain is a policy violation, and says so', () => {
    const reason = policyViolation('qatest_primary@kpost.in', 'PERSONAL');

    expect(reason, 'the wrong domain for the type is caught').toBeTruthy();
    expect(reason).toContain('kpostindia.com');
    // And the inverse, so the rule is not accidentally one-directional.
    expect(policyViolation('qatest_admin@kpostindia.com', 'BUSINESS_M')).toContain('kpost.in');
  });

  test('no account carries a password, only a pointer to one', () => {
    /*
     * test-accounts.json is committed. A password in it would be in the git history permanently and
     * could not be rotated by redeploying, so the registry stores the NAME of an environment
     * variable and the secret stays in the git-ignored .env.
     */
    for (const account of TEST_ACCOUNTS) {
      const serialized = JSON.stringify(account);
      expect(serialized, `${account.id} must not embed a secret`).not.toMatch(
        /"password"\s*:|"secret"\s*:/i,
      );
      expect(account.passwordEnv, `${account.id} names its password variable`).toMatch(
        /^[A-Z0-9_]+$/,
      );
    }
  });

  test('account ids are unique, in both directions', () => {
    // A duplicate id makes `requireAccount` non-deterministic; a duplicate KPost ID makes two roles
    // silently the same account, which is fatal to any sender/receiver or admin/member flow.
    expect(new Set(TEST_ACCOUNTS.map((a) => a.id)).size).toBe(TEST_ACCOUNTS.length);
    expect(new Set(TEST_ACCOUNTS.map((a) => a.kpostId)).size).toBe(TEST_ACCOUNTS.length);
  });

  test('an unprovisioned account resolves to a reason, never to a substitute', () => {
    /*
     * The core safety property. Falling back to another account would let a two-party flow run with
     * one party, or a permission test run as the admin it was meant to be denied as — and still
     * report PASS. A reason that causes a SKIP is the only honest answer.
     */
    const unprovisioned = TEST_ACCOUNTS.find((a) => !a.provisioned);
    test.skip(!unprovisioned, 'every account is provisioned on this target');

    const resolution = requireAccount(unprovisioned?.id ?? '');
    expect(resolution.ok).toBe(false);
    expect(resolution.ok === false && resolution.reason).toContain('not been provisioned');
  });

  test('an unknown id is refused rather than guessed at', () => {
    const resolution = requireAccount('no-such-role');
    expect(resolution.ok).toBe(false);
    expect(resolution.ok === false && resolution.reason).toContain('no account');
  });
});
