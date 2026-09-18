# Centralized API validation framework

> **Define once → Register once → Reuse everywhere.**
> Endpoint definitions say **what** an API is. Central validators own **how** common validation works. Business rules stay separate.

## Contents

1. [Final folder structure](#1-final-folder-structure)
2. [What each folder is for](#2-what-each-folder-is-for)
3. [Central validator architecture](#3-central-validator-architecture)
4. [Validator interface](#4-validator-interface)
5. [ValidationResult model](#5-validationresult-model)
6. [ValidationContext model](#6-validationcontext-model)
7. [ValidationRegistry](#7-validationregistry)
8. [ValidationEngine](#8-validationengine)
9. [Default validation policy and profiles](#9-default-validation-policy-and-profiles)
10. [EndpointDefinition](#10-endpointdefinition)
11. [Example endpoint](#11-example-endpoint)
12. [Example test](#12-example-test-using-the-generic-engine)
13. [Example business rule](#13-example-business-rule)
14. [Example DB validation](#14-example-db-validation)
15. [OpenAPI and schema integration](#15-openapi-and-schema-integration)
16. [Example report output](#16-example-report-output)
17. [Adding a completely new API](#17-adding-a-completely-new-api)
18. [Adding a new centralized validator](#18-adding-a-new-centralized-validator)
19. [Disabling one validation for one endpoint](#19-disabling-one-validation-for-one-endpoint)
20. [Commands](#20-commands)
21. [Acceptance scenario and how it is proven](#21-acceptance-scenario-and-how-it-is-proven)
22. [Design decisions and known limits](#22-design-decisions-and-known-limits)

---

## 1. Final folder structure

```
src/
├── config/
│   ├── env.ts                    # environment config (dev/qa/staging/production), validated
│   ├── api.config.ts             # API contract: envelope, headers, error codes, conventions
│   ├── auth.config.ts            # roles, principals, token path, failure statuses
│   ├── database.config.ts        # DB enablement/client/connection (env only)
│   ├── thresholds.config.ts      # response-time/payload/timeout budgets, quality gate
│   └── constants.ts              # paths, tags, validation profiles
├── api/
│   ├── client/                   # api-client · request-builder · response-wrapper · token-provider
│   ├── registry/                 # api-registry · endpoint-definition · endpoint-loader (OpenAPI)
│   ├── schema/contract-schema.ts # zod | JSON Schema → Ajv (single schema engine)
│   ├── schemas/                  # user / company / auth contracts
│   └── definitions/              # auth · health · users · companies · dictionary (OpenAPI) · index
├── validation-engine/
│   ├── validation-engine.ts      # orchestration
│   ├── validation-registry.ts    # validator registry
│   ├── validation-context.ts     # what validators can read/do
│   ├── validation-result.ts      # result/report model + outcome helpers
│   ├── validation-policy.ts      # default policy, profiles, endpoint resolution
│   ├── validator.ts              # Validator contract + defineValidator()
│   ├── endpoint-executor.ts      # sends requests, credentials, setup calls
│   ├── probe.ts                  # the single "send probe + assert status" implementation
│   ├── production-guard.ts       # destructive-in-production protection
│   └── contract-suite.ts         # generates one Playwright test per endpoint
├── validators/
│   ├── authentication/           # valid · missing · invalid · expired · malformed (+empty, bad Bearer)
│   ├── authorization/            # role · permission · forbidden · cross-resource · privilege-escalation
│   ├── request/                  # required · null · empty · data-type · boundary · enum · format ·
│   │                             #   unknown-fields · invalid-payload · malformed-json (+ request-mutation engine)
│   ├── response/                 # status · content-type · headers · structure · schema · error-format ·
│   │                             #   pagination · metadata
│   ├── security/                 # injection (SQL/NoSQL) · xss · rate-limit · sensitive-data ·
│   │                             #   security-headers · jwt · information-disclosure
│   ├── performance/              # response-time · timeout · payload-size
│   ├── common/                   # id · email · date · url · boolean · common-error
│   └── index.ts                  # ← THE registration point
├── business-rules/               # business-rule.ts · users/ · companies/ · index.ts
├── database/                     # database-client · repositories/ · db-assertions · validations/
├── reporting/                    # bugzilla-reporter (writes the single REPORT.md/json + files bugs) · run-summary · bug-report · report-formatter · report-attachment
├── fixtures/ data/ pages/ utils/
openapi/                          # OpenAPI 3.1 documents
mock-server/                      # local stand-in for the KPost API
tests/api · tests/integration · tests/framework · tests/e2e · tests/setup
```

The folder layout follows the requested target architecture, adapted to the existing project. `src/config/env.ts` stays as the environment config rather than being renamed to `environment.config.ts`. `tests/` is split by _kind_ of test (api, integration, framework, e2e). Smoke, regression, security and full are **validation profiles**, not folders. This way one spec file per API area serves every profile, and nothing is duplicated across `smoke/` and `regression/` folders.

## 2. What each folder is for

| Folder               | Responsibility                                                                                       | Contains business logic? |
| -------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------ |
| `config/`            | Every URL, credential source, threshold, header rule and error code. Nothing is hard-coded in tests. | No                       |
| `api/client/`        | HTTP: builds requests, adds credentials and correlation IDs, measures time, never throws on status.  | No                       |
| `api/registry/`      | Endpoint catalogue and its type. OpenAPI import.                                                     | No                       |
| `api/definitions/`   | **One definition per endpoint.** Only endpoint facts.                                                | No                       |
| `validation-engine/` | Decides which validators run, runs them, handles dependencies, aggregates results.                   | No                       |
| `validators/`        | **Reusable technical validation.** Each validator is implemented once.                               | **No, never**            |
| `business-rules/`    | Licence limits, duplicates, blocked companies, cross-service workflows.                              | **Yes (only here)**      |
| `database/`          | DB access (client → repositories) and endpoint-specific persistence checks.                          | Persistence checks only  |
| `reporting/`         | Human and machine reports, CI summary.                                                               | No                       |
| `mock-server/`       | Local system under test, so the framework runs without a deployed API.                               | Simulated API            |

## 3. Central validator architecture

```
Endpoint definition (users.api.ts)             ← endpoint facts only
        │  resolveEndpoint()  (defaults + endpoint overrides)
        ▼
ValidationEngine.validate(endpointId)
        │ 1. build valid request (request factory)
        │ 2. send PRIMARY request (valid token of the primary role)
        │ 3. plan = registry validators ∩ profile  (+ endpoint's business rules + DB validations)
        │ 4. for each validator (ordered by stage):
        │      policy switched off?    → SKIPPED (reason)
        │      prerequisite FAILED?    → SKIPPED (reason)
        │      not applicable?         → SKIPPED (reason)
        │      otherwise               → validate(context) → ValidationResult
        ▼
stages:  primary → database → probe → aggregate → business
         (read the     (DB)    (extra     (inspect every   (business
          happy path)          requests)  exchange so far)   rules)
        ▼
ValidationReport (all results, summary, quality gate) → Playwright attachment → reporter → CI gate
```

Key properties:

- **One implementation per concern.** Negative request cases are generated from the request contract by one engine (`request-mutation.ts`). Each request validator only contributes a small _strategy_. Probes (auth, authz, request, security) all go through `probe.ts`.
- **Aggregate validators** (error format, API error semantics, information disclosure, sensitive data) run after all probes. Every 4xx/5xx and every body produced in the run is checked against the same rules, including responses triggered by other validators.
- **No false positives from loose contracts.** A negative request case is only sent if Ajv confirms the contract rejects it.

## 4. Validator interface

[`src/validation-engine/validator.ts`](../src/validation-engine/validator.ts)

```ts
export interface Validator<TContext extends ValidationContext = ValidationContext> {
  readonly name: string; // `<category>.<check>`, e.g. `response.status-code`
  readonly category: ValidationCategory;
  readonly severity: Severity;
  readonly description: string;
  readonly toggle: ValidationToggle; // policy switch, e.g. 'authentication'
  readonly profiles: readonly ValidationProfile[];
  readonly stage: ValidationStage; // primary | database | probe | aggregate | business
  readonly dependsOn: readonly string[]; // prerequisites
  notApplicable(context: TContext): string | undefined;
  validate(context: TContext): Promise<ValidationResult>;
}
```

Validators are built with `defineValidator()`. It adds timing, error capture and construction of the standard `ValidationResult`, so a validator only implements `check()` and **cannot** return a different format:

```ts
export const statusCodeValidator = defineValidator({
  name: 'response.status-code',
  category: 'RESPONSE',
  severity: 'CRITICAL',
  description: "The primary response status is one of the endpoint's expected statuses",
  toggle: 'statusCode',
  check: ({ primary, endpoint }) =>
    endpoint.expectedStatus.includes(primary.status)
      ? outcome.passed(`status ${primary.status}`, { expected: endpoint.expectedStatus, actual: primary.status })
      : outcome.failed(`expected ${endpoint.expectedStatus.join('/')}, got ${primary.status}`, { ... }),
});
```

## 5. ValidationResult model

[`src/validation-engine/validation-result.ts`](../src/validation-engine/validation-result.ts)

```ts
export interface ValidationResult {
  validationId: string; // uuid
  validatorName: string; // e.g. 'authentication.missing-token'
  category: ValidationCategory; // AUTHENTICATION | AUTHORIZATION | REQUEST | RESPONSE | SECURITY |
  // PERFORMANCE | COMMON_DATA | BUSINESS_RULE | DATABASE
  endpointId: string; // 'create-user'
  endpoint: string; // 'POST /users'
  method: HttpMethod;
  expected: unknown;
  actual: unknown;
  status: ValidationStatus; // PASSED | FAILED | SKIPPED | WARNING
  message: string; // reason / summary (skip reasons included)
  durationMs: number;
  timestamp: string;
  severity: Severity; // CRITICAL | HIGH | MEDIUM | LOW | INFO
  error?: { name: string; message: string };
  correlationId: string;
  details?: CheckDetail[]; // sub-checks: one per role, payload, token variant…
}
```

A `ValidationReport` wraps the results of one endpoint run. It adds environment, build, test run ID, profile, summary counts and the quality gate (FAILED results whose severity is listed in `thresholds.qualityGate.failOnSeverities`). All values are masked before they leave the engine.

## 6. ValidationContext model

[`src/validation-engine/validation-context.ts`](../src/validation-engine/validation-context.ts). This is everything a validator may use. Validators never touch Playwright, config files or credentials directly.

```ts
export interface ValidationContext {
  readonly endpoint: ResolvedEndpoint; // definition + all central defaults applied
  readonly profile: ValidationProfile;
  readonly run: RunInfo; // environment, build, testRunId
  readonly correlationId: string; // of the primary exchange
  readonly request: RequestSpec; // the valid request
  readonly primary: ApiResponseWrapper; // happy-path exchange
  readonly exchanges: readonly ApiResponseWrapper[]; // primary + every probe
  readonly log: Logger;
  resultOf(validatorName: string): ValidationResult | undefined;
  nextRequest(overrides?: RequestSpec): Promise<RequestSpec>; // fresh valid data for probes
  send(spec: RequestSpec, options: SendOptions): Promise<ApiResponseWrapper>;
  call(endpointId, overrides?): Promise<data>; // other registered endpoints
  readonly helpers: RequestFactoryHelpers;
  principal(role, options?): Principal | undefined;
  tokenFor(principal): Promise<string>;
  expiredToken(): Promise<string | undefined>;
}
```

## 7. ValidationRegistry

[`src/validation-engine/validation-registry.ts`](../src/validation-engine/validation-registry.ts) and the **single registration point** [`src/validators/index.ts`](../src/validators/index.ts):

```ts
export const validationRegistry = new ValidationRegistry().register(
  statusCodeValidator,
  contentTypeValidator,
  headersValidator,
  responseStructureValidator,
  responseSchemaValidator,
  // … 44 validators …
  sensitiveDataValidator,
  commonErrorValidator,
);
```

The registry is an injected instance, not a static class. The engine receives it through its constructor, so tests can `clone()` it and add validators without touching the global one. Duplicate names are rejected.

## 8. ValidationEngine

[`src/validation-engine/validation-engine.ts`](../src/validation-engine/validation-engine.ts)

```ts
const report = await validationEngine.validate('create-user'); // env profile
const report = await validationEngine.validate('create-user', { profile: 'SECURITY' });
const planned = validationEngine.plan('create-user', 'FULL'); // what would run
```

Failure handling:

- **Every** applicable validator runs even after another fails. Results are collected, not short-circuited.
- A validator whose prerequisite **FAILED** is `SKIPPED` with the reason, e.g. `prerequisite response.structure did not pass: …`. Skips propagate through dependency chains.
- A validator that does not apply is `SKIPPED` with its own reason, e.g. `response.schema → SKIPPED: response body is not valid JSON (Unexpected token 'O'…)`.
- A validator that throws is `FAILED` with `error` filled in. It never crashes the run.
- An unregistered business rule or DB validation ID is `FAILED`. It is never silently ignored.

## 9. Default validation policy and profiles

[`src/validation-engine/validation-policy.ts`](../src/validation-engine/validation-policy.ts)

```ts
export const DEFAULT_POLICY: Readonly<ValidationToggles> = Object.freeze({
  authentication: true,
  authorization: true,
  statusCode: true,
  request: true,
  responseStructure: true,
  responseSchema: true,
  contentType: true,
  headers: true,
  errorFormat: true,
  pagination: true,
  performance: true,
  security: true,
  commonData: true,
  businessRules: true,
  database: true,
});
```

Other defaults come from `config/`: expected status per method (GET 200, POST 201, PUT/PATCH 200, DELETE 204), content type, response-time budget per method, timeouts, auth failure statuses, denied statuses, and the primary role.

| Profile      | Runs                                                                                                                                                              | Typical use             |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| `SMOKE`      | Response checks, performance budgets, valid and missing token, security headers, sensitive data, disclosure, data conventions                                     | Every push, post-deploy |
| `REGRESSION` | SMOKE + invalid/expired/malformed tokens, roles, permissions, cross-tenant, privilege escalation, all negative request cases, JWT, business rules, DB validations | PRs (default)           |
| `SECURITY`   | Auth/authz + injection (SQL/NoSQL), XSS, JWT, **rate limiting**, disclosure, sensitive data                                                                       | Scheduled / pre-release |
| `FULL`       | Everything                                                                                                                                                        | Nightly                 |

Expensive or flooding checks (rate limit, injection, XSS) are **not** in SMOKE/REGRESSION.

## 10. EndpointDefinition

[`src/api/registry/endpoint-definition.ts`](../src/api/registry/endpoint-definition.ts). Only `id`, `method` and `path` are required:

```ts
interface EndpointDefinition {
  id;
  method;
  path;
  summary?;
  tags?;
  expectedStatus?;
  contentType?;
  envelope?;
  authentication?: { required?; role?; failureStatus? };
  authorization?: { roles?; tenantScoped?; deniedStatus?; privilegeEscalation? };
  request?: RequestFactory; // builds a VALID request (can call other endpoints)
  requestSchema?;
  pathParamsSchema?;
  querySchema?;
  invalidRequestStatus?;
  responseSchema?;
  pagination?;
  headers?: { required? };
  performance?: { maxResponseTimeMs?; maxPayloadBytes?; timeoutMs? };
  security?: { sensitiveFieldAllowlist?; tokenResponsePath?; injectionMustBeRejected?; rateLimit? };
  validations?: Partial<ValidationToggles>; // per-endpoint switches
  skipValidators?: string[]; // disable single validators by name
  businessRules?: string[]; // IDs from src/business-rules
  database?: { validations: string[] }; // IDs from src/database/validations
  destructive?: boolean; // default: true for POST/PUT/PATCH/DELETE
}
```

## 11. Example endpoint

[`src/api/definitions/users.api.ts`](../src/api/definitions/users.api.ts)

```ts
export const createUserApi: EndpointDefinition = {
  id: 'create-user',
  method: 'POST',
  path: '/users',
  tags: ['users', 'critical'],
  authorization: {
    roles: ['SUPER_ADMIN', 'ADMIN', 'COMPANY_ADMIN'],
    tenantScoped: true,
    privilegeEscalation: { role: 'COMPANY_ADMIN', overrides: { body: { role: 'ADMIN' } } },
  },
  request: ({ tenantId }) => ({ body: buildUserPayload(tenantId) }),
  requestSchema: createUserRequestSchema,
  responseSchema: userSchema,
  businessRules: ['duplicate-user', 'company-user-limit', 'blocked-company'],
  database: { validations: ['user-created'] },
};

export const getUserApi: EndpointDefinition = {
  id: 'get-user',
  method: 'GET',
  path: '/users/{id}',
  authorization: { roles: ['SUPER_ADMIN', 'ADMIN', 'COMPANY_ADMIN'], tenantScoped: true },
  // reuses create-user's payload instead of duplicating it
  request: async (helpers) => ({
    pathParams: { id: (await helpers.call<{ id: string }>('create-user')).id },
  }),
  pathParamsSchema: userIdParamsSchema,
  responseSchema: userSchema,
};
```

`get-user` has no business rules, no auth code and no status code. It inherits `expectedStatus: [200]` and the whole default policy.

## 12. Example test using the generic engine

[`tests/api/users.spec.ts`](../tests/api/users.spec.ts). This is the entire file:

```ts
import { describeEndpointContracts } from '@engine/contract-suite';
import { test } from '@fixtures';

test.describe('Users API', () => {
  describeEndpointContracts({ tags: ['users'] });
});
```

`describeEndpointContracts` creates one Playwright test per matching endpoint, tagged `@api @users @critical` (plus `@destructive` for mutating endpoints). Each test calls `validationEngine.validate(endpoint)` and asserts the quality gate. On failure, the test's error message is the full formatted report.

Hand-written tests use the same engine and fixtures:

```ts
test('create-user under the security profile', async ({ validationEngine }) => {
  const report = await validationEngine.validate('create-user', { profile: 'SECURITY' });
  expect(report.gate.blocking).toEqual([]);
});
```

## 13. Example business rule

[`src/business-rules/users/company-user-limit.rule.ts`](../src/business-rules/users/company-user-limit.rule.ts)

```ts
export const companyUserLimitRule: BusinessRule = {
  id: 'company-user-limit',
  description: 'A company cannot exceed its licensed user limit (409 COMPANY_USER_LIMIT_REACHED)',
  severity: 'CRITICAL',
  async check(context) {
    const company = await context.call<{ id: string }>('create-company', { body: { maxUsers: 1 } });
    const inCompany = { body: { companyId: company.id } };
    await context.call('create-user', inCompany); // uses the only licence
    const exceeding = await context.send(await context.nextRequest(inCompany), {
      label: 'business-rule.company-user-limit',
    });
    return expectBusinessError(exceeding, 409, 'COMPANY_USER_LIMIT_REACHED');
  },
};
```

Rules are registered in `src/business-rules/index.ts` and referenced by ID from `businessRules: [...]`. They run in the `business` stage with REGRESSION/FULL profiles by default. The error envelope of every response they trigger is still checked by the central error-format validator.

## 14. Example DB validation

DB access is layered: `DatabaseClient` → repositories → DB validations. Validators never query the database.

```ts
// src/database/validations/users.db.ts
export const userCreatedValidation: DatabaseValidation = {
  id: 'user-created',
  description: 'Created user is persisted with request values, audit fields and a valid company FK',
  severity: 'HIGH',
  async check(context, db) {
    const record = await new UserRepository(db).findById(createdId(context), context.correlationId);
    const company = record
      ? await new CompanyRepository(db).findById(record.companyId, context.correlationId)
      : undefined;
    return fromChecks(
      [
        dbAssert.exists('user', record),
        ...dbAssert.fieldsMatch(
          record,
          pick(context.request.body, ['email', 'firstName', 'lastName', 'role', 'companyId']),
        ),
        ...dbAssert.auditFields(record, { createdBy: true }),
        dbAssert.notDeleted(record),
        dbAssert.foreignKey('users.companyId → companies.id', company),
      ],
      'database checks',
    );
  },
};
```

`dbAssert` provides record exists / not exists, field values, audit fields, created and updated timestamps, update detection, soft delete and foreign keys. Also included: `user-updated`, `user-deleted` (soft delete) and `company-created`. When `DB_ENABLED=false`, DB validations are `SKIPPED` with that reason.

**Real database:** the mock adapter reads the mock API's store. For KPost, implement `DatabaseClient` with your driver (e.g. `pg`), building parameterised SQL from `DbQuery`, and select it in `createDatabaseClient()`. The connection string comes only from `DB_CONNECTION_STRING`.

## 15. OpenAPI and schema integration

- **One schema engine.** Contracts may be zod schemas (code-first) or JSON Schema/OpenAPI (contract-first). [`contract-schema.ts`](../src/api/schema/contract-schema.ts) normalises both to JSON Schema 2020-12 and validates with **Ajv + ajv-formats**. zod schemas are converted in `input` mode, so `z.object()` stays open and `z.strictObject()` is closed (`additionalProperties: false`, which enables the unknown-field checks).
- **Negative cases come from the contract.** Required fields, types, null/empty, min/max length and value, enums, formats (email, uri, uuid, date-time, …), patterns, closed objects, nested objects and array items are all read from the JSON Schema. Nothing is hand-listed per endpoint.
- **OpenAPI import.** [`endpoint-loader.ts`](../src/api/registry/endpoint-loader.ts) turns [`openapi/dictionary.openapi.json`](../openapi/dictionary.openapi.json) into EndpointDefinitions. It maps operationId → id, security → authentication, `x-roles` → authorization, 2xx → expectedStatus, parameters → path/query schemas, and the response `data` → responseSchema, resolving local `$ref`s. Only what OpenAPI cannot express is added in code:

```ts
export const dictionaryApis = loadOpenApiEndpoints(
  path.join(OPENAPI_DIR, 'dictionary.openapi.json'),
  {
    'list-dictionary-terms': {
      request: () => ({ query: { page: 1, pageSize: 20, language: 'en' } }),
      pagination: true,
    },
  },
);
```

## 16. Example report output

Real output for `POST /users` under the `REGRESSION` profile against the mock API. It is attached to the Playwright test and becomes the failure message if the gate fails:

```
Endpoint: POST /users (create-user)
Profile: REGRESSION | Environment: local | Build: local | Run: run-0046c59b-d758-4d7b-8906-c1fd6bd1d201
Correlation ID: tb-907c64a1-07ff-4e1f-b1b9-f8c9227f6b2c | Duration: 184ms

STATUS  CATEGORY       VALIDATOR                               SEVERITY  TIME    MESSAGE
PASSED  RESPONSE       response.status-code                    CRITICAL  0ms     status 201
PASSED  RESPONSE       response.content-type                   HIGH      0ms     Content-Type application/json; charset=utf-8
PASSED  RESPONSE       response.headers                        MEDIUM    0ms     2 header checks passed
PASSED  RESPONSE       response.structure                      HIGH      1ms     valid success envelope
PASSED  RESPONSE       response.schema                         CRITICAL  24ms    payload matches response schema
PASSED  RESPONSE       response.metadata                       LOW       0ms     2 metadata checks passed
SKIPPED RESPONSE       response.pagination                     MEDIUM    0ms     endpoint is not paginated
PASSED  PERFORMANCE    performance.timeout                     HIGH      0ms     responded in 4ms
PASSED  PERFORMANCE    performance.response-time               MEDIUM    0ms     4ms (budget 1500ms)
PASSED  PERFORMANCE    performance.payload-size                LOW       0ms     605 bytes
PASSED  AUTHENTICATION authentication.valid-token              CRITICAL  0ms     valid ADMIN token accepted
PASSED  SECURITY       security.security-headers               MEDIUM    0ms     5 security headers passed
PASSED  COMMON_DATA    common.id                               MEDIUM    0ms     2 ID checks passed
PASSED  COMMON_DATA    common.email                            MEDIUM    0ms     1 email checks passed
PASSED  COMMON_DATA    common.date                             MEDIUM    0ms     3 date checks passed
PASSED  COMMON_DATA    common.url                              MEDIUM    0ms     1 URL checks passed
PASSED  COMMON_DATA    common.boolean                          LOW       0ms     1 boolean checks passed
PASSED  DATABASE       database.user-created                   HIGH      8ms     12 database checks passed
PASSED  AUTHENTICATION authentication.missing-token            CRITICAL  3ms     1 missing-token cases passed
PASSED  AUTHENTICATION authentication.invalid-token            CRITICAL  3ms     2 invalid-token cases passed
PASSED  AUTHENTICATION authentication.expired-token            HIGH      4ms     1 expired-token cases passed
PASSED  AUTHENTICATION authentication.malformed-token          HIGH      9ms     7 malformed-token cases passed
PASSED  AUTHORIZATION  authorization.role                      HIGH      7ms     3 allowed-role cases passed
PASSED  AUTHORIZATION  authorization.permission                CRITICAL  3ms     1 denied-role cases passed
PASSED  AUTHORIZATION  authorization.cross-resource-access     CRITICAL  3ms     1 cross-tenant cases passed
PASSED  AUTHORIZATION  authorization.privilege-escalation      CRITICAL  2ms     1 privilege-escalation cases passed
PASSED  REQUEST        request.required-fields                 HIGH      14ms    6 negative request cases passed
PASSED  REQUEST        request.null-value                      HIGH      12ms    10 negative request cases passed
PASSED  REQUEST        request.empty-value                     MEDIUM    11ms    9 negative request cases passed
PASSED  REQUEST        request.data-type                       HIGH      15ms    10 negative request cases passed
PASSED  REQUEST        request.boundary-value                  HIGH      10ms    8 negative request cases passed
PASSED  REQUEST        request.enum                            HIGH      1ms     1 negative request cases passed
PASSED  REQUEST        request.format                          HIGH      5ms     4 negative request cases passed
PASSED  REQUEST        request.unknown-fields                  MEDIUM    2ms     2 negative request cases passed
PASSED  REQUEST        request.invalid-payload                 HIGH      6ms     5 negative request cases passed
PASSED  REQUEST        request.malformed-json                  HIGH      4ms     3 malformed JSON cases passed
PASSED  SECURITY       security.jwt                            HIGH      2ms     1 JWT checks passed
PASSED  RESPONSE       response.error-format                   HIGH      2ms     73 error responses passed
PASSED  AUTHORIZATION  authorization.forbidden                 HIGH      0ms     1 forbidden responses passed
PASSED  SECURITY       security.information-disclosure         HIGH      1ms     77 responses disclose no internals
PASSED  SECURITY       security.sensitive-data                 CRITICAL  1ms     77 JSON responses contain no sensitive data
PASSED  COMMON_DATA    common.api-error                        HIGH      0ms     73 error responses passed
PASSED  BUSINESS_RULE  business-rule.duplicate-user            HIGH      2ms     rejected with 409 DUPLICATE_USER
PASSED  BUSINESS_RULE  business-rule.company-user-limit        CRITICAL  5ms     rejected with 409 COMPANY_USER_LIMIT_REACHED
PASSED  BUSINESS_RULE  business-rule.blocked-company           HIGH      3ms     rejected with 422 COMPANY_BLOCKED

Summary: 45 validations — 44 passed, 0 failed, 0 warnings, 1 skipped
Quality gate: PASSED
```

On failure, each result also carries `expected`, `actual`, per-case `details` and the probe's own correlation ID. For example, from a real failure seen during development:

```
FAILED  SECURITY  security.jwt  HIGH  7ms  1/1 JWT checks failed: unsigned alg=none token rejected (expected [401], got 200)
```

Every run writes exactly two files: `reports/REPORT.md` (human) and `reports/REPORT.json` (structured), both by the single reporter (`src/reporting/bugzilla-reporter.ts`). `REPORT.md` has two parts — Part 1 execution health (API pass/fail/skip/warn by module & category, top failing checks, worst endpoints, UI results) and Part 2 the bug report (distinct valid defects, filed-by-developer, what was not filed and why). `REPORT.json` carries the run summary, the CI quality gate (environment, build, test run ID, per-endpoint counts, gate status, blocking endpoints) and the `bugs` object (candidates, filing outcome, resolve summary). It is used for the CI job summary and the quality gate.

## 17. Adding a completely new API

`POST /companies` was added after the Users API. Only the definition and its rule were added:

```ts
// src/api/definitions/companies.api.ts
export const createCompanyApi: EndpointDefinition = {
  id: 'create-company',
  method: 'POST',
  path: '/companies',
  tags: ['companies', 'critical'],
  authorization: { roles: ['SUPER_ADMIN', 'ADMIN'] },
  request: () => ({ body: buildCompanyPayload() }),
  requestSchema: createCompanyRequestSchema,
  responseSchema: companySchema,
  businessRules: ['duplicate-company-name'], // src/business-rules/companies/
  database: { validations: ['company-created'] }, // optional
};
```

Then: add `...companyApis` to `src/api/definitions/index.ts`, and add a 3-line `tests/api/companies.spec.ts` (or just tag it with an existing area). **No validator, engine or other spec file changed.** It automatically received all 40+ applicable validations (see §21).

## 18. Adding a new centralized validator

Example: a `Cache-Control` check. Create one file:

```ts
// src/validators/response/cache-control.validator.ts
export const cacheControlValidator = defineValidator({
  name: 'response.cache-control',
  category: 'RESPONSE',
  severity: 'LOW',
  description: 'Cache-Control header is present',
  toggle: 'headers',
  check: ({ primary }) =>
    primary.header('cache-control')
      ? outcome.passed('present')
      : outcome.failed('Cache-Control missing'),
});
```

Register it once in `src/validators/index.ts`. **Every** endpoint then runs it on the next test run, with no change to `users.spec.ts`, `companies.spec.ts` or any definition. The framework self-test `a newly registered validator runs for every endpoint without editing endpoint tests` proves this for all 9 registered endpoints.

`SensitiveDataValidator` ([`security/sensitive-data.validator.ts`](../src/validators/security/sensitive-data.validator.ts)) was added the same way. It scans **every** JSON response of the run for passwords and hashes, tokens, keys, private keys and Luhn-valid card numbers. It runs for all 9 endpoints (for example, it inspected 77 responses for `POST /users`). The login endpoint legitimately returns a token, so it allowlists that one field: `security: { sensitiveFieldAllowlist: ['accessToken'] }`.

## 19. Disabling one validation for one endpoint

```ts
// whole groups
export const healthCheckApi: EndpointDefinition = {
  id: 'health-check',
  method: 'GET',
  path: '/health',
  responseSchema: healthSchema,
  validations: { authentication: false, authorization: false },
};

// or single validators by name
skipValidators: ['security.rate-limit', 'performance.payload-size'],
```

Everything else still runs. The report shows the disabled ones as `SKIPPED — disabled for this endpoint (validations.authentication = false)`, so disabled checks remain visible.

## 20. Commands

```bash
npm run test:api:smoke        # SMOKE      – fast happy-path contract checks
npm run test:api:regression   # REGRESSION – + negative probes, business rules, DB (default)
npm run test:api:security     # SECURITY   – injection, XSS, JWT, rate limiting, leakage
npm run test:api:full         # FULL       – everything
npm run test:framework        # framework self-tests
npm run test:integration      # cross-endpoint workflows
npm test                      # UI + API + integration + framework

# any profile / environment / subset
VALIDATION_PROFILE=SECURITY TEST_ENV=staging npx playwright test --project=api --grep @users
npx playwright test --project=api --grep @critical
```

## 21. Acceptance scenario and how it is proven

| Requirement                                                                                                                                 | Evidence                                                                                                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /users` and `GET /users/{id}` share **all** central validators without duplicated code                                                | Self-test _"POST /users, GET /users/{id} and POST /companies receive the same central validators"_ asserts that the planned central validators of all three equal the full registry. Neither definition contains validation code. |
| Both receive auth, authz, status, request, structure, schema, required fields, content-type, headers, error format, response time, security | Report above (`POST /users`: 45 validations). `GET /users/{id}`: 31 passed; request checks apply to its path parameter.                                                                                                           |
| `POST /companies` needs only a definition and a business rule                                                                               | `companies.api.ts` + `duplicate-company-name.rule.ts`. The report shows 40 passed, 0 failed. No central validation code changed.                                                                                                  |
| A new validator applies without touching endpoint tests                                                                                     | Self-test _"a newly registered validator runs for every endpoint…"_. `SensitiveDataValidator` runs for every endpoint.                                                                                                            |
| Failures collected; dependent validators skipped with a reason                                                                              | Self-tests _"all results are collected; dependents of a failed validator are SKIPPED with a reason"_ and _"response schema is SKIPPED when the body is not JSON"_.                                                                |
| Disable one validation for one endpoint                                                                                                     | Self-test _"health-check override disables only authentication and authorization"_.                                                                                                                                               |
| Production safety                                                                                                                           | Self-test _"production guard blocks destructive endpoints unless explicitly allowed"_.                                                                                                                                            |
| Secret masking                                                                                                                              | Self-test _"secrets and personal data are masked"_.                                                                                                                                                                               |

The latest local run was 27/27 Playwright tests passing: 7 UI, 9 endpoint contracts, 10 framework self-tests and 1 integration test. The endpoint contracts covered 377 validations: 274 passed, 0 failed, 103 skipped as not applicable. They pass in all four profiles.

## 22. Design decisions and known limits

- **Mock API.** No KPost API environment was available, so `mock-server/` simulates one (auth, roles, tenants, validation, business errors, soft delete, rate limiting, security headers). Point `API_BASE_URL`/`AUTH_PRINCIPALS` at a real environment and set `MOCK_API=false`. The mock's credentials exist only in `mock-server/seed.json`.
- **Registry instances instead of static classes**, for dependency injection and isolated tests.
- **Validators return outcomes through `defineValidator`**, and the wrapper produces the `ValidationResult`. This keeps the contract uniform and removes timing and error-handling boilerplate from 44 validators.
- **Response time is a functional per-request budget, not load testing.** Keep load tests (k6, Artillery, …) separate.
- **Probe volume** is bounded (`thresholds.request.maxCasesPerValidator`, `security.maxInjectionFields`, `maxRateLimitBurst`). Flooding checks run only in SECURITY/FULL.
- **Login probes** use a dedicated `login-probe` principal, so negative login attempts never lock real accounts.
- **Not included yet:** a real SQL adapter for `DatabaseClient`, and speciality/dictionary business rules (there are no such rules yet; add them under `src/business-rules/<area>/`). Test-data cleanup is not implemented: the mock resets on restart, and real environments need a cleanup strategy per data type.
