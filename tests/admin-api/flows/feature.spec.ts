import type { ApiResponseWrapper } from '@api/client/response-wrapper';
import { AUTH_PROFILES } from '@config/auth-profile';
import type { Principal } from '@config/auth.config';
import { testData } from '@config/test-data.config';
import type { EndpointExecutor } from '@engine/endpoint-executor';
import { isPlainObject } from '@utils/json';
import { expect, test } from '@fixtures';
import { employeePayload, locationPayload, variablePayload } from '../support/screen-payloads';

/**
 * Admin/HR org-setup lifecycle as the BUSINESS_M admin: workplace tier → variable → location, HR
 * tier → variable, employee; each is read back, then all are deleted in reverse order (no cascade).
 * Gated by ADMIN_LIFECYCLE=true. Saves take arrays; branch on the envelope `status`, not the HTTP
 * code, since some success paths return HTTP 500. Role posting has its own spec.
 */

const K = AUTH_PROFILES.kpost;
const businessM: Principal | undefined = K.principals.find((p) => p.key === 'business-m');
const cid = (): string => String(testData.businessMCompanyId);
const stamp = Date.now();
const name = (label: string): string => `QA ${label} ${stamp}`;

/** The admin envelope `{ value, status, statusCode }` from a response, or `{}`. */
function envelope(resp: ApiResponseWrapper): Record<string, unknown> {
  const parsed = resp.json();
  return parsed.ok && isPlainObject(parsed.value) ? parsed.value : {};
}
function statusOf(resp: ApiResponseWrapper): string {
  const s = envelope(resp).status;
  return typeof s === 'string' ? s : '';
}
/** The created id: `value.id` (single save) or `value[0].id` (array save). */
function createdId(resp: ApiResponseWrapper): string | undefined {
  const v: unknown = envelope(resp).value;
  const record: unknown = Array.isArray(v) ? v[0] : v;
  return isPlainObject(record) && typeof record.id === 'string' ? record.id : undefined;
}

/** Send a body to an admin endpoint as the BUSINESS_M admin, authorized to write on live. */
function call(
  endpoints: EndpointExecutor,
  id: string,
  body: unknown,
  label: string,
): ReturnType<EndpointExecutor['sendTo']> {
  return endpoints.sendTo(
    id,
    { body },
    {
      label: `feature:admin:${label}`,
      auth: { principal: businessM! },
      allowLiveWrite: true,
      allowLiveRead: true,
    },
  );
}

test.describe('Admin/HR org-setup lifecycle (BUSINESS_M)', { tag: '@admin-api' }, () => {
  test.skip(
    process.env.ADMIN_LIFECYCLE !== 'true',
    'writes real org structure; set ADMIN_LIFECYCLE=true',
  );
  test.skip(
    !businessM || testData.businessMKpostId.includes('qa.business.m'),
    'needs the BUSINESS_M account (QA_BUSINESS_M_KPOST_ID + QA_BUSINESS_M_COMPANY_ID)',
  );

  test(
    'workplace + HR + employee: create → read-back → self-clean @api @admin-api',
    {
      // In sanity: pure inserts, no external side effect, every record deleted in `finally`.
      tag: ['@sanity', '@admin'],
      annotation: [{ type: 'requirement', description: 'BR-ADM-TIER-ORDER' }],
    },
    async ({ endpoints }) => {
      let wpAttrId: string | undefined;
      let wpVarId: string | undefined;
      let locId: string | undefined;
      let hrAttrId: string | undefined;
      let hrVarId: string | undefined;
      let empId: string | undefined;

      try {
        // ---- Work Place Setup: tier attribute → variable ---------------------------------------
        const wpAttr = await call(
          endpoints,
          'admin-workplace-tier-attribute-save',
          [{ attributeName: name('WP Tier') }],
          'wp-attr-save',
        );
        wpAttrId = createdId(wpAttr);
        expect.soft(statusOf(wpAttr), 'workplace tier attribute saved').toMatch(/success/i);
        expect.soft(wpAttrId, 'workplace tier attribute returns an id').toBeTruthy();

        // The new attribute must appear on a fresh company read, not just be claimed by the save.
        const wpAttrList = await call(
          endpoints,
          'admin-workplace-tier-attribute-by-company',
          {},
          'wp-attr-by-company',
        );
        expect
          .soft(statusOf(wpAttrList), 'workplace tier attributes read back')
          .toMatch(/success/i);
        const wpAttrRows = envelope(wpAttrList).value;
        expect
          .soft(
            Array.isArray(wpAttrRows) &&
              wpAttrRows.some((r) => isPlainObject(r) && r.id === wpAttrId),
            'the newly created workplace tier attribute appears in the company list',
          )
          .toBe(true);

        if (wpAttrId) {
          const wpVar = await call(
            endpoints,
            'admin-workplace-tier-variable-save',
            [
              {
                variableName: name('WP Var'),
                attributeId: wpAttrId,
                parentVariableId: 0,
                parentAttributeId: 0,
                reportingJson: '[]',
              },
            ],
            'wp-var-save',
          );
          wpVarId = createdId(wpVar);
          expect.soft(statusOf(wpVar), 'workplace tier variable saved').toMatch(/success/i);
          expect.soft(wpVarId, 'workplace tier variable returns an id').toBeTruthy();
        }

        // Read back the workplace variables + the reporting hierarchy (id-keyed).
        const wpVarList = await call(
          endpoints,
          'admin-workplace-tier-variable-list',
          { parentVariableId: 0 },
          'wp-var-list',
        );
        expect.soft(statusOf(wpVarList), 'workplace variables read back').toMatch(/success/i);
        if (wpVarId) {
          const wpReport = await call(
            endpoints,
            'admin-workplace-tier-variable-reporting-hierarchy',
            { id: wpVarId },
            'wp-var-reporting',
          );
          expect.soft(statusOf(wpReport), 'workplace reporting hierarchy read').toMatch(/success/i);
        }

        // Exercise the workplace tier attribute + variable UPDATE writes.
        if (wpAttrId) {
          const wpAttrEdited = name('WP Tier edited');
          const wpAttrUpd = await call(
            endpoints,
            'admin-workplace-tier-attribute-update',
            { id: wpAttrId, attributeName: wpAttrEdited },
            'wp-attr-update',
          );
          expect.soft(statusOf(wpAttrUpd), 'workplace tier attribute updated').toMatch(/success/i);

          // Re-read to confirm the new name persisted, not just that the update said success.
          const wpAttrRecheck = await call(
            endpoints,
            'admin-workplace-tier-attribute-by-company',
            {},
            'wp-attr-recheck',
          );
          const wpAttrRecheckRows = envelope(wpAttrRecheck).value;
          expect
            .soft(
              Array.isArray(wpAttrRecheckRows) &&
                wpAttrRecheckRows.some(
                  (r) => isPlainObject(r) && r.id === wpAttrId && r.attributeName === wpAttrEdited,
                ),
              'the updated workplace tier attribute name actually persisted',
            )
            .toBe(true);
        }
        if (wpVarId) {
          const wpVarUpd = await call(
            endpoints,
            'admin-workplace-tier-variable-update',
            { ...variablePayload(wpAttrId!, name('WP Var edited')), id: wpVarId },
            'wp-var-update',
          );
          expect.soft(statusOf(wpVarUpd), 'workplace tier variable updated').toMatch(/success/i);
        }

        // ---- Work Place Location Setup ---------------------------------------------------------
        if (wpAttrId && wpVarId) {
          const loc = await call(
            endpoints,
            'admin-workplace-location-save',
            [locationPayload(wpAttrId, wpVarId, name('Location'))],
            'loc-save',
          );
          locId = createdId(loc);
          expect.soft(statusOf(loc), 'workplace location saved').toMatch(/success/i);
          expect.soft(locId, 'workplace location returns an id').toBeTruthy();

          // The location reads, now with real ids.
          const locAll = await call(endpoints, 'admin-workplace-location-all', {}, 'loc-all');
          expect.soft(statusOf(locAll), 'all locations read').toMatch(/success/i);
          const locGet = await call(
            endpoints,
            'admin-workplace-location-get',
            { attributeId: wpAttrId, variableId: wpVarId },
            'loc-get',
          );
          expect.soft(statusOf(locGet), 'locations by tier read').toMatch(/success/i);
          if (locId) {
            const locById = await call(
              endpoints,
              'admin-workplace-location-by-id',
              { id: locId },
              'loc-by-id',
            );
            expect.soft(statusOf(locById), 'location by id read').toMatch(/success/i);

            // Exercise the location UPDATE write.
            const locEdited = name('Location edited');
            const locUpd = await call(
              endpoints,
              'admin-workplace-location-update',
              // The screen sends the whole record on update; the server requires it.
              { ...locationPayload(wpAttrId, wpVarId, locEdited), id: locId },
              'loc-update',
            );
            expect.soft(statusOf(locUpd), 'workplace location updated').toMatch(/success/i);

            // Re-read the location by id to confirm the new name persisted.
            const locRecheck = await call(
              endpoints,
              'admin-workplace-location-by-id',
              { id: locId },
              'loc-recheck',
            );
            const locRecheckValue = envelope(locRecheck).value;
            expect
              .soft(
                isPlainObject(locRecheckValue) && locRecheckValue.locationName === locEdited,
                'the updated location name actually persisted',
              )
              .toBe(true);
          }
        }

        // The hierarchy contract is unknown: even the real parent ids just minted get a 400. Soft, so
        // the open finding does not block the HR and employee steps below.
        const hierarchy = await endpoints.sendTo(
          'admin-workplace-hierarchy',
          { body: { parentAttributeId: wpAttrId ?? '0', parentVariableId: wpVarId ?? '0' } },
          {
            label: 'feature:admin:hierarchy',
            auth: { principal: businessM! },
            allowLiveRead: true,
          },
        );
        expect
          .soft(
            statusOf(hierarchy),
            'workplace hierarchy read (Unknown/Requires Clarification — see comment above)',
          )
          .toMatch(/success/i);

        // ---- HR Breakdown Setup: tier attribute → variable -------------------------------------
        const hrAttr = await call(
          endpoints,
          'admin-hr-tier-attribute-save',
          [{ attributeName: name('HR Tier') }],
          'hr-attr-save',
        );
        hrAttrId = createdId(hrAttr);
        expect.soft(statusOf(hrAttr), 'HR tier attribute saved').toMatch(/success/i);
        expect.soft(hrAttrId, 'HR tier attribute returns an id').toBeTruthy();

        // Same fresh-read cross-check as the workplace side.
        const hrAttrList = await call(
          endpoints,
          'admin-hr-tier-attribute-by-company',
          {},
          'hr-attr-by-company',
        );
        expect.soft(statusOf(hrAttrList), 'HR tier attributes read back').toMatch(/success/i);
        const hrAttrRows = envelope(hrAttrList).value;
        expect
          .soft(
            Array.isArray(hrAttrRows) &&
              hrAttrRows.some((r) => isPlainObject(r) && r.id === hrAttrId),
            'the newly created HR tier attribute appears in the company list',
          )
          .toBe(true);

        if (hrAttrId) {
          const hrVar = await call(
            endpoints,
            'admin-hr-tier-variable-save',
            [
              {
                variableName: name('HR Var'),
                attributeId: hrAttrId,
                parentVariableId: 0,
                parentAttributeId: 0,
                reportingJson: '[]',
              },
            ],
            'hr-var-save',
          );
          hrVarId = createdId(hrVar);
          expect.soft(statusOf(hrVar), 'HR tier variable saved').toMatch(/success/i);
          expect.soft(hrVarId, 'HR tier variable returns an id').toBeTruthy();
        }

        const hrVarList = await call(
          endpoints,
          'admin-hr-tier-variable-list',
          { parentVariableId: 0 },
          'hr-var-list',
        );
        expect.soft(statusOf(hrVarList), 'HR variables read back').toMatch(/success/i);
        if (hrVarId) {
          const hrReport = await call(
            endpoints,
            'admin-hr-tier-variable-reporting-hierarchy',
            { id: hrVarId },
            'hr-var-reporting',
          );
          expect.soft(statusOf(hrReport), 'HR reporting hierarchy read').toMatch(/success/i);
        }

        // Exercise the HR tier attribute + variable UPDATE writes.
        if (hrAttrId) {
          const hrAttrEdited = name('HR Tier edited');
          const hrAttrUpd = await call(
            endpoints,
            'admin-hr-tier-attribute-update',
            { id: hrAttrId, attributeName: hrAttrEdited },
            'hr-attr-update',
          );
          expect.soft(statusOf(hrAttrUpd), 'HR tier attribute updated').toMatch(/success/i);

          // Same field-level check as the workplace tier attribute update above.
          const hrAttrRecheck = await call(
            endpoints,
            'admin-hr-tier-attribute-by-company',
            {},
            'hr-attr-recheck',
          );
          const hrAttrRecheckRows = envelope(hrAttrRecheck).value;
          expect
            .soft(
              Array.isArray(hrAttrRecheckRows) &&
                hrAttrRecheckRows.some(
                  (r) => isPlainObject(r) && r.id === hrAttrId && r.attributeName === hrAttrEdited,
                ),
              'the updated HR tier attribute name actually persisted',
            )
            .toBe(true);
        }
        if (hrVarId) {
          const hrVarUpd = await call(
            endpoints,
            'admin-hr-tier-variable-update',
            { ...variablePayload(hrAttrId!, name('HR Var edited')), id: hrVarId },
            'hr-var-update',
          );
          expect.soft(statusOf(hrVarUpd), 'HR tier variable updated').toMatch(/success/i);
        }

        // ---- Employee Data (side-effect-free Mongo record) -------------------------------------
        const emp = await call(
          endpoints,
          'admin-employee-save',
          // The Employee Data screen's full record: the server enforces its required fields.
          employeePayload(`Employee ${stamp}`),
          'employee-save',
        );
        empId = createdId(emp);
        expect.soft(statusOf(emp), 'employee saved').toMatch(/success/i);
        expect.soft(empId, 'employee returns an id').toBeTruthy();

        const empList = await call(endpoints, 'admin-employee-details', {}, 'employee-list');
        expect.soft(statusOf(empList), 'employees read back').toMatch(/success/i);
        const empByCompany = await call(
          endpoints,
          'admin-role-posting-employees',
          {},
          'role-employees',
        );
        expect.soft(statusOf(empByCompany), 'role-posting employees read').toMatch(/success/i);

        // The plain company-wide role-posting list: a data-quality check (every row genuinely belongs
        // to this company), cross-checked against the single-employee read below once empId exists.
        const rolePostingsByCompany = await call(
          endpoints,
          'admin-role-posting-by-company',
          {},
          'role-posting-by-company',
        );
        expect
          .soft(statusOf(rolePostingsByCompany), 'role postings by company read')
          .toMatch(/success/i);
        const rolePostingRows = envelope(rolePostingsByCompany).value;
        expect
          .soft(
            Array.isArray(rolePostingRows) &&
              rolePostingRows.every((r) => isPlainObject(r) && r.companyId === cid()),
            'every role posting returned genuinely belongs to this company',
          )
          .toBe(true);

        if (empId) {
          const empLastNameEdited = `Employee ${stamp} edited`;
          const empUpdate = await call(
            endpoints,
            'admin-employee-update',
            // The screen sends the whole record on update; the server requires it.
            { ...employeePayload(empLastNameEdited), id: empId },
            'employee-update',
          );
          expect.soft(statusOf(empUpdate), 'employee updated').toMatch(/success/i);

          // Re-read the employee list to confirm the new last name persisted for this employee.
          const empRecheck = await call(
            endpoints,
            'admin-employee-details',
            {},
            'employee-recheck',
          );
          const empRecheckRows = envelope(empRecheck).value;
          expect
            .soft(
              Array.isArray(empRecheckRows) &&
                empRecheckRows.some(
                  (r) =>
                    isPlainObject(r) &&
                    r.id === empId &&
                    isPlainObject(r.personalInformationObj) &&
                    r.personalInformationObj.lastName === empLastNameEdited,
                ),
              'the updated employee last name actually persisted',
            )
            .toBe(true);

          const roleByEmp = await call(
            endpoints,
            'admin-role-posting-by-company-and-employee',
            { employeeId: empId },
            'role-by-employee',
          );
          expect.soft(statusOf(roleByEmp), 'role posting by employee read').toMatch(/success/i);
        }
      } finally {
        // Teardown in reverse dependency order (best-effort; deletes are hard, no cascade).
        const cleanup: Array<[string, string | undefined]> = [
          ['admin-employee-delete', empId],
          ['admin-workplace-location-delete', locId],
          ['admin-hr-tier-variable-delete', hrVarId],
          ['admin-hr-tier-attribute-delete', hrAttrId],
          ['admin-workplace-tier-variable-delete', wpVarId],
          ['admin-workplace-tier-attribute-delete', wpAttrId],
        ];
        for (const [id, recordId] of cleanup) {
          if (recordId) {
            await call(endpoints, id, { id: recordId }, `cleanup:${id}`).catch(() => undefined);
          }
        }
      }
    },
  );

  test(
    'an employee saved without its employment details is refused with a 4xx, not a 500 @api @admin-api',
    { annotation: [{ type: 'requirement', description: 'BR-ADM-500-VALIDATION' }] },
    async ({ endpoints }) => {
      // Without employmentObj the backend NPEs; a missing required part must be a 4xx, not a 500.
      // Any record created is deleted.
      const resp = await call(
        endpoints,
        'admin-employee-save',
        {
          personalInformationObj: {
            firstName: 'QA',
            lastName: `NoEmployment ${stamp}`,
            disability: false,
          },
        },
        'employee-save-no-employment',
      );
      const createdEmp = createdId(resp);
      try {
        test.info().annotations.push({
          type: 'observed',
          description: `HTTP ${resp.status} ${resp.bodyText.slice(0, 200)}`,
        });
        expect(createdEmp, 'no employee is created without employment details').toBeFalsy();
        expect(
          resp.status,
          'a missing employmentObj is a client error (4xx), not a server crash (500)',
        ).toBeLessThan(500);
        expect(resp.status, 'and it is refused').toBeGreaterThanOrEqual(400);
      } finally {
        if (createdEmp)
          await call(
            endpoints,
            'admin-employee-delete',
            { id: createdEmp },
            'cleanup:no-employment',
          ).catch(() => undefined);
      }
    },
  );
});
