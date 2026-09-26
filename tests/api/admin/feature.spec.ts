// An orchestrated Admin/HR org-setup lifecycle (tier → variable → location → HR → employee → clean up),
// not simple assertions; the conditionals guard optional steps and best-effort teardown of real records.
/* eslint-disable playwright/no-conditional-in-test, playwright/no-conditional-expect */
import type { ApiResponseWrapper } from '@api/client/response-wrapper';
import { AUTH_PROFILES } from '@config/auth-profile';
import type { Principal } from '@config/auth.config';
import { testData } from '@config/test-data.config';
import type { EndpointExecutor } from '@engine/endpoint-executor';
import { isPlainObject } from '@utils/json';
import { expect, test } from '@fixtures';

/**
 * Admin module **feature flow** — the organisation-build sequence a BUSINESS_M admin runs in the
 * Admin/HR-Setup module (`kpostadmin.kpostindia.com` UI / `adminmodule.kpostindia.com` API), end to
 * end on live, self-cleaning. Full flow: `docs/admin-flow.md`. Payloads measured from the frontend
 * (`ADMIN_HR_MODULES_25/src/Services/{AdminSetup,HumanResources}.js`), not guessed:
 *
 *   - tier/variable/location **saves are ARRAYS**; the created id is at `value[i].id`.
 *   - a single save's id is at `value.id`; the envelope is `{ value, status, statusCode }`.
 *   - branch on the envelope `status` ("SUCCESS"/"FAILURE"), NOT the HTTP code — a documented backend
 *     quirk returns HTTP 500 on some success paths.
 *
 * Two tiers of write, split by side effect:
 *
 *  - **`ADMIN_LIFECYCLE=true`** — the SAFE structure: workplace tier→variable→location, HR
 *    tier→variable, and an employee master record. All are pure Mongo inserts with **no external side
 *    effect** (confirmed in `EmployeeDetailsServiceImpl.java`: no OTP/invite/login), so the flow
 *    creates then deletes every record (teardown in reverse dependency order — deletes are hard, no
 *    cascade). It also drives the id-keyed reads (`getLocation`, `getLocationById`, the reporting
 *    hierarchies, `getRolePostingByCompanyIdAndEmployeeId`) with the real ObjectIds it minted.
 *  - **`ADMIN_ROLE_POSTING_LIVE=true`** (above the first) — role posting. `rolePosting/save` and the
 *    assign (`rolePosting/update`) **provision a real KPost + KSMACC account via external services**
 *    (`RolePostingSetUpServiceImpl.sendKPostUserRequest` → login.ksmacc.in), which **cannot be cleanly
 *    torn down**. So, exactly like KOS's metered AI, it is held behind a SECOND explicit flag and is
 *    owner-authorized; a normal run never provisions an account.
 *
 * Every write carries `allowLiveWrite: true` (the authorized-write control), runs as the BUSINESS_M
 * admin, and uses `expect.soft` so one run reports every finding.
 *
 * **2026-09-26: closed 4 of this module's undocumented coverage gaps** (no FRD exists for this
 * module, so each was verified directly against live behaviour rather than a spec):
 * `admin-workplace-tier-attribute-by-company` and `admin-hr-tier-attribute-by-company` now assert
 * the just-created attribute genuinely appears on a fresh company-scoped read (not just that the
 * save answered success); `admin-role-posting-by-company` asserts every returned row genuinely
 * belongs to this company. `admin-country-address-by-pincode` is a dependency-free reference lookup,
 * moved to `reads-workflow.spec.ts` instead, ungated.
 *
 * **`admin-role-posting-suspended-list`** (`getSuspendOrTerminateEmployee`) remains genuinely
 * blocked: its `requestType` filter value is Unknown/Requires Clarification. Every value tried live
 * 2026-09-26 — `SUSPEND`, `TERMINATE`, `SUSPEND_TERMINATE`, `ACTIVE`, `INACTIVE`, `ALL`, `Suspended`,
 * `suspended`, `SUSPENDED_TERMINATED`, `BOTH`, plus numeric/boolean/null variants and alternate field
 * names (`status`, `type`, `requestStatus`, `employeeStatus`) — 400s identically to the originally
 * documented `"SUSPENDED"`. No frontend source for this build was available to confirm the real
 * enum. See `needs-id-workflow.spec.ts`.
 *
 * **`ADMIN_ROLE_POSTING_LIVE` is a documented but UNWIRED gate**: no code anywhere in this repo
 * actually checks `process.env.ADMIN_ROLE_POSTING_LIVE`, so `admin-role-posting-save`/`-update`/
 * `-delete`/`-suspend-terminate` have never been run, even with the flag set. Wiring it up would make
 * this flow able to run for the first time — not done without explicit owner sign-off first, since
 * it provisions a real, non-reversible external KSMACC account per run. See `needs-id-workflow.spec.ts`.
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
    { label: `feature:admin:${label}`, auth: { principal: businessM! }, allowLiveWrite: true },
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

  test('workplace + HR + employee: create → read-back → self-clean @api @admin-api', async ({
    endpoints,
  }) => {
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
        [{ attributeName: name('WP Tier'), companyId: cid() }],
        'wp-attr-save',
      );
      wpAttrId = createdId(wpAttr);
      expect.soft(statusOf(wpAttr), 'workplace tier attribute saved').toMatch(/success/i);
      expect.soft(wpAttrId, 'workplace tier attribute returns an id').toBeTruthy();

      // Read back the company's tier attributes and confirm the one just created is really in there
      // — not just "the save answered success", but that it is actually visible on a fresh read.
      const wpAttrList = await call(
        endpoints,
        'admin-workplace-tier-attribute-by-company',
        { companyId: cid() },
        'wp-attr-by-company',
      );
      expect.soft(statusOf(wpAttrList), 'workplace tier attributes read back').toMatch(/success/i);
      const wpAttrRows = envelope(wpAttrList).value;
      expect
        .soft(
          Array.isArray(wpAttrRows) && wpAttrRows.some((r) => isPlainObject(r) && r.id === wpAttrId),
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
              companyId: cid(),
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
        { companyId: cid(), parentVariableId: 0 },
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
        const wpAttrUpd = await call(
          endpoints,
          'admin-workplace-tier-attribute-update',
          { id: wpAttrId, companyId: cid(), attributeName: name('WP Tier edited') },
          'wp-attr-update',
        );
        expect.soft(statusOf(wpAttrUpd), 'workplace tier attribute updated').toMatch(/success/i);
      }
      if (wpVarId) {
        const wpVarUpd = await call(
          endpoints,
          'admin-workplace-tier-variable-update',
          {
            id: wpVarId,
            companyId: cid(),
            attributeId: wpAttrId,
            variableName: name('WP Var edited'),
          },
          'wp-var-update',
        );
        expect.soft(statusOf(wpVarUpd), 'workplace tier variable updated').toMatch(/success/i);
      }

      // ---- Work Place Location Setup ---------------------------------------------------------
      if (wpAttrId && wpVarId) {
        const loc = await call(
          endpoints,
          'admin-workplace-location-save',
          [
            {
              companyId: cid(),
              attributeId: wpAttrId,
              variableId: wpVarId,
              locationName: name('Location'),
              reportingWorkplaceLocation: '[{"variableId":"0","workplaceLocationId":"0"}]',
              reportingWorkplaceLocationId: '0',
              pincode: testData.pinCode,
              countryName: 'India',
              countryId: 1,
            },
          ],
          'loc-save',
        );
        locId = createdId(loc);
        expect.soft(statusOf(loc), 'workplace location saved').toMatch(/success/i);
        expect.soft(locId, 'workplace location returns an id').toBeTruthy();

        // The location reads, now with real ids.
        const locAll = await call(
          endpoints,
          'admin-workplace-location-all',
          { companyId: cid() },
          'loc-all',
        );
        expect.soft(statusOf(locAll), 'all locations read').toMatch(/success/i);
        const locGet = await call(
          endpoints,
          'admin-workplace-location-get',
          { companyId: cid(), attributeId: wpAttrId, variableId: wpVarId },
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
          const locUpd = await call(
            endpoints,
            'admin-workplace-location-update',
            { id: locId, companyId: cid(), locationName: name('Location edited') },
            'loc-update',
          );
          expect.soft(statusOf(locUpd), 'workplace location updated').toMatch(/success/i);
        }
      }

      /*
       * Fixed 2026-09-26, found while adding new coverage to this file (unrelated to it): this call
       * always threw before reaching the HR/employee/role-posting sections below, so none of those
       * had ever actually run to completion in this suite's history. Two bugs, both now fixed:
       *   1. `admin-workplace-hierarchy` is `destructive: false`, not `productionSafe` — it needs
       *      `allowLiveRead`, not `allowLiveWrite` (the `call()` helper's blanket flag, fine for the
       *      other `productionSafe` reads in this file, doesn't unlock this one).
       *   2. Its own definition documents "400 without a real parentAttributeId" — the call sent only
       *      `{ companyId }`, never the real one this test already minted (`wpAttrId`/`wpVarId`).
       * Fixing those two unblocked everything below (HR/employee/role-posting never used to run at
       * all), but the endpoint's own contract is still Unknown/Requires Clarification: a real Mongo
       * ObjectId in `parentAttributeId`/`parentVariableId` gets 400 "Request parameter is invalid" —
       * a DIFFERENT error than the "…is required" it gives with none at all, so some value is
       * expected but a real id isn't accepted either. No confirmed payload produces 200 yet. Left
       * soft (not hard) so this genuine, still-open finding doesn't block the sections after it.
       */
      const hierarchy = await endpoints.sendTo(
        'admin-workplace-hierarchy',
        { body: { companyId: cid(), parentAttributeId: wpAttrId ?? '0', parentVariableId: wpVarId ?? '0' } },
        { label: 'feature:admin:hierarchy', auth: { principal: businessM! }, allowLiveRead: true },
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
        [{ attributeName: name('HR Tier'), companyId: cid() }],
        'hr-attr-save',
      );
      hrAttrId = createdId(hrAttr);
      expect.soft(statusOf(hrAttr), 'HR tier attribute saved').toMatch(/success/i);
      expect.soft(hrAttrId, 'HR tier attribute returns an id').toBeTruthy();

      // Same real cross-check as the workplace side: the created attribute must actually show up on
      // a fresh company-scoped read, not just be claimed by the save response.
      const hrAttrList = await call(
        endpoints,
        'admin-hr-tier-attribute-by-company',
        { companyId: cid() },
        'hr-attr-by-company',
      );
      expect.soft(statusOf(hrAttrList), 'HR tier attributes read back').toMatch(/success/i);
      const hrAttrRows = envelope(hrAttrList).value;
      expect
        .soft(
          Array.isArray(hrAttrRows) && hrAttrRows.some((r) => isPlainObject(r) && r.id === hrAttrId),
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
              companyId: cid(),
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
        { companyId: cid(), parentVariableId: 0 },
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
        const hrAttrUpd = await call(
          endpoints,
          'admin-hr-tier-attribute-update',
          { id: hrAttrId, companyId: cid(), attributeName: name('HR Tier edited') },
          'hr-attr-update',
        );
        expect.soft(statusOf(hrAttrUpd), 'HR tier attribute updated').toMatch(/success/i);
      }
      if (hrVarId) {
        const hrVarUpd = await call(
          endpoints,
          'admin-hr-tier-variable-update',
          {
            id: hrVarId,
            companyId: cid(),
            attributeId: hrAttrId,
            variableName: name('HR Var edited'),
          },
          'hr-var-update',
        );
        expect.soft(statusOf(hrVarUpd), 'HR tier variable updated').toMatch(/success/i);
      }

      // ---- Employee Data (side-effect-free Mongo record) -------------------------------------
      const emp = await call(
        endpoints,
        'admin-employee-save',
        {
          companyId: cid(),
          personalInformationObj: {
            firstName: 'QA',
            lastName: `Employee ${stamp}`,
            disability: false,
          },
          // FINDING: without `employmentObj` the backend NPEs (HTTP 500,
          // "getEmploymentObj() is null") instead of a 400 — a missing required field returned as a
          // server error. Sent so the lifecycle proceeds; the 500-on-missing-field is worth a ticket.
          employmentObj: {},
        },
        'employee-save',
      );
      empId = createdId(emp);
      expect.soft(statusOf(emp), 'employee saved').toMatch(/success/i);
      expect.soft(empId, 'employee returns an id').toBeTruthy();

      const empList = await call(
        endpoints,
        'admin-employee-details',
        { companyId: cid() },
        'employee-list',
      );
      expect.soft(statusOf(empList), 'employees read back').toMatch(/success/i);
      const empByCompany = await call(
        endpoints,
        'admin-role-posting-employees',
        { companyId: cid() },
        'role-employees',
      );
      expect.soft(statusOf(empByCompany), 'role-posting employees read').toMatch(/success/i);

      // The plain company-wide role-posting list: a data-quality check (every row genuinely belongs
      // to this company), cross-checked against the single-employee read below once empId exists.
      const rolePostingsByCompany = await call(
        endpoints,
        'admin-role-posting-by-company',
        { companyId: cid() },
        'role-posting-by-company',
      );
      expect.soft(statusOf(rolePostingsByCompany), 'role postings by company read').toMatch(/success/i);
      const rolePostingRows = envelope(rolePostingsByCompany).value;
      expect
        .soft(
          Array.isArray(rolePostingRows) &&
            rolePostingRows.every((r) => isPlainObject(r) && r.companyId === cid()),
          'every role posting returned genuinely belongs to this company',
        )
        .toBe(true);

      if (empId) {
        const empUpdate = await call(
          endpoints,
          'admin-employee-update',
          {
            id: empId,
            companyId: cid(),
            personalInformationObj: { firstName: 'QA', lastName: `Employee ${stamp} edited` },
            employmentObj: {},
          },
          'employee-update',
        );
        expect.soft(statusOf(empUpdate), 'employee updated').toMatch(/success/i);

        const roleByEmp = await call(
          endpoints,
          'admin-role-posting-by-company-and-employee',
          { companyId: cid(), employeeId: empId },
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
  });
});
