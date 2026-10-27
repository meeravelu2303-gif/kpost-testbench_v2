import { thresholds } from '@config/thresholds.config';
import type { CheckDetail } from '@engine/validation-result';
import type { JsonObject } from '@utils/json';

/**
 * Assertions shaped to the real KPOST_QA schema: natural keys (`kpost_id`),
 * `created_date`/`modified_date` audit columns, a different deletion flag per table, and text often
 * stored as BLOBs (see `text()`).
 */

const detail = (name: string, ok: boolean, expected: unknown, actual: unknown): CheckDetail => ({
  name,
  status: ok ? 'PASSED' : 'FAILED',
  expected,
  actual,
});

/** A column's value as a string, decoding BLOBs (a Buffer never equals a string). */
export function text(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (Buffer.isBuffer(value)) return value.toString('utf8');
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'bigint' || typeof value === 'boolean') {
    return String(value);
  }
  if (value instanceof Date) return value.toISOString();
  // Serialized, so two different objects never both become "[object Object]" and compare equal.
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

  /** `created_date` is set and sane; `modified_date` (null if never updated) is not before it. */
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
   * `active_status` ('yes'/'no') on USER_MASTER and USERGROUP_MASTER, compared case-insensitively.
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

  /** The tinyint block flag used by TBL_KPOST_USER_CONTACTS — same shape as `deleteStatus`. */
  isBlocked(record: JsonObject | undefined, expectedBlocked: boolean): CheckDetail {
    const raw = record?.is_blocked;
    const blocked = raw === 1 || raw === true || text(raw) === '1';
    return detail(
      expectedBlocked ? 'is_blocked marks the contact blocked' : 'is_blocked is clear',
      blocked === expectedBlocked,
      expectedBlocked ? 1 : 0,
      raw ?? '(missing)',
    );
  },

  /** Katchup's per-side deletion flags: a delete affects one participant, so both are asserted. */
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

  /** A logical foreign key MySQL does not enforce (KPOST_QA declares almost no FK constraints). */
  foreignKey(label: string, parent: JsonObject | undefined): CheckDetail {
    return detail(
      `${label} resolves`,
      parent !== undefined,
      'parent row',
      parent ? 'found' : 'orphan',
    );
  },
};
