# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: api\admin\write-fuzz-workflow.spec.ts >> Admin write-endpoint adversarial fuzz (BUSINESS_M, live, own company only) >> workplace tier attribute/variable/location, HR tier attribute/variable, employee: malformed writes are all rejected @api @admin-api
- Location: tests\api\admin\write-fuzz-workflow.spec.ts:182:7

# Error details

```
Error: setup minted a real id for every family before fuzzing began

expect(received).toBe(expected) // Object.is equality

Expected: true
Received: false
```

```
Error: admin-hr-tier-variable-save: "missing attributeId" is rejected, not silently accepted

expect(received).toBeGreaterThanOrEqual(expected)

Expected: >= 400
Received:    200
```

```
Error: admin-hr-tier-variable-save: "null attributeId" is rejected, not silently accepted

expect(received).toBeGreaterThanOrEqual(expected)

Expected: >= 400
Received:    200
```

```
Error: admin-hr-tier-variable-save: "missing parentVariableId" is rejected, not silently accepted

expect(received).toBeGreaterThanOrEqual(expected)

Expected: >= 400
Received:    200
```

```
Error: admin-hr-tier-variable-save: "null parentVariableId" is rejected, not silently accepted

expect(received).toBeGreaterThanOrEqual(expected)

Expected: >= 400
Received:    200
```

# Test source

```ts
  1   | // Adversarial (malformed-input) coverage for the admin write endpoints the generic engine sweep can
  2   | // never reach on live production (see `production-guard.ts`: on the live application every write is
  3   | // blocked unless `productionSafe` or explicitly authorized — the engine's own fuzzers stay locked out
  4   | // on purpose). This file supplies that missing layer by hand: real `allowLiveWrite: true` calls,
  5   | // written and reviewed like `feature.spec.ts`'s, scoped to our own QA_BUSINESS_M_COMPANY_ID only.
  6   | //
  7   | // 2026-09-26: an earlier attempt tested a locally-run checkout of the Admin_Module backend instead
  8   | // (so the generic fuzzer could run unrestricted). Retired — the local checkout may be stale relative
  9   | // to what is actually deployed, and it also doesn't enforce authentication at all, so most of what it
  10  | // found (missing-token accepted, etc.) turned out to be local-environment artifacts, not real
  11  | // findings. Local source is still consulted as reference documentation (e.g. it is how the
  12  | // role-posting external-call risk below was found), but every assertion here runs against the real,
  13  | // live host, using data this test creates itself and cleans up.
  14  | /* eslint-disable playwright/no-conditional-in-test, playwright/no-conditional-expect */
  15  | import { AUTH_PROFILES } from '@config/auth-profile';
  16  | import type { Principal } from '@config/auth.config';
  17  | import { testData } from '@config/test-data.config';
  18  | import type { EndpointExecutor } from '@engine/endpoint-executor';
  19  | import { isPlainObject } from '@utils/json';
  20  | import { expect, test } from '@fixtures';
  21  | 
  22  | const K = AUTH_PROFILES.kpost;
  23  | const businessM: Principal | undefined = K.principals.find((p) => p.key === 'business-m');
  24  | const stamp = Date.now();
  25  | const name = (label: string): string => `QA FUZZ ${label} ${stamp}`;
  26  | 
  27  | function envelope(resp: { bodyText: string }): Record<string, unknown> {
  28  |   try {
  29  |     const parsed: unknown = JSON.parse(resp.bodyText || '{}');
  30  |     return isPlainObject(parsed) ? parsed : {};
  31  |   } catch {
  32  |     return {};
  33  |   }
  34  | }
  35  | function createdId(resp: { bodyText: string }): string | undefined {
  36  |   const v: unknown = envelope(resp).value;
  37  |   const record: unknown = Array.isArray(v) ? v[0] : v;
  38  |   return isPlainObject(record) && typeof record.id === 'string' ? record.id : undefined;
  39  | }
  40  | 
  41  | function call(
  42  |   endpoints: EndpointExecutor,
  43  |   id: string,
  44  |   body: unknown,
  45  |   label: string,
  46  | ): ReturnType<EndpointExecutor['sendTo']> {
  47  |   return endpoints.sendTo(
  48  |     id,
  49  |     { body },
  50  |     { label: `fuzz:admin:${label}`, auth: { principal: businessM! }, allowLiveWrite: true },
  51  |   );
  52  | }
  53  | 
  54  | /**
  55  |  * The standard negative-input battery the generic engine would run (required-fields, null-value,
  56  |  * data-type, empty-body, malformed-json) — driven by hand, on live, scoped to our own company.
  57  |  * `validBody` is the object whose top-level keys get mutated one at a time; `wrap` places it in the
  58  |  * shape the endpoint actually expects (a plain object, or an array-of-one for the `*-save` routes).
  59  |  */
  60  | async function assertRejectsMalformed(
  61  |   endpoints: EndpointExecutor,
  62  |   id: string,
  63  |   validBody: Record<string, unknown>,
  64  |   wrap: (body: Record<string, unknown>) => unknown,
  65  |   label: string,
  66  | ): Promise<void> {
  67  |   type Case = { variant: string; body?: unknown; raw?: string };
  68  |   const cases: Case[] = [{ variant: 'empty body', body: wrap({}) }];
  69  |   for (const key of Object.keys(validBody)) {
  70  |     const withoutKey = { ...validBody };
  71  |     delete withoutKey[key];
  72  |     cases.push({ variant: `missing ${key}`, body: wrap(withoutKey) });
  73  |     cases.push({ variant: `null ${key}`, body: wrap({ ...validBody, [key]: null }) });
  74  |   }
  75  |   cases.push({ variant: 'malformed JSON (truncated)', raw: '{"field": ' });
  76  |   cases.push({ variant: 'malformed JSON (trailing comma)', raw: '{"field": 1,}' });
  77  | 
  78  |   for (const c of cases) {
  79  |     const resp = await endpoints.sendTo(
  80  |       id,
  81  |       c.raw !== undefined ? { rawBody: c.raw } : { body: c.body },
  82  |       { label: `fuzz:admin:${label}:${c.variant}`, auth: { principal: businessM! }, allowLiveWrite: true },
  83  |     );
  84  |     if (resp.status < 400) {
  85  |       endpoints.recordBusinessRuleViolation({
  86  |         endpointId: id,
  87  |         ruleId: `ADMIN-WRITE-FUZZ-${id}`,
  88  |         rule: `${id} must reject a malformed/incomplete request with a 4xx, not accept it`,
  89  |         expected: `status >= 400 for "${c.variant}"`,
  90  |         actual: `status=${resp.status}, body=${resp.bodyText}`,
  91  |         request: c.raw !== undefined ? { rawBody: c.raw } : { body: c.body },
  92  |       });
  93  |     }
  94  |     expect
  95  |       .soft(resp.status, `${id}: "${c.variant}" is rejected, not silently accepted`)
> 96  |       .toBeGreaterThanOrEqual(400);
      |        ^ Error: admin-hr-tier-variable-save: "null parentVariableId" is rejected, not silently accepted
  97  |   }
  98  | }
  99  | 
  100 | /**
  101 |  * Real XSS/SQL-injection payloads in the endpoint's own free-text field (never the identifier
  102 |  * fields — a NoSQL-operator injection there, e.g. `{"companyId":{"$ne":null}}`, could affect another
  103 |  * company's rows, which is exactly the cross-tenant risk this file avoids). Mirrors the generic
  104 |  * engine's `security.xss`/`security.injection` intent by hand, scoped to data only we created.
  105 |  * Records a violation if the raw payload comes back byte-for-byte in a read straight after — stored,
  106 |  * unescaped, and reflected — regardless of what the response's own Content-Type/nosniff header says,
  107 |  * because a different downstream consumer of this same data may not be as careful.
  108 |  */
  109 | const XSS_PAYLOAD = '<script>alert(document.cookie)</script>';
  110 | const SQLI_PAYLOAD = "'; DROP TABLE table_admin_tier_attribute; --";
  111 | 
  112 | async function assertPayloadNotStoredVerbatim(
  113 |   endpoints: EndpointExecutor,
  114 |   saveId: string,
  115 |   textField: string,
  116 |   makeBody: (value: string) => unknown,
  117 |   readBackId: string,
  118 |   readBackBody: Record<string, unknown>,
  119 |   rowMatches: (row: Record<string, unknown>, value: string) => boolean,
  120 |   label: string,
  121 | ): Promise<void> {
  122 |   for (const [kind, payload] of [
  123 |     ['XSS', XSS_PAYLOAD],
  124 |     ['SQL injection', SQLI_PAYLOAD],
  125 |   ] as const) {
  126 |     const save = await endpoints.sendTo(
  127 |       saveId,
  128 |       { body: makeBody(payload) },
  129 |       { label: `fuzz:admin:${label}:${kind}:save`, auth: { principal: businessM! }, allowLiveWrite: true },
  130 |     );
  131 |     if (save.status >= 400) continue; // rejected outright — the good outcome, nothing to check further
  132 | 
  133 |     const read = await endpoints.sendTo(
  134 |       readBackId,
  135 |       { body: readBackBody },
  136 |       { label: `fuzz:admin:${label}:${kind}:read`, auth: { principal: businessM! }, allowLiveWrite: true },
  137 |     );
  138 |     const rows: unknown = envelope(read).value;
  139 |     const stored =
  140 |       Array.isArray(rows) && rows.some((r) => isPlainObject(r) && rowMatches(r, payload));
  141 |     if (stored) {
  142 |       endpoints.recordBusinessRuleViolation({
  143 |         endpointId: saveId,
  144 |         ruleId: `ADMIN-WRITE-FUZZ-XSS-INJECTION-${saveId}`,
  145 |         rule: `${saveId}: a ${kind} payload in ${textField} must be rejected or sanitized, not stored and reflected verbatim`,
  146 |         expected: `${textField} is not returned byte-for-byte containing the raw payload`,
  147 |         actual: `stored and read back unchanged: ${payload}`,
  148 |         request: { body: makeBody(payload) },
  149 |       });
  150 |     }
  151 |     expect
  152 |       .soft(stored, `${saveId}: a ${kind} payload in ${textField} is not stored and reflected verbatim`)
  153 |       .toBe(false);
  154 | 
  155 |     // Best-effort cleanup of whatever this created, so the battery leaves nothing behind.
  156 |     if (Array.isArray(rows)) {
  157 |       const created = (rows as unknown[]).find((r) => isPlainObject(r) && rowMatches(r, payload));
  158 |       if (isPlainObject(created) && typeof created.id === 'string') {
  159 |         const deleteId = saveId.replace(/-save$/, '-delete');
  160 |         await endpoints
  161 |           .sendTo(
  162 |             deleteId,
  163 |             { body: { id: created.id } },
  164 |             { label: `fuzz:admin:${label}:${kind}:cleanup`, auth: { principal: businessM! }, allowLiveWrite: true },
  165 |           )
  166 |           .catch(() => undefined);
  167 |       }
  168 |     }
  169 |   }
  170 | }
  171 | 
  172 | test.describe('Admin write-endpoint adversarial fuzz (BUSINESS_M, live, own company only)', () => {
  173 |   test.skip(
  174 |     process.env.ADMIN_LIFECYCLE !== 'true',
  175 |     'writes real org structure; set ADMIN_LIFECYCLE=true',
  176 |   );
  177 |   test.skip(
  178 |     !businessM || testData.businessMKpostId.includes('qa.business.m'),
  179 |     'needs the BUSINESS_M account (QA_BUSINESS_M_KPOST_ID + QA_BUSINESS_M_COMPANY_ID)',
  180 |   );
  181 | 
  182 |   test('workplace tier attribute/variable/location, HR tier attribute/variable, employee: malformed writes are all rejected @api @admin-api', async ({
  183 |     endpoints,
  184 |   }, testInfo) => {
  185 |     // This test drives ~130 sequential real HTTP calls against production (setup + the adversarial
  186 |     // battery across 9 write endpoints + teardown) — well past the default 60s test timeout.
  187 |     testInfo.setTimeout(600_000);
  188 |     let wpAttrId: string | undefined;
  189 |     let wpVarId: string | undefined;
  190 |     let locId: string | undefined;
  191 |     let hrAttrId: string | undefined;
  192 |     let hrVarId: string | undefined;
  193 |     let empId: string | undefined;
  194 | 
  195 |     try {
  196 |       // ---- Mint one real record per family, exactly like feature.spec.ts, so update/delete fuzzing
```