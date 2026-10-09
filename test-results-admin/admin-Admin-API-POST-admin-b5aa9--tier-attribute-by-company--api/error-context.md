# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: api\admin.spec.ts >> Admin API >> POST /adminTierAttribute/getAttributeByCompanyId [admin-workplace-tier-attribute-by-company]
- Location: src\validation-engine\contract-suite.ts:38:9

# Error details

```
Error: Endpoint: POST /adminTierAttribute/getAttributeByCompanyId (admin-workplace-tier-attribute-by-company)
Profile: FULL | Environment: production | Build: local | Run: run-9a84bcda-f70b-4b0d-85eb-bd81788317e2
Correlation ID: tb-1ddbbc83-449a-4812-9372-0f550cd653fb | Duration: 4503ms

STATUS  CATEGORY       VALIDATOR                               SEVERITY  TIME    MESSAGE
PASSED  RESPONSE       response.status-code                    CRITICAL  0ms     status 200
PASSED  RESPONSE       response.content-type                   HIGH      0ms     Content-Type application/json
SKIPPED RESPONSE       response.binary-content                 MEDIUM    0ms     not a binary/image endpoint
SKIPPED RESPONSE       response.headers                        MEDIUM    0ms     admin requires no response headers
PASSED  RESPONSE       response.structure                      HIGH      0ms     valid success envelope
SKIPPED RESPONSE       response.schema                         CRITICAL  0ms     endpoint defines no response schema
SKIPPED RESPONSE       response.metadata                       LOW       0ms     admin responses carry no metadata block
SKIPPED RESPONSE       response.pagination                     MEDIUM    0ms     endpoint is not paginated
SKIPPED PERFORMANCE    performance.timeout                     HIGH      0ms     not run against the live application: provokes timeouts, holding real connections
PASSED  PERFORMANCE    performance.response-time               MEDIUM    0ms     20ms (budget 1500ms)
SKIPPED PERFORMANCE    performance.payload-size                LOW       0ms     not run against the live application: sends oversized bodies at a live service
PASSED  AUTHENTICATION authentication.valid-token              CRITICAL  0ms     valid COMPANY_ADMIN token accepted
PASSED  SECURITY       security.security-headers               MEDIUM    0ms     6 security headers passed
PASSED  COMMON_DATA    common.id                               MEDIUM    0ms     76 ID checks passed
SKIPPED COMMON_DATA    common.email                            MEDIUM    0ms     no email fields in response
SKIPPED COMMON_DATA    common.date                             MEDIUM    0ms     no date fields in response
SKIPPED COMMON_DATA    common.url                              MEDIUM    0ms     no URL fields in response
SKIPPED COMMON_DATA    common.boolean                          LOW       0ms     no boolean fields in response
PASSED  AUTHENTICATION authentication.missing-token            CRITICAL  8ms     1 missing-token cases passed
PASSED  AUTHENTICATION authentication.invalid-token            CRITICAL  442ms   2 invalid-token cases passed
SKIPPED AUTHENTICATION authentication.expired-token            HIGH      0ms     no expired token available for this environment (set EXPIRED_TOKEN)
PASSED  AUTHENTICATION authentication.malformed-token          HIGH      41ms    7 malformed-token cases passed
SKIPPED AUTHORIZATION  authorization.role                      HIGH      0ms     not run against the live application: requires a principal that must not be exercised on live
SKIPPED AUTHORIZATION  authorization.permission                CRITICAL  0ms     not run against the live application: requires a principal that must not be exercised on live
SKIPPED AUTHORIZATION  authorization.cross-resource-access     CRITICAL  0ms     not run against the live application: requests another tenant's records by design
SKIPPED AUTHORIZATION  authorization.privilege-escalation      CRITICAL  0ms     not run against the live application: attempts to act above the caller’s role
SKIPPED REQUEST        request.required-fields                 HIGH      2ms     no applicable negative request cases
SKIPPED REQUEST        request.null-value                      HIGH      0ms     no applicable negative request cases
SKIPPED REQUEST        request.empty-value                     MEDIUM    0ms     no applicable negative request cases
SKIPPED REQUEST        request.data-type                       HIGH      0ms     no applicable negative request cases
SKIPPED REQUEST        request.boundary-value                  HIGH      0ms     no applicable negative request cases
SKIPPED REQUEST        request.enum                            HIGH      0ms     no applicable negative request cases
SKIPPED REQUEST        request.format                          HIGH      0ms     no applicable negative request cases
SKIPPED REQUEST        request.unknown-fields                  MEDIUM    0ms     no applicable negative request cases
FAILED  REQUEST        request.invalid-payload                 HIGH      52ms    3/3 negative request cases failed: body.(root): array instead of object (expected [400,422], got 200); body.(r…
PASSED  REQUEST        request.malformed-json                  HIGH      41ms    3 malformed JSON cases passed
PASSED  REQUEST        request.method-not-allowed              MEDIUM    13ms    1 wrong-verb cases passed
PASSED  REQUEST        request.unsupported-media-type          MEDIUM    18ms    1 media-type cases passed
FAILED  REQUEST        request.empty-body                      HIGH      81ms    2/2 empty-body cases failed: no request body (expected [400,422,415], got 200); empty JSON object (expected [4…
PASSED  SECURITY       security.jwt                            HIGH      9ms     1 JWT checks passed
SKIPPED SECURITY       security.injection                      CRITICAL  0ms     not run against the live application: sends SQL/NoSQL payloads that a write endpoint would store
SKIPPED SECURITY       security.xss                            HIGH      0ms     not run against the live application: sends a script tag that a write endpoint would store
SKIPPED SECURITY       security.rate-limit                     MEDIUM    0ms     not run against the live application: deliberately floods the endpoint
PASSED  RESPONSE       response.error-format                   HIGH      1ms     16 error responses passed
SKIPPED AUTHORIZATION  authorization.forbidden                 HIGH      0ms     not run against the live application: requires a principal that must not be exercised on live
SKIPPED SECURITY       security.information-disclosure         HIGH      0ms     not run against the live application: probes neighbouring identifiers belonging to other tenants
PASSED  SECURITY       security.sensitive-data                 CRITICAL  2ms     32 JSON responses contain no sensitive data
PASSED  COMMON_DATA    common.api-error                        HIGH      0ms     16 error responses passed

Summary: 48 validations — 17 passed, 2 failed, 0 warnings, 29 skipped
Quality gate: FAILED (request.invalid-payload, request.empty-body)

expect(received).toEqual(expected) // deep equality

- Expected  - 1
+ Received  + 4

- Array []
+ Array [
+   "request.invalid-payload",
+   "request.empty-body",
+ ]
```

# Test source

```ts
  1  | import { apiRegistry } from '@api/definitions/index';
  2  | import type { EndpointFilter } from '@api/registry/api-registry';
  3  | import type { ValidationProfile } from '@config/constants';
  4  | import { expect, test } from '@fixtures';
  5  | import { formatReport } from '@reporting/report-formatter';
  6  | import { ProductionSafetyError } from './production-guard';
  7  | import { resolveEndpoint, type ResolvedEndpoint } from './validation-policy';
  8  | 
  9  | function tagsFor(endpoint: ResolvedEndpoint): string[] {
  10 |   // The module tag (e.g. @kmail-api) lets one command run exactly one module's contracts.
  11 |   return [
  12 |     '@api',
  13 |     `@${endpoint.suite.id}`,
  14 |     ...endpoint.tags.map((tag) => `@${tag.replace(/\s+/g, '-')}`),
  15 |     ...(endpoint.destructive ? ['@destructive'] : []),
  16 |   ];
  17 | }
  18 | 
  19 | /**
  20 |  * Generates one Playwright test per registered endpoint matching `filter`. Each test runs the
  21 |  * central validation engine — spec files describe WHICH endpoints are tested, never HOW.
  22 |  */
  23 | export function describeEndpointContracts(
  24 |   filter: EndpointFilter,
  25 |   options: { profile?: ValidationProfile; allowEmpty?: boolean } = {},
  26 | ): void {
  27 |   const endpoints = apiRegistry.find(filter).map(resolveEndpoint);
  28 |   if (!endpoints.length) {
  29 |     // A module whose host is not configured registers no endpoints — a skip, not a typo.
  30 |     if (options.allowEmpty) {
  31 |       test.skip(`no endpoints registered for ${JSON.stringify(filter)}`, () => {});
  32 |       return;
  33 |     }
  34 |     throw new Error(`No registered endpoints match ${JSON.stringify(filter)}`);
  35 |   }
  36 | 
  37 |   for (const endpoint of endpoints) {
  38 |     test(
  39 |       `${endpoint.label} [${endpoint.id}]`,
  40 |       { tag: tagsFor(endpoint) },
  41 |       async ({ validationEngine }) => {
  42 |         try {
  43 |           const report = await validationEngine.validate(endpoint.definition, options);
> 44 |           expect(report.gate.blocking, formatReport(report)).toEqual([]);
     |                                                              ^ Error: Endpoint: POST /adminTierAttribute/getAttributeByCompanyId (admin-workplace-tier-attribute-by-company)
  45 |         } catch (error) {
  46 |           if (error instanceof ProductionSafetyError) test.skip(true, error.message);
  47 |           throw error;
  48 |         }
  49 |       },
  50 |     );
  51 |   }
  52 | }
  53 | 
```