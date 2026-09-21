import type { CheckDetail } from '@engine/validation-result';
import { text } from './kpost-assertions';
import type { KmailMasterRecord, KmailTransactionRecord } from './repositories/kmail.repository';

/**
 * Assertions for KMail's `'Y'` / `'N'` state columns.
 *
 * These exist separately from `kpostDb` because KMail encodes the same *ideas* differently from the
 * rest of the schema, and using the wrong reader is silently wrong rather than loudly wrong:
 *
 *  - Katchup's `deleted_by_sender` is a **tinyint** `0`/`1`. KMail's is a **char** `'Y'`/`'N'`.
 *  - `Number('N')` is `NaN`, so a numeric comparison never matches.
 *  - `Boolean('N')` is **`true`** — a non-empty string is truthy — so the obvious truthiness check
 *    reports every mail as deleted, starred and read at once, and every assertion built on it
 *    passes for the wrong reason.
 *
 * See `docs/KMAIL-SCHEMA.md` for the full mapping and the sampled value distributions.
 */

/**
 * A KMail state column as a tri-state.
 *
 * `unknown` is not defensiveness: 107 rows on KPOST_QA hold a NUL byte (`'\u0000'`) in these
 * columns, which is neither set nor clear. Folding it into either would make a data-quality
 * artefact look like product behaviour — and it is the difference between "this mail was never
 * marked" and "we could not tell".
 */
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

  /**
   * The mail's subject is stored, and stored **encrypted**.
   *
   * Two checks in one because they are two halves of the same fact: something was persisted, and it
   * is not the plaintext. Asserting equality with what was sent would fail on a healthy API — the
   * column holds ciphertext the bench has no key for — so the meaningful assertion is the inverse,
   * and it is a genuine security check rather than a workaround.
   */
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
