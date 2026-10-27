// Malformed-input and XSS/injection coverage for the Admin write endpoints, which the engine's own
// fuzzers cannot reach on live. Hand-driven writes on our own QA company only; everything is deleted.

import { AUTH_PROFILES } from '@config/auth-profile';
import type { Principal } from '@config/auth.config';
import { testData } from '@config/test-data.config';
import type { EndpointExecutor } from '@engine/endpoint-executor';
import { isPlainObject } from '@utils/json';
import { expect, test } from '@fixtures';
import { employeePayload, locationPayload, variablePayload } from '../support/screen-payloads';

const K = AUTH_PROFILES.kpost;
const businessM: Principal | undefined = K.principals.find((p) => p.key === 'business-m');
const stamp = Date.now();
const name = (label: string): string => `QA FUZZ ${label} ${stamp}`;

/** Records a malformed `*-save` got accepted (the finding itself); deleted before the parents in teardown. */
const acceptedByFuzz: Array<[deleteEndpointId: string, recordId: string]> = [];

// The keys the screens require (same rules as field-rules-sweep.spec.ts). Only these are removed or
// nulled, so an optional field is never expected to be refused.
const VARIABLE_REQUIRED_ON_UPDATE = ['id', 'attributeId', 'variableName', 'parentVariableId'];
const LOCATION_REQUIRED = [
  'attributeId',
  'variableId',
  'locationName',
  'countryName',
  'pincode',
  'state',
  'city',
  'area',
];
const EMPLOYEE_REQUIRED_SECTIONS = [
  'personalInformationObj',
  'residentialObj',
  'employmentObj',
  'educationObj',
  'workExpObj',
  'additionalObj',
];

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
 * Negative-input battery: empty body, each required key missing or null, malformed JSON.
 * `wrap` puts the body in the shape the endpoint expects (an array of one for `*-save` routes).
 */
async function assertRejectsMalformed(
  endpoints: EndpointExecutor,
  id: string,
  validBody: Record<string, unknown>,
  wrap: (body: Record<string, unknown>) => unknown,
  label: string,
  /** The keys the screen requires (default: every key of `validBody`). */
  required: readonly string[] = Object.keys(validBody),
): Promise<void> {
  type Case = { variant: string; body?: unknown; raw?: string };
  const cases: Case[] = [{ variant: 'empty body', body: wrap({}) }];
  for (const key of required) {
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
      {
        label: `fuzz:admin:${label}:${c.variant}`,
        auth: { principal: businessM! },
        allowLiveWrite: true,
      },
    );
    if (resp.status < 400) {
      const accepted = id.endsWith('-save') ? createdId(resp) : undefined;
      if (accepted) acceptedByFuzz.push([id.replace(/-save$/, '-delete'), accepted]);
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
 * XSS/SQL payloads in a free-text field only (never an id field, where an operator injection could
 * touch another company's rows). A violation if the raw markup is read back verbatim.
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
      {
        label: `fuzz:admin:${label}:${kind}:save`,
        auth: { principal: businessM! },
        allowLiveWrite: true,
      },
    );
    if (save.status >= 400) continue; // rejected outright — the good outcome, nothing to check further

    const read = await endpoints.sendTo(
      readBackId,
      { body: readBackBody },
      {
        label: `fuzz:admin:${label}:${kind}:read`,
        auth: { principal: businessM! },
        allowLiveWrite: true,
      },
    );
    const rows: unknown = envelope(read).value;
    // SQL-looking text is plain data on this MongoDB backend and is accepted by design (#13251), so
    // only markup (XSS) must never come back verbatim.
    const stored =
      kind === 'XSS' &&
      Array.isArray(rows) &&
      rows.some((r) => isPlainObject(r) && rowMatches(r, payload));
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
      .soft(
        stored,
        `${saveId}: a ${kind} payload in ${textField} is not stored and reflected verbatim`,
      )
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
            {
              label: `fuzz:admin:${label}:${kind}:cleanup`,
              auth: { principal: businessM! },
              allowLiveWrite: true,
            },
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
    // ~130 sequential calls: well past the default test timeout.
    testInfo.setTimeout(600_000);
    let wpAttrId: string | undefined;
    let wpVarId: string | undefined;
    let locId: string | undefined;
    let hrAttrId: string | undefined;
    let hrVarId: string | undefined;
    let empId: string | undefined;

    try {
      // ---- Mint one record per family so update fuzzing has a real id we own.
      const wpAttr = await call(
        endpoints,
        'admin-workplace-tier-attribute-save',
        [{ attributeName: name('WP Tier') }],
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
              [locationPayload(wpAttrId, wpVarId, name('Location'))],
              'setup:loc-save',
            )
          : undefined;
      locId = loc ? createdId(loc) : undefined;

      const hrAttr = await call(
        endpoints,
        'admin-hr-tier-attribute-save',
        [{ attributeName: name('HR Tier') }],
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
        employeePayload(`Fuzz ${stamp}`),
        'setup:employee-save',
      );
      empId = createdId(emp);

      expect
        .soft(
          Boolean(wpAttrId && wpVarId && locId && hrAttrId && hrVarId && empId),
          'setup minted a real id for every family before fuzzing began',
        )
        .toBe(true);

      // ---- The battery, per family: save, then update with the real id.
      // No companyId in any body: the backend takes it from the token.

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
        (payload) => [{ attributeName: payload }],
        'admin-workplace-tier-attribute-by-company',
        {},
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
        (payload) => [{ variableName: payload, attributeId: wpAttrId ?? '0', parentVariableId: 0 }],
        'admin-workplace-tier-variable-list',
        { parentVariableId: 0 },
        (row, value) => row.variableName === value,
        'wp-var-save',
      );
      if (wpVarId) {
        await assertRejectsMalformed(
          endpoints,
          'admin-workplace-tier-variable-update',
          { ...variablePayload(wpAttrId!, name('WP Var Fuzz edited')), id: wpVarId },
          (b) => b,
          'wp-var-update',
          VARIABLE_REQUIRED_ON_UPDATE,
        );
      }

      if (wpAttrId && wpVarId) {
        await assertRejectsMalformed(
          endpoints,
          'admin-workplace-location-save',
          locationPayload(wpAttrId, wpVarId, name('Location Fuzz')),
          (b) => [b],
          'loc-save',
          LOCATION_REQUIRED,
        );
        await assertPayloadNotStoredVerbatim(
          endpoints,
          'admin-workplace-location-save',
          'locationName',
          (payload) => [
            { ...locationPayload(wpAttrId!, wpVarId!, name('Location')), locationName: payload },
          ],
          'admin-workplace-location-all',
          {},
          (row, value) => row.locationName === value,
          'loc-save',
        );
      }
      if (locId) {
        await assertRejectsMalformed(
          endpoints,
          'admin-workplace-location-update',
          { ...locationPayload(wpAttrId!, wpVarId!, name('Location Fuzz edited')), id: locId },
          (b) => b,
          'loc-update',
          ['id', ...LOCATION_REQUIRED],
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
        (payload) => [{ attributeName: payload }],
        'admin-hr-tier-attribute-by-company',
        {},
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
        (payload) => [{ variableName: payload, attributeId: hrAttrId ?? '0', parentVariableId: 0 }],
        'admin-hr-tier-variable-list',
        { parentVariableId: 0 },
        (row, value) => row.variableName === value,
        'hr-var-save',
      );
      if (hrVarId) {
        await assertRejectsMalformed(
          endpoints,
          'admin-hr-tier-variable-update',
          { ...variablePayload(hrAttrId!, name('HR Var Fuzz edited')), id: hrVarId },
          (b) => b,
          'hr-var-update',
          VARIABLE_REQUIRED_ON_UPDATE,
        );
      }

      // A missing employmentObj (a known 500, tested in feature.spec.ts) is part of this battery too.
      await assertRejectsMalformed(
        endpoints,
        'admin-employee-save',
        employeePayload(`Fuzz ${stamp}`),
        (b) => b,
        'employee-save',
        EMPLOYEE_REQUIRED_SECTIONS,
      );
      await assertPayloadNotStoredVerbatim(
        endpoints,
        'admin-employee-save',
        'personalInformationObj.lastName',
        (payload) => ({
          ...employeePayload(`Fuzz ${stamp}`),
          personalInformationObj: {
            ...(employeePayload(`Fuzz ${stamp}`).personalInformationObj as Record<string, unknown>),
            lastName: payload,
          },
        }),
        'admin-employee-details',
        {},
        (row, value) =>
          isPlainObject(row.personalInformationObj) &&
          row.personalInformationObj.lastName === value,
        'employee-save',
      );
      if (empId) {
        await assertRejectsMalformed(
          endpoints,
          'admin-employee-update',
          { ...employeePayload(`Fuzz ${stamp} edited`), id: empId },
          (b) => b,
          'employee-update',
          ['id', ...EMPLOYEE_REQUIRED_SECTIONS],
        );
      }
    } finally {
      // Teardown in reverse dependency order (no cascade). Fuzz-accepted records first: they may
      // reference the setup parents below.
      const leftovers: string[] = [];
      for (const [deleteId, recordId] of acceptedByFuzz.splice(0)) {
        const del = await call(
          endpoints,
          deleteId,
          { id: recordId },
          `cleanup:accepted:${deleteId}`,
        )
          .then((r) => r.status)
          .catch(() => 0);
        if (del !== 200) leftovers.push(`${deleteId} ${recordId} (HTTP ${del})`);
      }
      expect
        .soft(leftovers, 'every record a malformed save got accepted is deleted again')
        .toEqual([]);
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
