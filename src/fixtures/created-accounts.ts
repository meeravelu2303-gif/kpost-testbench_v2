import fs from 'node:fs';
import path from 'node:path';

/**
 * The append-only log of KPost accounts this bench itself CREATED — the opposite number to
 * `test-accounts.json` (the pre-existing, .env-declared accounts that file explicitly says the
 * bench never created). Anywhere a signup/registration flow mints a brand-new kpostID, it should
 * call `recordCreatedAccount()` right after the create succeeds, so the identity and its mobile
 * number are never lost track of, however many runs later.
 *
 * Single writer at a time: every npm script in this bench runs Playwright with `--workers=1`, so
 * the read-modify-write below is safe without extra locking. If that ever changes, this needs one.
 */

const FILE = path.join(__dirname, 'created-accounts.json');

export interface CreatedAccountRecord {
  /** The kpostID the signup/registration flow actually created. */
  kpostId: string;
  /** The mobile number registered against it (national number, no dial code, matching signup payloads). */
  mobileNumber: string;
  /** Which endpoint/flow created it, e.g. 'signup-login-signup' or 'admin-role-posting-save'. */
  source: string;
  /** Free-text: what test/run created this, for tracing back later. */
  note?: string;
  /** ISO timestamp, set automatically. */
  createdAt: string;
}

interface Store {
  $comment?: string[];
  accounts: CreatedAccountRecord[];
}

function readStore(): Store {
  try {
    const raw = fs.readFileSync(FILE, 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && Array.isArray((parsed as Store).accounts)) {
      return parsed as Store;
    }
  } catch {
    // First write, or the file is missing/corrupt — start a fresh store rather than throwing,
    // since losing this log is recoverable but a crashed test run isn't.
  }
  return { accounts: [] };
}

/**
 * Record a KPost account this run just created. Idempotent on (kpostId, mobileNumber): calling it
 * again for the same pair (e.g. a re-run against a not-yet-reset disposable DB) does not duplicate
 * the entry, just updates its `createdAt`.
 */
export function recordCreatedAccount(input: {
  kpostId: string;
  mobileNumber: string;
  source: string;
  note?: string;
}): void {
  const store = readStore();
  const createdAt = new Date().toISOString();
  const existingIndex = store.accounts.findIndex(
    (a) => a.kpostId === input.kpostId && a.mobileNumber === input.mobileNumber,
  );
  const record: CreatedAccountRecord = { ...input, createdAt };
  if (existingIndex >= 0) {
    store.accounts[existingIndex] = record;
  } else {
    store.accounts.push(record);
  }
  fs.writeFileSync(
    FILE,
    `${JSON.stringify(
      {
        $comment: store.$comment ?? [
          'Every KPost account this bench itself CREATED during a test run — the opposite of',
          'test-accounts.json, which is exclusively the PRE-EXISTING, .env-declared accounts.',
        ],
        accounts: store.accounts,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
}

/** All accounts this bench has ever created, for a spec that needs to know what already exists. */
export function allCreatedAccounts(): readonly CreatedAccountRecord[] {
  return readStore().accounts;
}
