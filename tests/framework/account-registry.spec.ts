import { ROOT_DIR } from '@config/constants';
import { expect, test } from '@fixtures';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  AccountRegistry,
  FORBIDDEN_ACCOUNT_KEYS,
  InMemoryAccountStore,
  TEST_ACCOUNT_STATUSES,
  TestAccountError,
  assertNoSecrets,
  assertSameEnvironment,
  canTransition,
  environmentOf,
  matchesEnvironment,
  parseAccountLines,
  type AccountRegistration,
} from '../../src/test-data/accounts/index';
import { assessSignup, availabilityFromExistCheck } from '../../src/signup/index';

/**
 * Guards for Phase 4D Part B — the Test Bench account registry.
 *
 * Entirely offline: every registry below is backed by an in-memory store, so nothing touches disk
 * and nothing contacts KPOST.
 *
 * The two that matter most: a credential can never be persisted, and a signup that was not actually
 * confirmed can never produce a record.
 */

const ENV = 'testingapi.kpostindia.com';
const OTHER_ENV = 'staging.example.invalid';

const registration = (overrides: Partial<AccountRegistration> = {}): AccountRegistration => ({
  kpostId: 'qabench001@kpostindia.com',
  environment: ENV,
  source: 'signup',
  verified: true,
  verificationNote: 'kpostIdExist: available before, taken after',
  signupFlowId: 'otp-signup-personal',
  userType: 'PERSONAL',
  role: 'USER',
  ...overrides,
});

const freshRegistry = (): AccountRegistry => new AccountRegistry(new InMemoryAccountStore());

const SOURCES = [
  'account-record.ts',
  'account-registry.ts',
  'account-store.ts',
  'environment.ts',
  'index.ts',
] as const;
const source = (file: string): string =>
  readFileSync(path.join(ROOT_DIR, 'src', 'test-data', 'accounts', file), 'utf8');

const FORBIDDEN_IMPORTS = [
  'bug-tracker',
  'failure-analysis',
  'reporting',
  'validators',
  'validation-engine',
  'playwright',
  'state-observation',
  'state-calibration',
  '/states',
  'api/client',
  'api/definitions',
  'flows',
] as const;

// ---------------------------------------------------------------------------------------------
// 1. Registration
// ---------------------------------------------------------------------------------------------

test.describe('account registry: registration @framework', () => {
  test('a confirmed account is recorded with its metadata', () => {
    const registry = freshRegistry();
    const record = registry.register(registration());

    expect(record.accountId).toMatch(/^tba-\d{5}$/);
    expect(record.kpostId).toBe('qabench001@kpostindia.com');
    expect(record.environment).toBe(ENV);
    expect(record.status).toBe('CREATED');
    expect(record.createdBy).toBe('test-bench');
    expect(record.source).toBe('signup');
    expect(record.verified).toBe(true);
    expect(record.usageCount).toBe(0);
    expect(record.createdAt).toBeTruthy();
  });

  test('an account needs an identity and an environment', () => {
    const registry = freshRegistry();
    expect(() => registry.register(registration({ kpostId: '  ' }))).toThrow(TestAccountError);
    expect(() => registry.register(registration({ environment: '' }))).toThrow(TestAccountError);
  });

  test('registering the same account twice is idempotent', () => {
    const registry = freshRegistry();
    const first = registry.register(registration());
    const second = registry.register(registration({ signupFlowId: 'a-different-flow' }));

    // Same record returned, no second row — signup is not repeatable on this product, so a
    // duplicate row would be two records of one real account.
    expect(second.accountId).toBe(first.accountId);
    expect(registry.all()).toHaveLength(1);
  });

  test('identity is case-insensitive and trimmed', () => {
    const registry = freshRegistry();
    registry.register(registration());
    registry.register(registration({ kpostId: '  QABench001@KPOSTINDIA.COM ' }));
    expect(registry.all()).toHaveLength(1);
  });

  test('the same id on a different environment is a different account', () => {
    const registry = freshRegistry();
    registry.register(registration());
    registry.register(registration({ environment: OTHER_ENV }));
    expect(registry.all()).toHaveLength(2);
    expect(registry.listByEnvironment(ENV)).toHaveLength(1);
    expect(registry.listByEnvironment(OTHER_ENV)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------------------------
// 2. Retrieval
// ---------------------------------------------------------------------------------------------

test.describe('account registry: retrieval @framework', () => {
  test('accounts are findable by id, identity and address', () => {
    const registry = freshRegistry();
    const record = registry.register(registration({ email: 'contact@example.invalid' }));

    expect(registry.get(record.accountId)?.kpostId).toBe(record.kpostId);
    expect(registry.findByKpostId(ENV, 'qabench001@kpostindia.com')?.accountId).toBe(
      record.accountId,
    );
    expect(registry.findByEmail('contact@example.invalid')).toHaveLength(1);
    // The kpostId doubles as the address on this product, so it matches too.
    expect(registry.findByEmail('qabench001@kpostindia.com')).toHaveLength(1);
    expect(registry.get('tba-99999')).toBeUndefined();
  });

  test('finding by identity requires the environment', () => {
    const registry = freshRegistry();
    registry.register(registration());
    expect(registry.findByKpostId(OTHER_ENV, 'qabench001@kpostindia.com')).toBeUndefined();
  });

  test('listActive returns only ACTIVE, verified accounts', () => {
    const registry = freshRegistry();
    const a = registry.register(registration());
    const b = registry.register(registration({ kpostId: 'qabench002@kpostindia.com' }));
    const unverified = registry.register(
      registration({ kpostId: 'qabench003@kpostindia.com', verified: false }),
    );

    expect(registry.listActive()).toEqual([]); // all still CREATED
    registry.updateStatus(a.accountId, 'ACTIVE');
    registry.updateStatus(b.accountId, 'ACTIVE');
    registry.updateStatus(unverified.accountId, 'ACTIVE');

    const active = registry.listActive().map((r) => r.kpostId);
    expect(active).toEqual(['qabench001@kpostindia.com', 'qabench002@kpostindia.com']);
    // An unconfirmed account is never handed out for reuse.
    expect(active).not.toContain('qabench003@kpostindia.com');
    expect(registry.unverified()).toHaveLength(1);
  });

  test('accounts are listable by role and environment', () => {
    const registry = freshRegistry();
    registry.register(registration());
    registry.register(registration({ kpostId: 'admin1@kpostindia.com', role: 'COMPANY_ADMIN' }));
    expect(registry.listByRole('USER')).toHaveLength(1);
    expect(registry.listByRole('COMPANY_ADMIN')).toHaveLength(1);
    expect(registry.listByRole('USER', OTHER_ENV)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------------------------
// 3. Lifecycle
// ---------------------------------------------------------------------------------------------

test.describe('account registry: lifecycle @framework', () => {
  test('the lifecycle vocabulary is its own, not borrowed', () => {
    expect([...TEST_ACCOUNT_STATUSES]).toEqual([
      'CREATED',
      'ACTIVE',
      'LOCKED',
      'DISABLED',
      'CLEANUP_PENDING',
      'CLEANED',
      'RETIRED',
    ]);
    // Never a flow, validation or application state.
    for (const foreign of ['PASSED', 'FAILED', 'BLOCKED', 'NOT_EXECUTED', 'Read', 'Sent']) {
      expect([...TEST_ACCOUNT_STATUSES], foreign).not.toContain(foreign);
    }
  });

  test('an account walks CREATED → ACTIVE → CLEANUP_PENDING → CLEANED', () => {
    const registry = freshRegistry();
    const record = registry.register(registration());
    expect(registry.updateStatus(record.accountId, 'ACTIVE').status).toBe('ACTIVE');
    expect(registry.updateStatus(record.accountId, 'CLEANUP_PENDING').status).toBe(
      'CLEANUP_PENDING',
    );
    expect(registry.updateStatus(record.accountId, 'CLEANED').status).toBe('CLEANED');
  });

  test('RETIRED is distinct from CLEANED, and records why', () => {
    const registry = freshRegistry();
    const record = registry.register(registration());
    const retired = registry.retire(record.accountId, 'KPOST exposes no signup-account deletion');

    expect(retired.status).toBe('RETIRED');
    expect(retired.retiredAt).toBeTruthy();
    expect(retired.statusReason).toContain('no signup-account deletion');
    // RETIRED means "we will not use it again"; it does NOT claim the account is gone.
    expect(retired.status).not.toBe('CLEANED');
  });

  test('a terminal state is terminal, and an illegal move is refused', () => {
    const registry = freshRegistry();
    const record = registry.register(registration());
    registry.retire(record.accountId, 'done');
    expect(() => registry.updateStatus(record.accountId, 'ACTIVE')).toThrow(TestAccountError);
    expect(canTransition('CLEANED', 'ACTIVE')).toBe(false);
    expect(canTransition('CREATED', 'ACTIVE')).toBe(true);
  });

  test('usage is counted', () => {
    const registry = freshRegistry();
    const record = registry.register(registration());
    registry.markUsed(record.accountId);
    const used = registry.markUsed(record.accountId);
    expect(used.usageCount).toBe(2);
    expect(used.lastUsedAt).toBeTruthy();
  });

  test('an unknown account cannot be updated', () => {
    expect(() => freshRegistry().markUsed('tba-00000')).toThrow(TestAccountError);
  });
});

// ---------------------------------------------------------------------------------------------
// 4. Security — no secret may ever be persisted
// ---------------------------------------------------------------------------------------------

test.describe('account registry: secret protection @framework', () => {
  test('a secret-shaped field is refused at the write boundary', () => {
    const registry = freshRegistry();
    for (const key of ['password', 'accessToken', 'refresh_token', 'sessionCookie', 'otp']) {
      expect(() => registry.register({ ...registration(), [key]: 'super-secret' }), key).toThrow(
        TestAccountError,
      );
    }
  });

  test('every forbidden key is rejected however it is spelled', () => {
    for (const key of FORBIDDEN_ACCOUNT_KEYS) {
      expect(() => assertNoSecrets({ [key]: 'x' }), key).toThrow(TestAccountError);
      expect(() => assertNoSecrets({ [key.toUpperCase()]: 'x' }), key).toThrow(TestAccountError);
    }
    expect(() => assertNoSecrets({ API_KEY: 'x' })).toThrow(TestAccountError);
    expect(() => assertNoSecrets({ kpostId: 'fine', environment: 'fine' })).not.toThrow();
  });

  test('the persisted form carries identity only', () => {
    const store = new InMemoryAccountStore();
    const registry = new AccountRegistry(store);
    registry.register(registration());
    const persisted = store.load();

    /*
     * Checked as KEYS, not as substrings of the serialised blob. A substring scan is wrong here and
     * misleadingly so: `signupFlowId: 'otp-signup-personal'` legitimately contains "otp", and a
     * guard that failed on it would train the next person to weaken the guard rather than the code.
     */
    for (const record of persisted) {
      for (const key of Object.keys(record)) {
        const normalised = key.toLowerCase().replace(/[-_]/g, '');
        expect(
          FORBIDDEN_ACCOUNT_KEYS.map((k) => k.replace(/[-_]/g, '')),
          key,
        ).not.toContain(normalised);
      }
    }
    // No credential VALUE reached the file either.
    expect(JSON.stringify(persisted)).not.toContain('super-secret');
    // Identity IS present — that is the point of the registry.
    expect(JSON.stringify(persisted)).toContain('qabench001@kpostindia.com');
  });
});

// ---------------------------------------------------------------------------------------------
// 5. Signup integration — confirmation, never a status code
// ---------------------------------------------------------------------------------------------

test.describe('account registry: signup confirmation @framework', () => {
  test('a confirmed creation registers', () => {
    const assessment = assessSignup({
      signupStatus: 200,
      availabilityBefore: 'AVAILABLE',
      availabilityAfter: 'TAKEN',
    });
    expect(assessment.outcome).toBe('CONFIRMED');
    expect(assessment.shouldRegister).toBe(true);

    const registry = freshRegistry();
    registry.register(registration({ verified: assessment.shouldRegister }));
    expect(registry.all()).toHaveLength(1);
  });

  test('a 2xx alone is NOT enough', () => {
    const assessment = assessSignup({
      signupStatus: 200,
      availabilityBefore: 'AVAILABLE',
      availabilityAfter: 'AVAILABLE',
    });
    expect(assessment.outcome).toBe('AMBIGUOUS');
    expect(assessment.shouldRegister).toBe(false);
    expect(assessment.reason).toContain('still reported available');
  });

  test('no failure path ever registers', () => {
    const cases = [
      { label: '500', input: { signupStatus: 500 } },
      { label: '400', input: { signupStatus: 400 } },
      { label: 'transport', input: { signupStatus: 0, transportFailed: true } },
      { label: 'unknown-after', input: { signupStatus: 200, availabilityAfter: 'UNKNOWN' } },
    ] as const;

    for (const { label, input } of cases) {
      const assessment = assessSignup({
        availabilityBefore: 'AVAILABLE',
        availabilityAfter: 'UNKNOWN',
        ...input,
      });
      expect(assessment.shouldRegister, label).toBe(false);
      expect(['AMBIGUOUS', 'REJECTED'], label).toContain(assessment.outcome);
    }
  });

  test('a pre-existing id is never claimed as ours', () => {
    const assessment = assessSignup({
      signupStatus: 200,
      availabilityBefore: 'TAKEN',
      availabilityAfter: 'TAKEN',
    });
    expect(assessment.outcome).toBe('ALREADY_EXISTS');
    expect(assessment.shouldRegister).toBe(false);
  });

  test('the availability check reads the product’s own answers', () => {
    expect(availabilityFromExistCheck(200)).toBe('AVAILABLE');
    expect(availabilityFromExistCheck(400)).toBe('TAKEN');
    expect(availabilityFromExistCheck(500)).toBe('UNKNOWN');
  });
});

// ---------------------------------------------------------------------------------------------
// 6. Environment isolation
// ---------------------------------------------------------------------------------------------

test.describe('account registry: environment isolation @framework', () => {
  test('the environment is derived from the host, with nothing hard-coded', () => {
    expect(environmentOf('https://testingapi.kpostindia.com')).toBe('testingapi.kpostindia.com');
    expect(environmentOf('http://192.168.0.38:9595/')).toBe('192.168.0.38:9595');
    expect(() => environmentOf('')).toThrow(TestAccountError);
    expect(() => environmentOf('not a url')).toThrow(TestAccountError);
  });

  test('no environment name is baked into the source', () => {
    // A fixed test|staging|production vocabulary is what lets an account drift between deployments.
    for (const file of SOURCES) {
      expect(source(file).toLowerCase(), file).not.toContain("'production'");
    }
  });

  test('a cross-environment reuse is detectable and refused', () => {
    const registry = freshRegistry();
    const record = registry.register(registration());
    expect(matchesEnvironment(record, ENV)).toBe(true);
    expect(matchesEnvironment(record, OTHER_ENV)).toBe(false);
    expect(() => assertSameEnvironment(record, ENV)).not.toThrow();
    expect(() => assertSameEnvironment(record, OTHER_ENV)).toThrow(/different account/);
  });
});

// ---------------------------------------------------------------------------------------------
// 7. Durable store
// ---------------------------------------------------------------------------------------------

test.describe('account registry: durable store @framework', () => {
  test('lines fold to current state, last write winning', () => {
    const text = [
      '{"accountId":"tba-00001","kpostId":"a@kpostindia.com","environment":"e","status":"CREATED","createdAt":"t","createdBy":"test-bench","verified":true,"source":"signup","usageCount":0}',
      '{"accountId":"tba-00001","kpostId":"a@kpostindia.com","environment":"e","status":"ACTIVE","createdAt":"t","createdBy":"test-bench","verified":true,"source":"signup","usageCount":1}',
    ].join('\n');
    const { records, problems } = parseAccountLines(text);
    expect(problems).toEqual([]);
    expect(records).toHaveLength(2);
    expect(records[1]?.status).toBe('ACTIVE');
  });

  test('a truncated final line is the expected crash signature, not corruption', () => {
    const text =
      '{"accountId":"tba-00001","kpostId":"a@kpostindia.com","environment":"e","status":"CREATED","createdAt":"t","createdBy":"b","verified":true,"source":"signup","usageCount":0}\n{"accountId":"tba-0000';
    const { records, problems } = parseAccountLines(text);
    // The good line survives — the whole point of one object per line.
    expect(records).toHaveLength(1);
    expect(problems).toHaveLength(1);
    expect(problems[0]?.reason).toContain('killed mid-append');
  });

  test('a malformed or incomplete record is reported, never silently dropped', () => {
    const { records, problems } = parseAccountLines(
      [
        '{"accountId":"x"}',
        '["not","an","object"]',
        '{"accountId":"y","kpostId":"z","environment":"e","status":"NOPE"}',
      ].join('\n'),
    );
    expect(records).toEqual([]);
    expect(problems).toHaveLength(3);
    expect(problems.map((p) => p.line)).toEqual([1, 2, 3]);
  });

  test('a registry rebuilds its state from the store', () => {
    const store = new InMemoryAccountStore();
    const first = new AccountRegistry(store);
    const record = first.register(registration());
    first.updateStatus(record.accountId, 'ACTIVE');

    // A new process reading the same store sees the same accounts — the persistence that makes the
    // registry reusable rather than run-scoped.
    const second = new AccountRegistry(store);
    expect(second.get(record.accountId)?.status).toBe('ACTIVE');
    expect(second.findByKpostId(ENV, record.kpostId)).toBeTruthy();
    // And it does not re-mint an id for an account it already holds.
    expect(second.register(registration()).accountId).toBe(record.accountId);
  });
});

// ---------------------------------------------------------------------------------------------
// 8. Architecture
// ---------------------------------------------------------------------------------------------

test.describe('account registry: architecture @framework', () => {
  test('the registry imports nothing from execution, Bugzilla, states or flows', () => {
    for (const file of SOURCES) {
      const imports = [...source(file).matchAll(/from '([^']+)'/g)].map((m) => m[1] ?? '');
      for (const specifier of imports) {
        for (const forbidden of FORBIDDEN_IMPORTS) {
          expect(specifier, `${file} imports ${specifier}`).not.toContain(forbidden);
        }
      }
    }
  });

  test('the registry contains no signup, HTTP or browser logic', () => {
    for (const file of SOURCES) {
      const code = source(file)
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');
      for (const token of ['sendTo(', 'fetch(', 'page.', 'signup(', 'login(']) {
        expect(code, `${file} contains ${token}`).not.toContain(token);
      }
    }
  });

  test('the dependency direction is signup → registry, never the reverse', () => {
    for (const file of SOURCES) {
      expect(source(file), file).not.toContain('src/signup');
      expect(source(file), file).not.toContain('/signup/');
    }
    // And the signup module knows nothing of the registry either — the spec composes them.
    const confirmation = readFileSync(
      path.join(ROOT_DIR, 'src', 'signup', 'account-confirmation.ts'),
      'utf8',
    );
    expect(confirmation).not.toContain('AccountRegistry');
  });

  test('it does not replace the account pool or the resource ledger', () => {
    for (const file of SOURCES) {
      // Comments stripped: §20 requires the relationship between the registry, the pool and the
      // ledger to be DOCUMENTED, so naming them in prose is mandatory. What must not exist is a
      // reference in the code.
      const code = source(file)
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');
      expect(code, `${file} uses AccountPool`).not.toContain('AccountPool');
      expect(code, `${file} uses ResourceLedger`).not.toContain('ResourceLedger');
    }
  });

  test('the durable file is git-ignored', () => {
    const ignore = readFileSync(path.join(ROOT_DIR, '.gitignore'), 'utf8');
    // It names real accounts on a live deployment; those identities stay out of git history.
    expect(ignore).toContain('/test-data/accounts/');
  });
});
