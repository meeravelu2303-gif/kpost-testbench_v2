import { AUTH_PROFILES } from '@config/auth-profile';
import type { Principal } from '@config/auth.config';
import { isProvided, testData } from '@config/test-data.config';
import type { EndpointExecutor } from '@engine/endpoint-executor';
import { expect, test } from '@fixtures';

/**
 * Admin **role posting, end to end** on the QA testing company (BUSINESS_M, company 242): build the org
 * structure it needs, save a role posting, assign a QA employee to it, suspend, revoke, terminate, delete —
 * then remove every record in reverse order.
 *
 * Owner-authorized 2026-10-23, QA testing companies only: role posting's KPost calls go to testingapi
 * (Admin_Module d7abadf); KSMACC has no test server, so the live one is accepted (#13234 WONTFIX). Each run
 * creates a KPost account on testingapi and a KSMACC account (deactivated by the terminate step). The
 * assign step's KPost SMS template does not send (owner). The employee's mobile and email are the reserved
 * QA test-employee identity (QA_ROLE_EMPLOYEE_MOBILE / QA_ROLE_EMPLOYEE_EMAIL): the QA-identifier guard trusts
 * them only when they are set in .env, exactly like every other QA identity.
 *
 * Payloads are the Admin screens' own (ADMIN_HR_MODULES_25, read 2026-10-23):
 *   save    RolePostingSetup.js:553-634       update  AssignRolePosting.js:322-331 (requestType 'reallocate')
 *   suspend Suspend.js:273-283                revoke  Revoke.js:168-178   terminate Terminate.js:176-186
 * and the backend's needs (RolePostingSetUpServiceImpl): the assign step reads the employee's name, mobile,
 * gender, date of birth and residential country/state/zip; update needs id, employeeId and rolePostingId;
 * a posting can only be deleted once terminate has unassigned it.
 */
const K = AUTH_PROFILES.kpost;
const businessM: Principal | undefined = K.principals.find((p) => p.key === 'business-m');
const stamp = Date.now();
const name = (label: string): string => `QA ${label} ${stamp}`;
const today = (): string => new Date().toISOString().slice(0, 10);

interface Envelope {
  value?: unknown;
  status?: string;
  error?: unknown;
}

async function send(
  endpoints: EndpointExecutor,
  id: string,
  body: unknown,
  label: string,
  minted: readonly (string | number)[] = [],
): Promise<{ status: number; env: Envelope; text: string }> {
  const ex = await endpoints.sendTo(
    id,
    { body },
    {
      label: `role-posting:${label}`,
      auth: { principal: businessM! },
      allowLiveWrite: true,
      // Ids THIS test's save just minted (the posting's kpostID / KSMACC ids) — trusted for this call only.
      ownedIdentifiers: minted,
      // The save/assign/terminate steps call KPost and KSMACC before answering.
      timeoutMs: 60_000,
    },
  );
  const text = ex.bodyText ?? '';
  let env: Envelope;
  try {
    env = JSON.parse(text) as Envelope;
  } catch {
    env = {};
  }
  return { status: ex.status, env, text };
}

/** The identifiers the server minted for OUR posting (from our own save/list response), never literals. */
function mintedBy(posting: Record<string, unknown>): Array<string | number> {
  return ['kpostID', 'ksmaccID', 'ksmaccCompanyID']
    .map((k) => posting[k])
    .filter((v): v is string | number => typeof v === 'string' || typeof v === 'number');
}

const ok = (r: { status: number; env: Envelope }): boolean =>
  r.status === 200 && r.env.status === 'SUCCESS';

/** `value[0].id` (array saves) or `value.id`. */
function savedId(value: unknown): string | undefined {
  const rec: unknown = Array.isArray(value) ? value[0] : value;
  return rec && typeof rec === 'object' && typeof (rec as { id?: unknown }).id === 'string'
    ? (rec as { id: string }).id
    : undefined;
}

const field = (value: unknown, key: string): string => {
  const rec: unknown = Array.isArray(value) ? value[0] : value;
  if (!rec || typeof rec !== 'object') return '';
  const v = (rec as Record<string, unknown>)[key];
  return typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' ? String(v) : '';
};

test.describe('Admin · role posting, end to end on the QA testing company @api @admin-api', () => {
  test.describe.configure({ timeout: 300_000 });
  test.skip(
    process.env.ADMIN_LIFECYCLE !== 'true' || process.env.ADMIN_ROLE_POSTING_LIVE !== 'true',
    'creates real KPost (testingapi) + KSMACC accounts for the QA company; set ADMIN_LIFECYCLE=true and ADMIN_ROLE_POSTING_LIVE=true',
  );
  test.skip(
    !isProvided('roleEmployeeMobile') || !isProvided('roleEmployeeEmail'),
    'needs the reserved QA test-employee identity in .env (QA_ROLE_EMPLOYEE_MOBILE + QA_ROLE_EMPLOYEE_EMAIL)',
  );
  test.skip(
    !businessM || testData.businessMKpostId.includes('qa.business.m'),
    'needs the BUSINESS_M account of the QA testing company (QA_BUSINESS_M_KPOST_ID + QA_BUSINESS_M_COMPANY_ID)',
  );

  test('save → assign → suspend → revoke → terminate → delete a role posting', async ({
    endpoints,
  }) => {
    expect(String(testData.businessMCompanyId), 'only ever the QA testing company (242)').toBe(
      '242',
    );

    let wpAttrId: string | undefined;
    let wpVarId: string | undefined;
    let locId: string | undefined;
    let hrAttrId: string | undefined;
    let hrVarId: string | undefined;
    let empId: string | undefined;
    let postingId: string | undefined;
    let assigned = false;
    let posting: Record<string, unknown> = {};

    const designation = name('Role Tester');
    let companyName = '';

    try {
      await test.step("the QA company's own name (sent by the screen; KSMACC registers under it)", async () => {
        // Never invented: an existing posting of this company carries it; else the admin's account details.
        const list = await send(endpoints, 'admin-role-posting-by-company', {}, 'company-name');
        const rows = (Array.isArray(list.env.value) ? list.env.value : []) as Array<
          Record<string, unknown>
        >;
        const named = rows.map((r) => r.companyName).find((c) => typeof c === 'string' && c);
        companyName = typeof named === 'string' ? named : '';
        if (!companyName) {
          const me = await endpoints.sendTo(
            'signup-login-fetch-user-details',
            { body: { kpostID: testData.businessMKpostId, countryID: testData.countryId } },
            {
              label: 'role-posting:company-name-profile',
              auth: { principal: businessM! },
              allowLiveRead: true,
            },
          );
          companyName = /"companyName"s*:s*"([^"]+)"/.exec(me.bodyText ?? '')?.[1] ?? '';
        }
        test.info().annotations.push({
          type: 'observed',
          description: `company name: ${companyName || '(not found)'}`,
        });
        test.skip(
          !companyName,
          "the QA company's name could not be read — not invented; set up a role posting or company name first",
        );
      });

      await test.step('org structure: workplace tier, variable, location; HR tier, variable', async () => {
        const wpAttr = await send(
          endpoints,
          'admin-workplace-tier-attribute-save',
          [{ attributeName: name('WP Tier') }],
          'wp-attr',
        );
        wpAttrId = savedId(wpAttr.env.value);
        const wpVarName = name('WP Var');
        const wpVar = await send(
          endpoints,
          'admin-workplace-tier-variable-save',
          [
            {
              variableName: wpVarName,
              attributeId: wpAttrId,
              parentVariableId: 0,
              parentAttributeId: 0,
              reportingJson: '[]',
            },
          ],
          'wp-var',
        );
        wpVarId = savedId(wpVar.env.value);
        const loc = await send(
          endpoints,
          'admin-workplace-location-save',
          [
            {
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
          'location',
        );
        locId = savedId(loc.env.value);
        const hrAttr = await send(
          endpoints,
          'admin-hr-tier-attribute-save',
          [{ attributeName: name('HR Tier') }],
          'hr-attr',
        );
        hrAttrId = savedId(hrAttr.env.value);
        const hrVar = await send(
          endpoints,
          'admin-hr-tier-variable-save',
          [
            {
              variableName: designation,
              attributeId: hrAttrId,
              parentVariableId: 0,
              parentAttributeId: 0,
              reportingJson: '[]',
            },
          ],
          'hr-var',
        );
        hrVarId = savedId(hrVar.env.value);
        for (const [what, id] of Object.entries({ wpAttrId, wpVarId, locId, hrAttrId, hrVarId }))
          expect(id, `${what} created`).toBeTruthy();

        const emp = await send(
          endpoints,
          'admin-employee-save',
          {
            personalInformationObj: {
              firstName: 'QA',
              lastName: `Role${String(stamp).slice(-6)}`,
              dob: '1990-01-15',
              gender: 'Male',
              mobile: testData.roleEmployeeMobile,
              emailAddress: testData.roleEmployeeEmail,
              disability: false,
            },
            residentialObj: {
              residentialCountry: 'India',
              residentialState: 'Tamil Nadu',
              residentialCity: 'Chennai',
              residentialZipCode: testData.pinCode,
            },
            employmentObj: {},
          },
          'employee',
        );
        empId = savedId(emp.env.value);
        expect(ok(emp) && empId, `employee saved: ${emp.text.slice(0, 200)}`).toBeTruthy();
      });

      await test.step('save a role posting (location × HR role)', async () => {
        const saved = await send(
          endpoints,
          'admin-role-posting-save',
          [
            {
              companyName,
              userType: 'BUSINESS_M',
              countryId: 1,
              countryCode: 91,
              lastworkplaceTierId: wpAttrId,
              lastWorkplaceVariableId: wpVarId,
              workplaceJson: JSON.stringify([
                {
                  attributeId: wpAttrId,
                  variableId: wpVarId,
                  label: name('WP Var'),
                  code: '',
                  abbreviation: '',
                },
              ]),
              workplaceLocationId: [locId],
              lastHrTierId: hrAttrId,
              lastHrVariableId: hrVarId,
              hrJson: JSON.stringify([
                {
                  parentAttributeId: hrAttrId,
                  variableId: hrVarId,
                  parentVariableName: designation,
                  code: '',
                  abbreviation: '',
                },
              ]),
              reportingWorkplaceJson: JSON.stringify([
                { workplaceLocationId: '', variableName: ['-'], locationName: '-' },
              ]),
              reportingHrJson: JSON.stringify([
                { variableId: '', variableName: '-', attributeId: hrAttrId },
              ]),
              requestType: 'allocate',
              displayName: `QA ${designation}`.toUpperCase(),
              ksmaccDisplayName: designation.toUpperCase(),
            },
          ],
          'save',
        );
        test.info().annotations.push({
          type: 'observed',
          description: `save → HTTP ${saved.status}: ${saved.text.slice(0, 300)}`,
        });
        const first = (Array.isArray(saved.env.value) ? saved.env.value[0] : undefined) as
          { savedEntities?: Array<Record<string, unknown>>; statusMessage?: string } | undefined;
        // Record the id FIRST, so cleanup always deletes the posting even if a check below fails.
        posting = first?.savedEntities?.[0] ?? {};
        postingId = typeof posting.id === 'string' ? posting.id : undefined;
        expect(ok(saved), 'role posting saved (200 SUCCESS) — #13235').toBe(true);
        // A new posting answers statusMessage "saved" (live 2026-10-23); a duplicate says "Already exists …".
        expect(first?.statusMessage ?? '', 'a new posting, not "Already exists"').not.toMatch(
          /already exists/i,
        );
        expect(postingId, 'the saved posting has an id').toBeTruthy();
        expect(String(posting.companyId), 'stored for the QA company').toBe('242');
        expect(posting.kpostID, 'a KPost id was generated for the posting').toBeTruthy();
        expect(posting.employeeId ?? null, 'nobody assigned yet').toBeNull();
      });

      await test.step('read it back in the company list', async () => {
        const list = await send(endpoints, 'admin-role-posting-by-company', {}, 'list');
        const rows = (Array.isArray(list.env.value) ? list.env.value : []) as Array<
          Record<string, unknown>
        >;
        const mine = rows.find((r) => r.id === postingId);
        expect(mine, 'the new posting is listed').toBeTruthy();
        posting = { ...posting, ...(mine ?? {}) };
      });

      await test.step('assign the QA employee (reallocate)', async () => {
        const assign = await send(
          endpoints,
          'admin-role-posting-update',
          // Exactly the Assign Role Posting screen's body (AssignRolePosting.js:322-331): the posting row
          // spread in, plus the employee — no rolePostingId (the screen's line is commented out). Live
          // 2026-10-23 this gets 400 "rolePostingId is required", and adding it gets 400 "Request
          // parameter is invalid" (the entity has no such field) — #13237.
          {
            companyId: '242',
            ...posting,
            employeeId: empId,
            userType: 'BUSINESS_M',
            companyName,
            requestType: 'reallocate',
          },
          'assign',
          mintedBy(posting),
        );
        test.info().annotations.push({
          type: 'observed',
          description: `assign → HTTP ${assign.status}: ${assign.text.slice(0, 300)}`,
        });
        expect(ok(assign), 'the employee is assigned (200 SUCCESS) — #13237').toBe(true);
        assigned = true;
        expect(field(assign.env.value, 'employeeId'), 'the posting now names the employee').toBe(
          empId,
        );
        expect(field(assign.env.value, 'activeStatus'), 'and is active').toBe('true');

        const mineByEmp = await send(
          endpoints,
          'admin-role-posting-by-company-and-employee',
          { employeeId: empId },
          'by-employee',
        );
        expect(ok(mineByEmp), "the employee's posting reads back").toBe(true);
      });

      const action = (
        requestType: 'suspend' | 'revoked' | 'terminate',
        extra: Record<string, unknown>,
      ) =>
        send(
          endpoints,
          'admin-role-posting-suspend-terminate',
          {
            rolePostingId: postingId,
            employeeId: empId,
            requestType,
            reason: 'QA lifecycle',
            remarks: `QA lifecycle ${requestType}`,
            kpostID: posting.kpostID,
            ksmaccID: posting.ksmaccID,
            ...extra,
          },
          requestType,
          mintedBy(posting),
        );

      await test.step('suspend the employee; they appear in the suspended list', async () => {
        const suspended = await action('suspend', {
          duration: JSON.stringify({ suspensionFrom: today(), suspensionTo: today() }),
        });
        test.info().annotations.push({
          type: 'observed',
          description: `suspend → HTTP ${suspended.status}: ${suspended.text.slice(0, 200)}`,
        });
        expect(ok(suspended), 'suspended (200 SUCCESS)').toBe(true);
        const list = await send(
          endpoints,
          'admin-role-posting-suspended-list',
          { requestType: 'suspend' },
          'suspended-list',
        );
        expect(list.text, 'the suspended list names the posting').toContain(String(postingId));
      });

      await test.step('revoke the suspension (rejoin today)', async () => {
        const revoked = await action('revoked', { rejoiningDate: Date.now() });
        test.info().annotations.push({
          type: 'observed',
          description: `revoke → HTTP ${revoked.status}: ${revoked.text.slice(0, 200)}`,
        });
        expect(ok(revoked), 'revoked (200 SUCCESS)').toBe(true);
      });

      await test.step('terminate the employee; the posting is unassigned', async () => {
        const terminated = await action('terminate', {
          duration: JSON.stringify({ dateOfTermination: today(), name: 'QA lifecycle' }),
        });
        test.info().annotations.push({
          type: 'observed',
          description: `terminate → HTTP ${terminated.status}: ${terminated.text.slice(0, 200)}`,
        });
        expect(ok(terminated), 'terminated (200 SUCCESS)').toBe(true);
        assigned = false;
        const list = await send(
          endpoints,
          'admin-role-posting-by-company',
          {},
          'list-after-terminate',
        );
        const row = (
          (Array.isArray(list.env.value) ? list.env.value : []) as Array<Record<string, unknown>>
        ).find((r) => r.id === postingId);
        expect(row?.employeeId ?? null, 'nobody is assigned after terminate').toBeNull();
      });

      await test.step('delete the posting', async () => {
        const removed = await send(
          endpoints,
          'admin-role-posting-delete',
          { id: postingId },
          'delete',
        );
        expect(ok(removed), 'the unassigned posting is deleted (200 SUCCESS)').toBe(true);
        postingId = undefined;
      });
    } finally {
      // Reverse order; every step tolerant, so one failure never strands the rest.
      if (postingId && assigned && empId)
        await send(
          endpoints,
          'admin-role-posting-suspend-terminate',
          {
            rolePostingId: postingId,
            employeeId: empId,
            requestType: 'terminate',
            reason: 'QA cleanup',
            remarks: 'QA cleanup',
            duration: JSON.stringify({ dateOfTermination: today(), name: 'QA cleanup' }),
          },
          'cleanup-terminate',
          mintedBy(posting),
        ).catch(() => undefined);
      if (postingId)
        await send(
          endpoints,
          'admin-role-posting-delete',
          { id: postingId },
          'cleanup-posting',
        ).catch(() => undefined);
      for (const [id, rec] of [
        ['admin-employee-delete', empId],
        ['admin-workplace-location-delete', locId],
        ['admin-hr-tier-variable-delete', hrVarId],
        ['admin-hr-tier-attribute-delete', hrAttrId],
        ['admin-workplace-tier-variable-delete', wpVarId],
        ['admin-workplace-tier-attribute-delete', wpAttrId],
      ] as const)
        if (rec) await send(endpoints, id, { id: rec }, `cleanup-${id}`).catch(() => undefined);
    }
  });
});
