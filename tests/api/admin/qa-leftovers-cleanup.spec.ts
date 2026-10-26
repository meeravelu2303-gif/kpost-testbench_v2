import { AUTH_PROFILES } from '@config/auth-profile';
import type { Principal } from '@config/auth.config';
import { testData } from '@config/test-data.config';
import type { EndpointExecutor } from '@engine/endpoint-executor';
import { isPlainObject } from '@utils/json';
import { expect, test } from '@fixtures';

/**
 * Finds — and, only when asked, deletes — records the bench itself left behind in the QA testing company
 * (BUSINESS_M, company 242). A record counts as the bench's own ONLY if its name carries the bench's
 * pattern: `QA <label> <13-digit Date.now() stamp>` (feature, lifecycle and fuzz specs all name records
 * that way); the company's own records never match.
 *
 *   ADMIN_QA_CLEANUP=list    list what would be deleted (read-only)
 *   ADMIN_QA_CLEANUP=delete  delete it, children before parents, and fail on anything left
 *
 * Added 2026-10-26 after the write fuzz was found leaving every accepted malformed save behind.
 */
const businessM: Principal | undefined = AUTH_PROFILES.kpost.principals.find(
  (p) => p.key === 'business-m',
);
const MODE = process.env.ADMIN_QA_CLEANUP;
const BENCH_NAME = /^QA .+ \d{13}$/;

type Row = Record<string, unknown>;

async function rows(endpoints: EndpointExecutor, id: string, body: unknown): Promise<Row[]> {
  const ex = await endpoints.sendTo(
    id,
    { body },
    { label: `qa-cleanup:list:${id}`, auth: { principal: businessM! }, allowLiveRead: true },
  );
  expect(ex.status, `${id} lists the company's records`).toBe(200);
  const parsed: unknown = JSON.parse(ex.bodyText || '{}');
  const value = isPlainObject(parsed) ? parsed.value : undefined;
  return Array.isArray(value) ? value.filter(isPlainObject) : [];
}

const text = (row: Row, key: string): string => (typeof row[key] === 'string' ? row[key] : '');

test.describe('Admin · QA leftovers in the QA testing company @api @admin-api', () => {
  test.skip(
    MODE !== 'list' && MODE !== 'delete',
    'maintenance only: set ADMIN_QA_CLEANUP=list (read-only) or ADMIN_QA_CLEANUP=delete',
  );
  test.skip(
    !businessM || testData.businessMKpostId.includes('qa.business.m'),
    'needs the BUSINESS_M account of the QA testing company (QA_BUSINESS_M_KPOST_ID)',
  );

  test('bench-named records are found and (in delete mode) removed', async ({ endpoints }) => {
    test.setTimeout(300_000);
    expect(String(testData.businessMCompanyId), 'only ever the QA testing company (242)').toBe(
      '242',
    );

    // Root level only. A variable saved with NO parentVariableId cannot be listed (the list answers 400
    // to a null parent), so the fuzz now deletes those by id the moment they are accepted.
    const byRoot = (id: string): Promise<Row[]> => rows(endpoints, id, { parentVariableId: 0 });
    const employees = (await rows(endpoints, 'admin-employee-details', {})).filter((r) => {
      const p = isPlainObject(r.personalInformationObj) ? r.personalInformationObj : {};
      // API specs: "QA" + a stamped last name; the Admin UI spec: "Qaemp<digits>" + Bench/Benchedit.
      return (
        (text(p, 'firstName') === 'QA' &&
          /^(Fuzz \d{13}|Role\d{6}|Sweep \d{13}|Matrix \w+ \d{13})$/.test(text(p, 'lastName'))) ||
        (/^Qaemp\d+$/.test(text(p, 'firstName')) && /^Bench(edit)?$/.test(text(p, 'lastName')))
      );
    });

    // Delete order: dependants first (employee, location) → variables → tiers.
    const plan: Array<[deleteId: string, rows: Row[], nameKey: string]> = [
      ['admin-employee-delete', employees, ''],
      [
        'admin-workplace-location-delete',
        await rows(endpoints, 'admin-workplace-location-all', {}),
        'locationName',
      ],
      [
        'admin-hr-tier-variable-delete',
        await byRoot('admin-hr-tier-variable-list'),
        'variableName',
      ],
      [
        'admin-workplace-tier-variable-delete',
        await byRoot('admin-workplace-tier-variable-list'),
        'variableName',
      ],
      [
        'admin-hr-tier-attribute-delete',
        await rows(endpoints, 'admin-hr-tier-attribute-by-company', {}),
        'attributeName',
      ],
      [
        'admin-workplace-tier-attribute-delete',
        await rows(endpoints, 'admin-workplace-tier-attribute-by-company', {}),
        'attributeName',
      ],
    ];

    const left: string[] = [];
    for (const [deleteId, list, nameKey] of plan) {
      const seen = new Set<string>();
      const mine = list.filter((r) => {
        const id = text(r, 'id');
        if (!id || seen.has(id)) return false;
        seen.add(id);
        return nameKey === '' || BENCH_NAME.test(text(r, nameKey));
      });
      for (const r of mine) {
        const label = `${deleteId} ${text(r, 'id')} "${nameKey ? text(r, nameKey) : 'employee'}"`;
        if (MODE !== 'delete') {
          test.info().annotations.push({ type: 'would delete', description: label });
          continue;
        }
        const del = await endpoints.sendTo(
          deleteId,
          { body: { id: text(r, 'id') } },
          {
            label: `qa-cleanup:${deleteId}`,
            auth: { principal: businessM! },
            allowLiveWrite: true,
          },
        );
        test.info().annotations.push({ type: `deleted HTTP ${del.status}`, description: label });
        if (del.status !== 200)
          left.push(`${label}: HTTP ${del.status} ${del.bodyText.slice(0, 120)}`);
      }
    }
    expect(left, 'every bench-named record is deleted').toEqual([]);
  });
});
