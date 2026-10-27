import type { CheckDetail } from '@engine/validation-result';
import { text } from './kpost-assertions';
import type { KmailMasterRecord, KmailTransactionRecord } from './repositories/kmail.repository';

/**
 * Assertions for KMail's `'Y'`/`'N'` char state columns (Katchup uses tinyint 0/1). `Boolean('N')`
 * is true, so a truthiness check would pass for the wrong reason. See
 * `docs/modules/kmail-schema.md`.
 */

/** A KMail state column as a tri-state; `unknown` is a row holding a NUL byte. */
export function kmailFlag(value: unknown): 'set' | 'clear' | 'unknown' {
  const raw = text(value);
  if (raw === undefined) return 'unknown';
  const normalized = raw.trim().toUpperCase();
  if (normalized === 'Y') return 'set';
  if (normalized === 'N') return 'clear';
  return 'unknown';
}

const detail = (name: string, ok: boolean, expected: unknown, actual: unknown): CheckDetail => ({
  name,
  status: ok ? 'PASSED' : 'FAILED',
  expected,
  actual,
});

/** A readable rendering of a raw flag, so a NUL byte is visible in a report rather than invisible. */
function describe(value: unknown): string {
  const raw = text(value);
  if (raw === undefined) return '(null)';
  if (raw === '\u0000') return "'\\u0000' (NUL — legacy row)";
  return `'${raw}'`;
}

export const kmailDb = {
  /** One state column equals the expected tri-state. */
  flag(
    row: KmailTransactionRecord | undefined,
    column: keyof KmailTransactionRecord & string,
    expected: 'set' | 'clear',
  ): CheckDetail {
    const actual = kmailFlag(row?.[column]);
    return detail(
      `${column} is ${expected}`,
      actual === expected,
      expected === 'set' ? "'Y'" : "'N'",
      `${describe(row?.[column])} → ${actual}`,
    );
  },

  /** The subject is stored and is not the plaintext (it is ciphertext the bench cannot read). */
  subjectEncrypted(mail: KmailMasterRecord | undefined, plaintext: string): CheckDetail[] {
    const stored = text(mail?.kmail_subject);
    return [
      detail(
        'kmail_subject is populated',
        stored !== undefined && stored !== '',
        'stored subject',
        stored === undefined ? '(null)' : `${stored.length} chars`,
      ),
      detail(
        'kmail_subject is not stored as plaintext',
        stored !== undefined && stored !== plaintext,
        'ciphertext, not the sent text',
        stored === plaintext ? 'PLAINTEXT — encryption at rest is not applied' : 'ciphertext',
      ),
    ];
  },

  /** The transaction row belongs to the mail and the recipient it claims to. */
  addressedTo(
    row: KmailTransactionRecord | undefined,
    expected: { kmailId: number | string; receiver: string; sender?: string },
  ): CheckDetail[] {
    const checks = [
      detail(
        'transaction row exists for this recipient',
        row !== undefined,
        'one row',
        row ? 'found' : 'none',
      ),
    ];
    if (!row) return checks;
    checks.push(
      detail(
        'kmail_id links the row to the mail',
        String(row.kmail_id) === String(expected.kmailId),
        String(expected.kmailId),
        String(row.kmail_id),
      ),
      detail(
        'receiver is the addressed account',
        text(row.receiver) === expected.receiver,
        expected.receiver,
        text(row.receiver),
      ),
    );
    if (expected.sender !== undefined) {
      checks.push(
        detail(
          'sender is the sending account',
          text(row.sender) === expected.sender,
          expected.sender,
          text(row.sender),
        ),
      );
    }
    return checks;
  },
};
