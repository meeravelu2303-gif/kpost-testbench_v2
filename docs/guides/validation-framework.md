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
│   ├── auth.config.ts            # roles, generic principals, token scheme, failure statuses
│   ├── auth-profile.ts           # the KPost login (loginRO payload, token path, the QA_* accounts by role)
│   ├── database.config.ts        # DB enablement/client/connection (env only)
│   ├── thresholds.config.ts      # response-time/payload/timeout budgets, quality gate
│   └── constants.ts              # paths, tags, validation profiles
├── api/
│   ├── client/                   # api-client · request-builder · response-wrapper · token-provider
│   ├── contract/                 # workbook-contract: schemas/examples looked up from the generated OpenAPI
│   ├── registry/                 # api-registry · endpoint-definition
│   ├── schema/contract-schema.ts # zod | JSON Schema → Ajv (single schema engine)
│   ├── schemas/                  # kpost-types — the shared KPost field types
│   └── definitions/              # one folder per module: kpost/<module>/*.api.ts · kmail/ · admin/ · index
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
├── business-rules/               # business-rule.ts · index.ts (the registry; KPost's rules live in module feature specs)
├── database/                     # database-client · database-pool · repositories/ · kpost-assertions · validations/
├── bug-tracker/                  # candidate · validity gate · fingerprint · dedupe · Bugzilla filer/client · verify-resolve
├── reporting/                    # bugzilla-reporter (writes the single REPORT.md/json + files bugs) · run-summary · bug-report · report-formatter · report-attachment
├── fixtures/ pages/ ui/ utils/
contracts/ openapi/               # GENERATED from the workbook (and the Admin spec): the contracts the engine validates against
tests/api · tests/framework · tests/e2e · tests/e2e-admin · tests/setup
```

`tests/` is split by _kind_ of test (api, framework, e2e). Smoke, regression, security and full are **validation profiles**, not folders. This way one spec file per module area serves every profile, and nothing is duplicated across `smoke/` and `regression/` folders.

## 2. What each folder is for

| Folder               | Responsibility                                                                                       | Contains business logic? |
| -------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------ |
| `config/`            | Every URL, credential source, threshold, header rule and error code. Nothing is hard-coded in tests. | No                       |
| `api/client/`        | HTTP: builds requests, adds credentials and correlation IDs, measures time, never throws on status.  | No                       |
| `api/registry/`      | Endpoint catalogue and its type.                                                                     | No                       |
| `api/contract/`      | Looks a definition's request/response schemas and examples up in the generated OpenAPI.              | No                       |
| `api/definitions/`   | **One definition per endpoint.** Only endpoint facts.                                                | No                       |
| `validation-engine/` | Decides which validators run, runs them, handles dependencies, aggregates results.                   | No                       |
| `validators/`        | **Reusable technical validation.** Each validator is implemented once.                               | **No, never**            |
| `business-rules/`    | The registry for definition-level rules. KPost's rules are asserted in module feature specs.         | **Yes (only here)**      |
| `database/`          | DB access (client → repositories) and endpoint-specific persistence checks.                          | Persistence checks only  |
| `bug-tracker/`       | Turns failures into deduplicated, validity-gated Bugzilla tickets routed to the module's owner.      | No                       |
| `reporting/`         | The single run report (`reports/REPORT.md/json`) and the Playwright reporter that files bugs.        | No                       |

## 3. Central validator architecture

```
Endpoint definition (kpost/<module>/*.api.ts)  ← endpoint facts only
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

[`src/validation-engine/validator.ts`](../../src/validation-engine/validator.ts)

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

[`src/validation-engine/validation-result.ts`](../../src/validation-engine/validation-result.ts)

```ts
export interface ValidationResult {
  validationId: string; // uuid
  validatorName: string; // e.g. 'authentication.missing-token'
  category: ValidationCategory; // AUTHENTICATION | AUTHORIZATION | REQUEST | RESPONSE | SECURITY |
  // PERFORMANCE | COMMON_DATA | BUSINESS_RULE | DATABASE
  endpointId: string; // 'dashboard-home-msgs'
  endpoint: string; // 'POST /v2/dashboard/homeDashboardMsgs/'
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

[`src/validation-engine/validation-context.ts`](../../src/validation-engine/validation-context.ts). This is everything a validator may use. Validators never touch Playwright, config files or credentials directly.

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

[`src/validation-engine/validation-registry.ts`](../../src/validation-engine/validation-registry.ts) and the **single registration point** [`src/validators/index.ts`](../../src/validators/index.ts):

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

[`src/validation-engine/validation-engine.ts`](../../src/validation-engine/validation-engine.ts)

```ts
const report = await validationEngine.validate('dashboard-home-msgs'); // env profile
const report = await validationEngine.validate('dashboard-home-msgs', { profile: 'SECURITY' });
const planned = validationEngine.plan('dashboard-home-msgs', 'FULL'); // what would run
```

Failure handling:

- **Every** applicable validator runs even after another fails. Results are collected, not short-circuited.
- A validator whose prerequisite **FAILED** is `SKIPPED` with the reason, e.g. `prerequisite response.structure did not pass: …`. Skips propagate through dependency chains.
- A validator that does not apply is `SKIPPED` with its own reason, e.g. `response.schema → SKIPPED: response body is not valid JSON (Unexpected token 'O'…)`.
- A validator that throws is `FAILED` with `error` filled in. It never crashes the run.
- An unregistered business rule or DB validation ID is `FAILED`. It is never silently ignored.

## 9. Default validation policy and profiles

[`src/validation-engine/validation-policy.ts`](../../src/validation-engine/validation-policy.ts)

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

[`src/api/registry/endpoint-definition.ts`](../../src/api/registry/endpoint-definition.ts). Only `id`, `method` and `path` are required:

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

[`src/api/definitions/kpost/dashboard/dashboard.api.ts`](../../src/api/definitions/kpost/dashboard/dashboard.api.ts) — the Home screen's recent-messages panel, three authenticated reads:

```ts
function defineDashboardEndpoint(config: KpostEndpointConfig): EndpointDefinition {
  return defineKpostEndpoint({
    ...config,
    authentication: config.authentication ?? { required: true },
    tags: ['dashboard', ...(config.tags ?? [])],
  });
}

export const homeDashboardMsgsApi = defineDashboardEndpoint({
  id: 'dashboard-home-msgs',
  method: 'POST',
  path: '/v2/dashboard/homeDashboardMsgs/',
  summary: 'The Home dashboard message list (initial page)',
  tags: ['dashboard-read'],
  // Reads our own recent messages; nulls fetch the latest page, as the client sends on first load.
  destructive: false,
  productionSafe: true,
  request: body(() => ({ serverTime: null, lastMsgID: null })),
});
```

That is the whole definition. It states only endpoint facts — the path, the token requirement, the
payload the real client sends, and the two live-safety facts (`destructive: false`, `productionSafe:
true`). It inherits `expectedStatus: [200]`, the KPost response envelope and the whole default
policy, and its request/response schemas are looked up from the workbook contract by path
(`defineKpostEndpoint`). A definition for a path the workbook does not list throws at load time.

Where a valid request needs a value only the product can mint (a message id, a document id), the
definition says so — `tags: ['needs-id']` and a `note:` — and the endpoint is driven by a lifecycle
flow in the module's `feature.spec.ts` instead of standalone. `homeDashboardNewMsgs` in the same
file is the example: with null markers the backend 500s, which would read as a false CRITICAL.

## 12. Example test using the generic engine

[`tests/api/kpost/dashboard/read.spec.ts`](../../tests/api/kpost/dashboard/read.spec.ts). This is the entire file:

```ts
import { describeEndpointCases } from '@engine/endpoint-cases';
import { test } from '@fixtures';

test.describe('KPost Dashboard · reads', () => {
  describeEndpointCases({ tags: ['dashboard-read'] });
});
```

`describeEndpointCases` creates **one Playwright test per endpoint × validator**, so a run reads
like a test plan (`response.status-code — …`, `security.injection — …`), each tagged
`@api @kpost-api @dashboard @dashboard-read`. The engine still sends each endpoint's requests once;
every case asserts its own slice of that one report. `describeEndpointContracts`
(`@engine/contract-suite`) is the coarser form — one test per endpoint — used by the KMail and
Admin root wrappers. Write endpoints go through `forWriteSweep` (`src/api/sweep-target.ts`), which
points "the other party" at the sacrificial qatest account.

Hand-written tests use the same engine and fixtures:

```ts
test('dashboard under the security profile', async ({ validationEngine }) => {
  const report = await validationEngine.validate('dashboard-home-msgs', { profile: 'SECURITY' });
  expect(report.gate.blocking).toEqual([]);
});
```

## 13. Example business rule

KPost's business rules are asserted in the module feature specs, because a real rule needs state
the generic sweep cannot set up (a second account, a created record, a prior step). The pattern,
from [`tests/api/kpost/kall/feature.spec.ts`](../../tests/api/kpost/kall/feature.spec.ts):

```ts
const repeat = await endpoints.sendTo(
  'kall-scheduled-repeat',
  { body: repeatBody },
  { label: 'feature:kall:repeat', auth: { principal: A }, allowLiveWrite: true },
);
if (repeat.status >= 400) {
  endpoints.recordBusinessRuleViolation({
    endpointId: 'kall-scheduled-repeat',
    ruleId: 'REGRESSION-kall-repeat-still-broken-v2',
    rule: 'scheduledRepeatKall must actually create a repeating call for a real repeat interval, not reject every one.',
    expected: 'status < 300 for a well-formed repeat interval',
    actual: `status=${repeat.status}, body=${repeat.bodyText}`,
    request: { body: repeatBody },
  });
}
```

`recordBusinessRuleViolation` turns a confirmed violation into a bug candidate with the same
dedupe, validity gate and owner routing as an engine finding — and the test itself **passes**, so
judge a rule by the recorded candidates in the report, not by the test's colour. The
`businessRules: [...]` registry on a definition (`src/business-rules/`) still exists for a rule that
can be checked from the endpoint's own request alone; nothing registered there today.

````

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
````

`dbAssert` provides record exists / not exists, field values, audit fields, created and updated timestamps, update detection, soft delete and foreign keys. The registered validations (`src/database/validations/index.ts`) cover KPOST_QA persistence — user active, profile updated, Katchup message persisted, login session created, company licence integrity, settings persisted — and KMail mail persisted. When the database is unreachable or `DB_ENABLED=false`, DB validations are `SKIPPED` with that reason, never passed.

**Real database:** KPost runs on **MySQL**, and `MysqlDatabaseClient` (`mysql2/promise`) is the only live adapter. Identifiers are validated against a strict pattern and backtick-quoted, values are bound as `?` placeholders, and a `null` in a `where` becomes `IS NULL`. Credentials come from `DB_HOST`/`DB_PORT`/`DB_USER`/`DB_PASSWORD`/`DB_NAME` only.

**One database per suite.** `DatabasePool.for(suite)` gives each suite its own client, because they do not share a target: **KPost and KMail** point at the KPOST_QA **test** database, where `DB_ALLOW_WRITES=true` is the intended setting, while **Admin** points at a **live production** database. `admin-api` is on `WRITE_BANNED_SUITES`, so non-`SELECT` statements are refused there regardless of `DB_ALLOW_WRITES` — the ban lives in code precisely so an environment variable cannot lift it. Note that `WITH` is **not** treated as a read: MySQL 8 allows a CTE to head an `UPDATE`/`DELETE`. See `tests/framework/admin-db-safety.spec.ts`.

## 15. OpenAPI and schema integration

- **One schema engine.** Contracts may be zod schemas (code-first) or JSON Schema/OpenAPI (contract-first). [`contract-schema.ts`](../../src/api/schema/contract-schema.ts) normalises both to JSON Schema 2020-12 and validates with **Ajv + ajv-formats**. zod schemas are converted in `input` mode, so `z.object()` stays open and `z.strictObject()` is closed (`additionalProperties: false`, which enables the unknown-field checks).
- **Negative cases come from the contract.** Required fields, types, null/empty, min/max length and value, enums, formats (email, uri, uuid, date-time, …), patterns, closed objects, nested objects and array items are all read from the JSON Schema. Nothing is hand-listed per endpoint.
- **Workbook contracts.** The generated OpenAPI (`openapi/kpost-api.openapi.json`, `kmail-api`, `admin-api`) is not loaded as endpoints; definitions are hand-written per module and look their schemas and documented examples up through [`workbook-contract.ts`](../../src/api/contract/workbook-contract.ts). A hand-typed path the workbook does not list throws at definition time, so a typo cannot quietly become an untested endpoint. See [api-contracts.md](api-contracts.md).

## 16. Example report output

Illustrative output of one endpoint under the `REGRESSION` profile (the shape is exact; the endpoint and values are a placeholder). It is attached to the Playwright test and becomes the failure message if the gate fails:

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

The Dashboard module (§11–12) was added this way, and every KPost module follows the same four
steps. Nothing in the engine, the validators or any other spec changes.

1. **Definitions** — `src/api/definitions/kpost/<module>/<module>.api.ts`, one `defineKpostEndpoint`
   per endpoint (the module's own `define<Module>Endpoint` wrapper sets the shared tag and the
   token default, as `defineDashboardEndpoint` does). The path must exist in the workbook contract,
   or the definition throws at load time; the request is the payload the real client sends; and the
   two live-safety facts are stated explicitly — `destructive` and `productionSafe` — because the
   production guard is default-deny.
2. **Module index** — `src/api/definitions/kpost/<module>/index.ts` exports the module's definitions
   as one array (`dashboardApis`), and `src/api/definitions/index.ts` spreads it into the registry.
3. **Wrapper spec** — `tests/api/kpost/<module>/read.spec.ts` (and `write.spec.ts` with
   `{ transform: forWriteSweep }` for writes): three lines calling `describeEndpointCases` on the
   module's tag. `tests/framework/sweep-completeness.spec.ts` fails until every new endpoint is
   reachable by a wrapper or listed as exempt with a reason — a definition cannot be quietly left out
   of the sweep.
4. **Feature spec** — `tests/api/kpost/<module>/feature.spec.ts` for anything the sweep cannot do
   alone: lifecycle flows (create → act → clean up, behind a `<MODULE>_LIFECYCLE` flag), `needs-id`
   endpoints fed real ids, and the module's business rules via `recordBusinessRuleViolation` (§13).

Then add the module's path to the `kpost*` commands in `package.json` and its Bugzilla component to
`src/config/ownership.config.ts`, so its defects route to the right developer. On the next run the
new endpoints receive every applicable validator automatically (see §21).

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

Register it once in `src/validators/index.ts`. **Every** endpoint then runs it on the next test run, with no change to any wrapper spec or definition. The framework self-test _"a public endpoint, an authenticated read and a write all receive the same central validators"_ (`tests/framework/validation-engine.spec.ts`) proves the plan is the full registry for every kind of endpoint.

`SensitiveDataValidator` ([`security/sensitive-data.validator.ts`](../../src/validators/security/sensitive-data.validator.ts)) was added the same way. It scans **every** JSON response of the run for passwords and hashes, tokens, keys, private keys and Luhn-valid card numbers. The login endpoint legitimately returns a token, so it allowlists that one field: `security: { sensitiveFieldAllowlist: ['accessToken'] }`.

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

The complete, canonical list is in **[`docs/guides/commands.md`](commands.md)** — one command per surface
(`kpost` / `kmail` / `admin` / `ui` / `all`, each with a `:file` twin). The most common:

```bash
npm run kpost            # KPost API — all test types on the test DB + write flows (files nothing)
npm run kpost:file       # same, and file valid bugs
npm run kmail            # KMail API      npm run admin   # Admin API      npm run ui   # UI e2e
npm run framework        # framework self-tests (no host or credentials needed)

# A specific validation profile / environment / subset (the profiles still exist as an axis):
VALIDATION_PROFILE=SECURITY npx playwright test --project=api --grep @kpost-api
npx playwright test --project=api --grep @critical
```

## 21. Acceptance scenario and how it is proven

| Requirement                                                                                  | Evidence (`tests/framework/`)                                                                                                                                                                                                        |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A public endpoint, an authenticated read and a write share **all** central validators        | `validation-engine.spec.ts` _"a public endpoint, an authenticated read and a write all receive the same central validators"_ — the planned validators of `kpostIdExist`, `getUserProfile` and `sendMessage` equal the full registry. |
| Endpoint-specific checks stay endpoint-specific                                              | _"database validations stay endpoint-specific"_: `sendMessage` plans `katchup-message-persisted`, the login plans `kpost-login-session-created`, and neither leaks into the other.                                                   |
| Every registered endpoint is reached by a sweep, and every exemption carries a reason        | `sweep-completeness.spec.ts`.                                                                                                                                                                                                        |
| Production safety: allowlist, OTP kill-switch, `ALLOW_DESTRUCTIVE_TESTS` grants nothing live | `live-safety.spec.ts` (the full matrix) and the guard test in `validation-engine.spec.ts`.                                                                                                                                           |
| Defects route to the right Bugzilla component and owner                                      | `ownership.spec.ts`, `component-routing.spec.ts`.                                                                                                                                                                                    |
| One fault → one ticket (cascades, count variants, systemic faults collapse)                  | `cascade-consolidation.spec.ts`, `systemic-collapse.spec.ts`, `bug-tracker.spec.ts`.                                                                                                                                                 |
| Secret masking                                                                               | _"secrets and personal data are masked"_.                                                                                                                                                                                            |

`npm run framework` runs the whole project without a host or credentials.

## 22. Design decisions and known limits

- **One target, the live application.** The bench was scaffolded against a bundled mock API; that layer was removed on 2026-10-10 once every real module was wired, so there is exactly one flow and nothing fake left to maintain. The framework self-tests run on the registry alone and need no host.
- **Registry instances instead of static classes**, for dependency injection and isolated tests.
- **Validators return outcomes through `defineValidator`**, and the wrapper produces the `ValidationResult`. This keeps the contract uniform and removes timing and error-handling boilerplate from 44 validators.
- **Response time is a functional per-request budget, not load testing.** Keep load tests (k6, Artillery, …) separate.
- **Probe volume** is bounded (`thresholds.request.maxCasesPerValidator`, `security.maxInjectionFields`, `maxRateLimitBurst`). Flooding checks run only in SECURITY/FULL.
- **Login probes** use a dedicated `login-probe` principal, so negative login attempts never lock real accounts.
- **Test data cleans itself up.** Writes run inside self-cleaning lifecycle flows (`*_LIFECYCLE` flags, `tests/api/kpost/<module>/feature.spec.ts`), and anything the bench creates that cannot be deleted is recorded in `src/fixtures/created-accounts.json`.
