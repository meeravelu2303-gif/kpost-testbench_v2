import fs from 'node:fs';
import path from 'node:path';

/**
 * Append-only log of KPost accounts the bench created; call `recordCreatedAccount()` after any
 * signup. The read-modify-write is unlocked because every script runs with `--workers=1`.
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
    // Missing or corrupt: start fresh rather than crash the run.
  }
  return { accounts: [] };
}

/** Records a KPost account this run created; idempotent on (kpostId, mobileNumber). */
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
