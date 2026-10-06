// Adversarial (malformed-input) coverage for the admin write endpoints the generic engine sweep can
// never reach on live production (see `production-guard.ts`: on the live application every write is
// blocked unless `productionSafe` or explicitly authorized — the engine's own fuzzers stay locked out
// on purpose). This file supplies that missing layer by hand: real `allowLiveWrite: true` calls,
// written and reviewed like `feature.spec.ts`'s, scoped to our own QA_BUSINESS_M_COMPANY_ID only.
//
// 2026-09-26: an earlier attempt tested a locally-run checkout of the Admin_Module backend instead
// (so the generic fuzzer could run unrestricted). Retired — the local checkout may be stale relative
// to what is actually deployed, and it also doesn't enforce authentication at all, so most of what it
// found (missing-token accepted, etc.) turned out to be local-environment artifacts, not real
// findings. Local source is still consulted as reference documentation (e.g. it is how the
// role-posting external-call risk below was found), but every assertion here runs against the real,
// live host, using data this test creates itself and cleans up.
/* eslint-disable playwright/no-conditional-in-test, playwright/no-conditional-expect */
import { AUTH_PROFILES } from '@config/auth-profile';
import type { Principal } from '@config/auth.config';
import { testData } from '@config/test-data.config';
import type { EndpointExecutor } from '@engine/endpoint-executor';
import { isPlainObject } from '@utils/json';
import { expect, test } from '@fixtures';

const K = AUTH_PROFILES.kpost;
const businessM: Principal | undefined = K.principals.find((p) => p.key === 'business-m');
const cid = (): string => String(testData.businessMCompanyId);
const stamp = Date.now();
const name = (label: string): string => `QA FUZZ ${label} ${stamp}`;

function envelope(resp: { bodyText: string }): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(resp.bodyText || '{}');
    return isPlainObject(parsed) ? parsed : {};
  } catch {
    return {};
  }
}
function createdId(resp: { bodyText: string }): string | undefined {
  const v: unknown = envelope(resp).value;
  const record: unknown = Array.isArray(v) ? v[0] : v;
  return isPlainObject(record) && typeof record.id === 'string' ? record.id : undefined;
}

function call(
  endpoints: EndpointExecutor,
  id: string,
  body: unknown,
  label: string,
): ReturnType<EndpointExecutor['sendTo']> {
  return endpoints.sendTo(
    id,
    { body },
    { label: `fuzz:admin:${label}`, auth: { principal: businessM! }, allowLiveWrite: true },
  );
}

/**
 * The standard negative-input battery the generic engine would run (required-fields, null-value,
 * data-type, empty-body, malformed-json) — driven by hand, on live, scoped to our own company.
 * `validBody` is the object whose top-level keys get mutated one at a time; `wrap` places it in the
 * shape the endpoint actually expects (a plain object, or an array-of-one for the `*-save` routes).
 */
async function assertRejectsMalformed(
  endpoints: EndpointExecutor,
  id: string,
  validBody: Record<string, unknown>,
  wrap: (body: Record<string, unknown>) => unknown,
  label: string,
): Promise<void> {
  type Case = { variant: string; body?: unknown; raw?: string };
  const cases: Case[] = [{ variant: 'empty body', body: wrap({}) }];
  for (const key of Object.keys(validBody)) {
    const withoutKey = { ...validBody };
    delete withoutKey[key];
    cases.push({ variant: `missing ${key}`, body: wrap(withoutKey) });
    cases.push({ variant: `null ${key}`, body: wrap({ ...validBody, [key]: null }) });
  }
  cases.push({ variant: 'malformed JSON (truncated)', raw: '{"field": ' });
  cases.push({ variant: 'malformed JSON (trailing comma)', raw: '{"field": 1,}' });

  for (const c of cases) {
    const resp = await endpoints.sendTo(
      id,
      c.raw !== undefined ? { rawBody: c.raw } : { body: c.body },
      { label: `fuzz:admin:${label}:${c.variant}`, auth: { principal: businessM! }, allowLiveWrite: true },
    );
    if (resp.status < 400) {
      endpoints.recordBusinessRuleViolation({
        endpointId: id,
        ruleId: `ADMIN-WRITE-FUZZ-${id}`,
        rule: `${id} must reject a malformed/incomplete request with a 4xx, not accept it`,
        expected: `status >= 400 for "${c.variant}"`,
        actual: `status=${resp.status}, body=${resp.bodyText}`,
        request: c.raw !== undefined ? { rawBody: c.raw } : { body: c.body },
      });
    }
    expect
      .soft(resp.status, `${id}: "${c.variant}" is rejected, not silently accepted`)
      .toBeGreaterThanOrEqual(400);
  }
}

/**
 * Real XSS/SQL-injection payloads in the endpoint's own free-text field (never the identifier
 * fields — a NoSQL-operator injection there, e.g. `{"companyId":{"$ne":null}}`, could affect another
 * company's rows, which is exactly the cross-tenant risk this file avoids). Mirrors the generic
 * engine's `security.xss`/`security.injection` intent by hand, scoped to data only we created.
 * Records a violation if the raw payload comes back byte-for-byte in a read straight after — stored,
 * unescaped, and reflected — regardless of what the response's own Content-Type/nosniff header says,
 * because a different downstream consumer of this same data may not be as careful.
 */
const XSS_PAYLOAD = '<script>alert(document.cookie)</script>';
const SQLI_PAYLOAD = "'; DROP TABLE table_admin_tier_attribute; --";

async function assertPayloadNotStoredVerbatim(
  endpoints: EndpointExecutor,
  saveId: string,
  textField: string,
  makeBody: (value: string) => unknown,
  readBackId: string,
  readBackBody: Record<string, unknown>,
  rowMatches: (row: Record<string, unknown>, value: string) => boolean,
  label: string,
): Promise<void> {
  for (const [kind, payload] of [
    ['XSS', XSS_PAYLOAD],
    ['SQL injection', SQLI_PAYLOAD],
  ] as const) {
    const save = await endpoints.sendTo(
      saveId,
      { body: makeBody(payload) },
      { label: `fuzz:admin:${label}:${kind}:save`, auth: { principal: businessM! }, allowLiveWrite: true },
    );
    if (save.status >= 400) continue; // rejected outright — the good outcome, nothing to check further

    const read = await endpoints.sendTo(
      readBackId,
      { body: readBackBody },
      { label: `fuzz:admin:${label}:${kind}:read`, auth: { principal: businessM! }, allowLiveWrite: true },
    );
    const rows: unknown = envelope(read).value;
    const stored =
      Array.isArray(rows) && rows.some((r) => isPlainObject(r) && rowMatches(r, payload));
    if (stored) {
      endpoints.recordBusinessRuleViolation({
        endpointId: saveId,
        ruleId: `ADMIN-WRITE-FUZZ-XSS-INJECTION-${saveId}`,
        rule: `${saveId}: a ${kind} payload in ${textField} must be rejected or sanitized, not stored and reflected verbatim`,
        expected: `${textField} is not returned byte-for-byte containing the raw payload`,
        actual: `stored and read back unchanged: ${payload}`,
        request: { body: makeBody(payload) },
      });
    }
    expect
      .soft(stored, `${saveId}: a ${kind} payload in ${textField} is not stored and reflected verbatim`)
      .toBe(false);

    // Best-effort cleanup of whatever this created, so the battery leaves nothing behind.
    if (Array.isArray(rows)) {
      const created = (rows as unknown[]).find((r) => isPlainObject(r) && rowMatches(r, payload));
      if (isPlainObject(created) && typeof created.id === 'string') {
        const deleteId = saveId.replace(/-save$/, '-delete');
        await endpoints
          .sendTo(
            deleteId,
            { body: { id: created.id } },
            { label: `fuzz:admin:${label}:${kind}:cleanup`, auth: { principal: businessM! }, allowLiveWrite: true },
          )
          .catch(() => undefined);
      }
    }
  }
}

test.describe('Admin write-endpoint adversarial fuzz (BUSINESS_M, live, own company only)', () => {
  test.skip(
    process.env.ADMIN_LIFECYCLE !== 'true',
    'writes real org structure; set ADMIN_LIFECYCLE=true',
  );
  test.skip(
    !businessM || testData.businessMKpostId.includes('qa.business.m'),
    'needs the BUSINESS_M account (QA_BUSINESS_M_KPOST_ID + QA_BUSINESS_M_COMPANY_ID)',
  );

  test('workplace tier attribute/variable/location, HR tier attribute/variable, employee: malformed writes are all rejected @api @admin-api', async ({
    endpoints,
  }, testInfo) => {
    // This test drives ~130 sequential real HTTP calls against production (setup + the adversarial
    // battery across 9 write endpoints + teardown) — well past the default 60s test timeout.
    testInfo.setTimeout(600_000);
    let wpAttrId: string | undefined;
    let wpVarId: string | undefined;
    let locId: string | undefined;
    let hrAttrId: string | undefined;
    let hrVarId: string | undefined;
    let empId: string | undefined;

    try {
      // ---- Mint one real record per family, exactly like feature.spec.ts, so update/delete fuzzing
      // ---- has a real id from a record WE created — never a guess, never someone else's data.
      const wpAttr = await call(
        endpoints,
        'admin-workplace-tier-attribute-save',
        [{ attributeName: name('WP Tier'), companyId: cid() }],
        'setup:wp-attr-save',
      );
      wpAttrId = createdId(wpAttr);

      const wpVar = wpAttrId
        ? await call(
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
            'setup:wp-var-save',
          )
        : undefined;
      wpVarId = wpVar ? createdId(wpVar) : undefined;

      const loc =
        wpAttrId && wpVarId
          ? await call(
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
              'setup:loc-save',
            )
          : undefined;
      locId = loc ? createdId(loc) : undefined;

      const hrAttr = await call(
        endpoints,
        'admin-hr-tier-attribute-save',
        [{ attributeName: name('HR Tier'), companyId: cid() }],
        'setup:hr-attr-save',
      );
      hrAttrId = createdId(hrAttr);

      const hrVar = hrAttrId
        ? await call(
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
            'setup:hr-var-save',
          )
        : undefined;
      hrVarId = hrVar ? createdId(hrVar) : undefined;

      const emp = await call(
        endpoints,
        'admin-employee-save',
        {
          companyId: cid(),
          personalInformationObj: { firstName: 'QA', lastName: `Fuzz ${stamp}`, disability: false },
          employmentObj: {},
        },
        'setup:employee-save',
      );
      empId = createdId(emp);

      expect
        .soft(
          Boolean(wpAttrId && wpVarId && locId && hrAttrId && hrVarId && empId),
          'setup minted a real id for every family before fuzzing began',
        )
        .toBe(true);

      // ---- The adversarial battery, per family: save (no id needed) + update/delete (real id) ----
      //
      // `companyId` is deliberately excluded from every `assertRejectsMalformed` validBody below
      // (it stays in `assertPayloadNotStoredVerbatim` calls, which test a different thing). Confirmed
      // from source: every one of these controllers calls `companyIdFromToken(request)` and never
      // reads the body's own companyId at all — so "missing/null body.companyId" was never a real
      // required-field case, and including it here produced 10 false bugs (#632-650) this
      // engagement. See feedback_companyid_token_vs_payload_nuance.

      await assertRejectsMalformed(
        endpoints,
        'admin-workplace-tier-attribute-save',
        { attributeName: name('WP Tier Fuzz') },
        (b) => [b],
        'wp-attr-save',
      );
      await assertPayloadNotStoredVerbatim(
        endpoints,
        'admin-workplace-tier-attribute-save',
        'attributeName',
        (payload) => [{ attributeName: payload, companyId: cid() }],
        'admin-workplace-tier-attribute-by-company',
        { companyId: cid() },
        (row, value) => row.attributeName === value,
        'wp-attr-save',
      );
      if (wpAttrId) {
        await assertRejectsMalformed(
          endpoints,
          'admin-workplace-tier-attribute-update',
          { id: wpAttrId, attributeName: name('WP Tier Fuzz edited') },
          (b) => b,
          'wp-attr-update',
        );
      }

      await assertRejectsMalformed(
        endpoints,
        'admin-workplace-tier-variable-save',
        {
          variableName: name('WP Var Fuzz'),
          attributeId: wpAttrId ?? '0',
          parentVariableId: 0,
        },
        (b) => [b],
        'wp-var-save',
      );
      await assertPayloadNotStoredVerbatim(
        endpoints,
        'admin-workplace-tier-variable-save',
        'variableName',
        (payload) => [
          { variableName: payload, companyId: cid(), attributeId: wpAttrId ?? '0', parentVariableId: 0 },
        ],
        'admin-workplace-tier-variable-list',
        { companyId: cid(), parentVariableId: 0 },
        (row, value) => row.variableName === value,
        'wp-var-save',
      );
      if (wpVarId) {
        await assertRejectsMalformed(
          endpoints,
          'admin-workplace-tier-variable-update',
          { id: wpVarId, attributeId: wpAttrId, variableName: name('WP Var Fuzz edited') },
          (b) => b,
          'wp-var-update',
        );
      }

      if (wpAttrId && wpVarId) {
        await assertRejectsMalformed(
          endpoints,
          'admin-workplace-location-save',
          {
            attributeId: wpAttrId,
            variableId: wpVarId,
            locationName: name('Location Fuzz'),
            pincode: testData.pinCode,
            countryId: 1,
          },
          (b) => [b],
          'loc-save',
        );
        await assertPayloadNotStoredVerbatim(
          endpoints,
          'admin-workplace-location-save',
          'locationName',
          (payload) => [
            {
              companyId: cid(),
              attributeId: wpAttrId,
              variableId: wpVarId,
              locationName: payload,
              pincode: testData.pinCode,
              countryId: 1,
            },
          ],
          'admin-workplace-location-all',
          { companyId: cid() },
          (row, value) => row.locationName === value,
          'loc-save',
        );
      }
      if (locId) {
        await assertRejectsMalformed(
          endpoints,
          'admin-workplace-location-update',
          { id: locId, locationName: name('Location Fuzz edited') },
          (b) => b,
          'loc-update',
        );
      }

      await assertRejectsMalformed(
        endpoints,
        'admin-hr-tier-attribute-save',
        { attributeName: name('HR Tier Fuzz') },
        (b) => [b],
        'hr-attr-save',
      );
      await assertPayloadNotStoredVerbatim(
        endpoints,
        'admin-hr-tier-attribute-save',
        'attributeName',
        (payload) => [{ attributeName: payload, companyId: cid() }],
        'admin-hr-tier-attribute-by-company',
        { companyId: cid() },
        (row, value) => row.attributeName === value,
        'hr-attr-save',
      );
      if (hrAttrId) {
        await assertRejectsMalformed(
          endpoints,
          'admin-hr-tier-attribute-update',
          { id: hrAttrId, attributeName: name('HR Tier Fuzz edited') },
          (b) => b,
          'hr-attr-update',
        );
      }

      await assertRejectsMalformed(
        endpoints,
        'admin-hr-tier-variable-save',
        {
          variableName: name('HR Var Fuzz'),
          attributeId: hrAttrId ?? '0',
          parentVariableId: 0,
        },
        (b) => [b],
        'hr-var-save',
      );
      await assertPayloadNotStoredVerbatim(
        endpoints,
        'admin-hr-tier-variable-save',
        'variableName',
        (payload) => [
          { variableName: payload, companyId: cid(), attributeId: hrAttrId ?? '0', parentVariableId: 0 },
        ],
        'admin-hr-tier-variable-list',
        { companyId: cid(), parentVariableId: 0 },
        (row, value) => row.variableName === value,
        'hr-var-save',
      );
      if (hrVarId) {
        await assertRejectsMalformed(
          endpoints,
          'admin-hr-tier-variable-update',
          { id: hrVarId, attributeId: hrAttrId, variableName: name('HR Var Fuzz edited') },
          (b) => b,
          'hr-var-update',
        );
      }

      // `employmentObj` deliberately excluded from this battery: feature.spec.ts already found (and
      // documented) that omitting it entirely 500s with an NPE rather than a clean 400 — a known,
      // real finding, not something to rediscover here. Fuzzing is restricted to the fields that
      // don't already have a confirmed crash, so this file's own findings stay clean.
      await assertRejectsMalformed(
        endpoints,
        'admin-employee-save',
        { personalInformationObj: { firstName: 'QA', lastName: `Fuzz ${stamp}` } },
        (b) => b,
        'employee-save',
      );
      await assertPayloadNotStoredVerbatim(
        endpoints,
        'admin-employee-save',
        'personalInformationObj.lastName',
        (payload) => ({
          companyId: cid(),
          personalInformationObj: { firstName: 'QA', lastName: payload },
          employmentObj: {},
        }),
        'admin-employee-details',
        { companyId: cid() },
        (row, value) =>
          isPlainObject(row.personalInformationObj) && row.personalInformationObj.lastName === value,
        'employee-save',
      );
      if (empId) {
        await assertRejectsMalformed(
          endpoints,
          'admin-employee-update',
          {
            id: empId,
            personalInformationObj: { firstName: 'QA', lastName: `Fuzz ${stamp} edited` },
          },
          (b) => b,
          'employee-update',
        );
      }
    } finally {
      // Teardown in reverse dependency order (best-effort; deletes are hard, no cascade) — exactly
      // feature.spec.ts's pattern, so this file leaves nothing behind beyond what it created.
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
