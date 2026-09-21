import { thresholds } from '@config/thresholds.config';
import type { CheckDetail } from '@engine/validation-result';
import type { JsonObject } from '@utils/json';

/**
 * Assertions shaped to the **real KPOST_QA schema**, as opposed to `db-assertions.ts`, which is
 * written against the mock server's idealised one.
 *
 * Keeping the two apart is deliberate. The mock's tables use `id`, `createdAt`, `updatedAt` and a
 * `deletedAt` tombstone; KPost uses none of those. Rewriting the mock assertions in place would
 * have broken the framework's own self-tests — which are the only thing those assertions are
 * attached to — while proving nothing about the product. So the real schema gets its own vocabulary
 * here, and each difference below is a fact read off `information_schema`, not a guess:
 *
 *  - **Primary keys are natural, not synthetic.** A user is keyed by `kpost_id` (a varchar e-mail
 *    address), not an integer `id`.
 *  - **Audit columns are `created_date` / `modified_date`**, with `created_by` / `modified_by`
 *    beside them. `mysql2` returns these as `Date`, not as ISO strings.
 *  - **Deletion is a flag, and the flag is not the same shape twice.** `TBL_KPOST_USER_MASTER` and
 *    `TBL_KPOST_USERGROUP_MASTER` use `active_status` with the *strings* `'yes'`/`'no'`;
 *    `TBL_KPOST_USER_CONTACTS` uses a tinyint `delete_status`; Katchup marks each side separately
 *    with `deleted_by_sender` / `deleted_by_receiver`. An assertion that assumed one of these would
 *    silently pass on the other two.
 *  - **Text columns are frequently BLOBs.** `subject`, `actual_message`, `group_name` and
 *    `receiver_name` are all binary, so the driver hands back a `Buffer`. Comparing one to a string
 *    always fails, which would read as "the API stored the wrong subject" when it stored the right
 *    one — see `text()`.
 */

const detail = (name: string, ok: boolean, expected: unknown, actual: unknown): CheckDetail => ({
  name,
  status: ok ? 'PASSED' : 'FAILED',
  expected,
  actual,
});

/**
 * A column's value as a string, decoding the BLOBs KPost stores text in.
 *
 * This is the single most common way a correct API gets reported as broken: `subject` is a BLOB, so
 * `record.subject === 'QA Bench 123'` is false even when the stored bytes spell exactly that.
 */
export function text(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (Buffer.isBuffer(value)) return value.toString('utf8');
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'bigint' || typeof value === 'boolean') {
    return String(value);
  }
  if (value instanceof Date) return value.toISOString();
  /*
   * Anything else — a JSON column, an unexpected object — is serialized rather than allowed to
   * become "[object Object]", which would make two different values compare equal and pass.
   */
  return JSON.stringify(value);
}

/** A MySQL `timestamp` as epoch milliseconds. `mysql2` returns a `Date`; older rows may be null. */
function timeOf(value: unknown): number | undefined {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? undefined : parsed;
  }
  return undefined;
}

export const kpostDb = {
  exists(name: string, record: JsonObject | undefined): CheckDetail {
    return detail(`${name} row exists`, record !== undefined, 'one row', record ? 'found' : 'none');
  },

  notExists(name: string, record: JsonObject | undefined): CheckDetail {
    return detail(`${name} row absent`, record === undefined, 'no row', record ? 'found' : 'none');
  },

  /** Field equality with BLOB decoding applied to both sides. */
  fieldsMatch(record: JsonObject | undefined, expected: Record<string, unknown>): CheckDetail[] {
    return Object.entries(expected).map(([column, value]) => {
      const actual = text(record?.[column]);
      const wanted = text(value);
      return detail(`${column}`, actual === wanted, wanted, actual);
    });
  },

  /**
   * `created_date` is set and sane, `modified_date` does not precede it.
   *
   * `modified_date` is nullable on a never-updated row, and that is correct rather than a fault —
   * asserting it is always present would fail every freshly created record.
   */
  auditFields(record: JsonObject | undefined, options: { createdBy?: string } = {}): CheckDetail[] {
    const created = timeOf(record?.created_date);
    const modified = timeOf(record?.modified_date);
    const checks: CheckDetail[] = [
      detail(
        'created_date is set and not in the future',
        created !== undefined && created <= Date.now() + thresholds.clockSkewMs,
        'a timestamp at or before now',
        record?.created_date ?? '(missing)',
      ),
      detail(
        'modified_date is absent or at/after created_date',
        modified === undefined || (created !== undefined && modified >= created),
        'ordered, or not yet modified',
        { created_date: record?.created_date, modified_date: record?.modified_date },
      ),
    ];
    if (options.createdBy !== undefined) {
      checks.push(
        detail(
          'created_by names the creator',
          text(record?.created_by) === options.createdBy,
          options.createdBy,
          text(record?.created_by) ?? '(missing)',
        ),
      );
    }
    return checks;
  },

  /**
   * `active_status`, the `'yes'`/`'no'` flag on USER_MASTER and USERGROUP_MASTER.
   *
   * Compared case-insensitively: the column is a free-text varchar with no constraint, so a row
   * written as `'Yes'` is the same state and must not read as a deactivated account.
   */
  activeStatus(record: JsonObject | undefined, expected: 'yes' | 'no'): CheckDetail {
    const actual = text(record?.active_status)?.toLowerCase();
    return detail(`active_status is "${expected}"`, actual === expected, expected, actual);
  },

  /** The tinyint soft-delete used by TBL_KPOST_USER_CONTACTS. */
  deleteStatus(record: JsonObject | undefined, expectedDeleted: boolean): CheckDetail {
    const raw = record?.delete_status;
    const deleted = raw === 1 || raw === true || text(raw) === '1';
    return detail(
      expectedDeleted ? 'delete_status marks the row deleted' : 'delete_status is clear',
      deleted === expectedDeleted,
      expectedDeleted ? 1 : 0,
      raw ?? '(missing)',
    );
  },

  /**
   * Katchup's per-side deletion flags.
   *
   * A recall or a delete removes the message for ONE participant, so a single "is it deleted?"
   * question has two answers and asserting only one of them would miss a message that vanished for
   * the wrong party.
   */
  katchupDeletion(
    record: JsonObject | undefined,
    expected: { sender?: boolean; receiver?: boolean },
  ): CheckDetail[] {
    const flag = (value: unknown): boolean => value === 1 || value === true || text(value) === '1';
    const checks: CheckDetail[] = [];
    if (expected.sender !== undefined) {
      checks.push(
        detail(
          `deleted_by_sender is ${expected.sender}`,
          flag(record?.deleted_by_sender) === expected.sender,
          expected.sender,
          record?.deleted_by_sender ?? '(missing)',
        ),
      );
    }
    if (expected.receiver !== undefined) {
      checks.push(
        detail(
          `deleted_by_receiver is ${expected.receiver}`,
          flag(record?.deleted_by_receiver) === expected.receiver,
          expected.receiver,
          record?.deleted_by_receiver ?? '(missing)',
        ),
      );
    }
    return checks;
  },

  /** A column that must hold something — used where the schema allows null but the flow must not. */
  present(record: JsonObject | undefined, column: string): CheckDetail {
    const value = text(record?.[column]);
    return detail(
      `${column} is populated`,
      value !== undefined && value !== '',
      'a value',
      value ?? '(null)',
    );
  },

  /**
   * A logical foreign key that MySQL does not enforce.
   *
   * KPOST_QA declares almost no FK constraints — `TBL_KPOST_USER_MASTER.company_id` points at
   * `TBL_KPOST_ADMIN_REGISTRATION.id` by convention only. That makes the orphan check worth running
   * rather than redundant: nothing in the database prevents one.
   */
  foreignKey(label: string, parent: JsonObject | undefined): CheckDetail {
    return detail(
      `${label} resolves`,
      parent !== undefined,
      'parent row',
      parent ? 'found' : 'orphan',
    );
  },
};
