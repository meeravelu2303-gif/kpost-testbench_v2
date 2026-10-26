import { apiRegistry } from '@api/definitions/index';
import { body } from '@api/definitions/kpost/kpost-endpoint';
import { AUTH_PROFILES } from '@config/auth-profile';
import type { Principal } from '@config/auth.config';
import { isProvided, testData } from '@config/test-data.config';
import type { EndpointExecutor } from '@engine/endpoint-executor';
import type { ValidationEngine } from '@engine/validation-engine';
import { formatReport } from '@reporting/report-formatter';
import { expect, test } from '@fixtures';
import { employeePayload, locationPayload } from './support/screen-payloads';
import { ADMIN_RESPONSE_SCHEMAS } from '@api/definitions/admin/response-schemas';

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
      allowLiveRead: true,
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

/**
 * The centralized engine on a role-posting WRITE, acting on the posting this test owns (coverage 2026-10-26,
 * owner-approved live KSMACC for the QA companies). The definition is cloned `productionSafe` for this call
 * only; the minted ids are trusted for this call only. The engine's primary request performs the step, and
 * its probes (bad/missing/expired tokens) are refused before any account is touched. Same shape as `send`;
 * the report keeps only 2 KB of the answer, so a long answer may not parse — callers read back instead.
 */
async function engineSend(
  validationEngine: ValidationEngine,
  id: string,
  payload: Record<string, unknown> | Array<Record<string, unknown>>,
  minted: readonly (string | number)[] = [],
): Promise<{ status: number; env: Envelope; text: string }> {
  const definition = { ...apiRegistry.get(id), productionSafe: true, request: body(() => payload) };
  const report = await validationEngine.validate(definition, { ownedIdentifiers: minted });
  expect.soft(report.gate.blocking, formatReport(report)).toEqual([]);
  const text = report.primary?.body ?? '';
  let env: Envelope;
  try {
    env = JSON.parse(text) as Envelope;
  } catch {
    env = {};
  }
  return { status: report.primary?.status ?? 0, env, text };
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
    validationEngine,
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
          [locationPayload(wpAttrId!, wpVarId!, name('Location'))],
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
          // The screen's full record. Until 2026-10-26 this employee had no additional information on
          // purpose (#13242's crash case); the server now requires it, so that case cannot be created any
          // more — #13242 was verified fixed the same day.
          employeePayload(`Role${String(stamp).slice(-6)}`),
          'employee',
        );
        empId = savedId(emp.env.value);
        expect(ok(emp) && empId, `employee saved: ${emp.text.slice(0, 200)}`).toBeTruthy();
      });

      await test.step('save a role posting (location × HR role) — engine-checked', async () => {
        const saved = await engineSend(validationEngine, 'admin-role-posting-save', [
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
        ]);
        test.info().annotations.push({
          type: 'observed',
          description: `save → HTTP ${saved.status}: ${saved.text.slice(0, 300)}`,
        });
        // The answer is longer than the report keeps, so find OUR posting in the company list by the HR
        // variable this test created (unique to it). Record the id FIRST, so cleanup always runs.
        const list = await send(endpoints, 'admin-role-posting-by-company', {}, 'list-after-save');
        const rows = (Array.isArray(list.env.value) ? list.env.value : []) as Array<
          Record<string, unknown>
        >;
        posting = rows.find((r) => r.lastHrVariableId === hrVarId) ?? {};
        postingId = typeof posting.id === 'string' ? posting.id : undefined;
        expect(saved.status, 'role posting saved (200) — #13235').toBe(200);
        // A duplicate answers 200 "Already exists …" and saves nothing.
        expect(saved.text, 'a new posting, not "Already exists"').not.toMatch(/already exists/i);
        expect(postingId, 'the saved posting is listed with an id').toBeTruthy();
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

      await test.step('assign the QA employee (reallocate) — engine-checked', async () => {
        const assign = await engineSend(
          validationEngine,
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
          mintedBy(posting),
        );
        test.info().annotations.push({
          type: 'observed',
          description: `assign → HTTP ${assign.status}: ${assign.text.slice(0, 300)}`,
        });
        expect(assign.status, 'the employee is assigned (200) — #13237').toBe(200);
        assigned = true;

        // The answer is longer than the report keeps: confirm through the employee's own read-back.
        const mineByEmp = await send(
          endpoints,
          'admin-role-posting-by-company-and-employee',
          { employeeId: empId },
          'by-employee',
        );
        expect(ok(mineByEmp), "the employee's posting reads back").toBe(true);
        expect(mineByEmp.text, 'the read-back names our posting').toContain(String(postingId));
        expect(field(mineByEmp.env.value, 'employeeId'), 'and the employee').toBe(empId);
        expect(field(mineByEmp.env.value, 'activeStatus'), 'and it is active').toBe('true');
      });

      const action = (
        requestType: 'suspend' | 'revoked' | 'terminate',
        extra: Record<string, unknown>,
        viaEngine = false,
      ) => {
        const payload = {
          rolePostingId: postingId,
          employeeId: empId,
          requestType,
          reason: 'QA lifecycle',
          remarks: `QA lifecycle ${requestType}`,
          kpostID: posting.kpostID,
          ksmaccID: posting.ksmaccID,
          ...extra,
        };
        return viaEngine
          ? engineSend(
              validationEngine,
              'admin-role-posting-suspend-terminate',
              payload,
              mintedBy(posting),
            )
          : send(
              endpoints,
              'admin-role-posting-suspend-terminate',
              payload,
              requestType,
              mintedBy(posting),
            );
      };

      await test.step('suspend the employee — engine-checked; they appear in the suspended list', async () => {
        const suspended = await action(
          'suspend',
          { duration: JSON.stringify({ suspensionFrom: today(), suspensionTo: today() }) },
          true,
        );
        test.info().annotations.push({
          type: 'observed',
          description: `suspend → HTTP ${suspended.status}: ${suspended.text.slice(0, 200)}`,
        });
        expect(ok(suspended), 'suspended (200 SUCCESS) — #13239').toBe(true);
        const list = await send(
          endpoints,
          'admin-role-posting-suspended-list',
          { requestType: 'suspend' },
          'suspended-list',
        );
        // The only point where this list is certainly non-empty (empty answers 400, #320), so its response
        // schema is checked here rather than by the engine.
        const shape = ADMIN_RESPONSE_SCHEMAS['admin-role-posting-suspended-list']!.safeParse(
          JSON.parse(list.text || '{}'),
        );
        expect
          .soft(
            shape.success,
            `the suspended list matches its response schema: ${shape.error?.message ?? ''}`,
          )
          .toBe(true);
        expect(list.text, 'the suspended list names the posting — #13242').toContain(
          String(postingId),
        );
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

      await test.step('delete the posting — engine-checked', async () => {
        const removed = await engineSend(validationEngine, 'admin-role-posting-delete', {
          id: postingId,
        });
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
      let postingGone = !postingId;
      if (postingId) {
        const removed = await send(
          endpoints,
          'admin-role-posting-delete',
          { id: postingId },
          'cleanup-posting',
        ).catch(() => undefined);
        postingGone = Boolean(removed && ok(removed));
      }
      /*
       * Only remove what the posting points at once the posting itself is gone. Deleting the tiers,
       * variables, location or employee under a posting that is still there (e.g. terminate failed, so it
       * stays assigned) leaves an orphan the server can no longer read ("No value present", 2026-10-24).
       */
      if (!postingGone) {
        test.info().annotations.push({
          type: 'cleanup-blocked',
          description: `posting ${postingId} could not be removed; kept its records for a manual clean-up: ${JSON.stringify({ empId, locId, hrVarId, hrAttrId, wpVarId, wpAttrId })}`,
        });
      }
      if (postingGone)
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

/**
 * Role posting field rules (owner 2026-10-26: cover everything in role postings, live KSMACC is fine for the
 * QA companies). The Role Posting Setup screen builds every field from its dropdowns and enables "Add To
 * List" only when all tiers are chosen (RolePostingSetup.js:549-660, 929), so each field it sends is
 * required: save, assign and suspend/terminate must refuse a request without one. Each save case uses a
 * fresh HR variable so "Already exists" cannot hide the answer; a posting the server wrongly accepts is found
 * and deleted. Every case runs (soft checks).
 */
test.describe('Admin · role posting field rules on the QA testing company @api @admin-api', () => {
  test.describe.configure({ timeout: 300_000 });
  test.skip(
    process.env.ADMIN_LIFECYCLE !== 'true' || process.env.ADMIN_ROLE_POSTING_LIVE !== 'true',
    'creates real KPost (testingapi) + KSMACC accounts for the QA company; set ADMIN_LIFECYCLE=true and ADMIN_ROLE_POSTING_LIVE=true',
  );
  test.skip(
    !businessM || testData.businessMKpostId.includes('qa.business.m'),
    'needs the BUSINESS_M account of the QA testing company (QA_BUSINESS_M_KPOST_ID + QA_BUSINESS_M_COMPANY_ID)',
  );

  test('save, assign and suspend/terminate refuse a request missing a field the screen always sends', async ({
    endpoints,
  }) => {
    expect(String(testData.businessMCompanyId), 'only ever the QA testing company (242)').toBe(
      '242',
    );
    const made: Array<[string, string]> = []; // [delete endpoint, id], removed in reverse
    const postings = new Set<string>();
    const create = async (saveId: string, payload: unknown, label: string): Promise<string> => {
      const r = await send(endpoints, saveId, payload, label);
      const id = savedId(r.env.value);
      expect(id, `setup: ${label} (HTTP ${r.status} ${r.text.slice(0, 120)})`).toBeTruthy();
      made.push([saveId.replace(/-save$/, '-delete'), id!]);
      return id!;
    };
    /** Postings in the company list that this test created (by our HR variable or display name). */
    const ours = async (hrVarId: string, displayName: string): Promise<string[]> => {
      const list = await send(endpoints, 'admin-role-posting-by-company', {}, 'list');
      const rows = (Array.isArray(list.env.value) ? list.env.value : []) as Array<
        Record<string, unknown>
      >;
      return rows
        .filter((r) => r.lastHrVariableId === hrVarId || r.displayName === displayName)
        .map((r) => String(r.id));
    };

    try {
      const wpAttrId = await create(
        'admin-workplace-tier-attribute-save',
        [{ attributeName: name('RF WP Tier') }],
        'wp-attr',
      );
      const wpVarId = await create(
        'admin-workplace-tier-variable-save',
        [
          {
            variableName: name('RF WP Var'),
            attributeId: wpAttrId,
            parentVariableId: 0,
            parentAttributeId: 0,
            reportingJson: '[]',
          },
        ],
        'wp-var',
      );
      const locId = await create(
        'admin-workplace-location-save',
        [locationPayload(wpAttrId, wpVarId, name('RF Location'))],
        'location',
      );
      const hrAttrId = await create(
        'admin-hr-tier-attribute-save',
        [{ attributeName: name('RF HR Tier') }],
        'hr-attr',
      );
      const company = await send(endpoints, 'admin-role-posting-by-company', {}, 'company-name');
      let companyName =
        (
          (Array.isArray(company.env.value) ? company.env.value : []) as Array<
            Record<string, unknown>
          >
        )
          .map((r) => r.companyName)
          .find((c): c is string => typeof c === 'string' && c.length > 0) ?? '';
      if (!companyName) {
        // Same fallback as the lifecycle above: the admin's own KPost profile.
        const me = await endpoints.sendTo(
          'signup-login-fetch-user-details',
          { body: { kpostID: testData.businessMKpostId, countryID: testData.countryId } },
          {
            label: 'role-fields:company-name-profile',
            auth: { principal: businessM! },
            allowLiveRead: true,
          },
        );
        companyName = /"companyName"\s*:\s*"([^"]+)"/.exec(me.bodyText ?? '')?.[1] ?? '';
      }
      test.skip(!companyName, 'the QA company name could not be read; not invented');

      /** The screen's save row for a fresh HR variable. */
      const row = async (
        label: string,
      ): Promise<{ body: Record<string, unknown>; hrVarId: string }> => {
        const designation = name(`RF ${label}`);
        const hrVarId = await create(
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
          `hr-var-${label}`,
        );
        return {
          hrVarId,
          body: {
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
                label: name('RF WP Var'),
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
        };
      };

      // Control: the screen's full row saves (a posting with KPost/KSMACC accounts).
      const control = await row('control');
      const saved = await send(
        endpoints,
        'admin-role-posting-save',
        [control.body],
        'save-control',
      );
      expect(saved.status, "BLOCKER: the screen's full row saves").toBe(200);
      const [controlId] = await ours(control.hrVarId, String(control.body.displayName));
      expect(controlId, 'the control posting is listed').toBeTruthy();
      postings.add(controlId!);

      for (const field of [
        'workplaceLocationId',
        'lastHrVariableId',
        'hrJson',
        'workplaceJson',
        'displayName',
        'ksmaccDisplayName',
        'companyName',
        'userType',
        'requestType',
      ]) {
        const c = await row(field);
        const body = { ...c.body };
        delete body[field];
        const r = await send(endpoints, 'admin-role-posting-save', [body], `save-without-${field}`);
        // The exact exchange, so a filed bug's curl carries the real data.
        test.info().annotations.push(
          { type: `request save-without-${field}`, description: JSON.stringify([body]) },
          {
            type: `save-without-${field}`,
            description: `HTTP ${r.status} ${r.text.slice(0, 400)}`,
          },
        );
        // A refusal may come as 400, or as 200 with nothing saved; what must not happen is a new posting.
        const created = await ours(c.hrVarId, String(c.body.displayName));
        created.forEach((id) => postings.add(id));
        expect
          .soft(created, `save without ${field} creates no posting (HTTP ${r.status})`)
          .toHaveLength(0);
      }

      // Assign and suspend/terminate on the (unassigned) control posting, each missing one field.
      const assignBase = {
        id: controlId,
        rolePostingId: controlId,
        employeeId: 'x',
        requestType: 'reallocate',
      };
      for (const field of ['id', 'employeeId']) {
        const body: Record<string, unknown> = { ...assignBase };
        delete body[field];
        const r = await send(
          endpoints,
          'admin-role-posting-update',
          body,
          `assign-without-${field}`,
        );
        expect.soft(r.status, `assign without ${field} is refused`).toBe(400);
      }
      const actionBase = {
        rolePostingId: controlId,
        employeeId: 'x',
        requestType: 'suspend',
        reason: 'QA field rules',
        duration: JSON.stringify({ suspensionFrom: today(), suspensionTo: today() }),
      };
      for (const field of ['rolePostingId', 'employeeId', 'requestType']) {
        const body: Record<string, unknown> = { ...actionBase };
        delete body[field];
        const r = await send(
          endpoints,
          'admin-role-posting-suspend-terminate',
          body,
          `action-without-${field}`,
        );
        expect.soft(r.status, `suspend/terminate without ${field} is refused`).toBe(400);
      }
    } finally {
      const left: string[] = [];
      for (const id of postings) {
        const d = await send(
          endpoints,
          'admin-role-posting-delete',
          { id },
          'cleanup-posting',
        ).catch(() => undefined);
        if (!d || !ok(d)) left.push(`posting ${id}`);
      }
      for (const [deleteId, id] of made.reverse()) {
        const d = await send(endpoints, deleteId, { id }, `cleanup-${deleteId}`).catch(
          () => undefined,
        );
        if (!d || !ok(d)) left.push(`${deleteId} ${id}`);
      }
      expect.soft(left, 'every record this test made is deleted again').toEqual([]);
    }
  });
});
