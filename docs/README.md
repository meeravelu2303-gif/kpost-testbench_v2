# Documentation index

One line per document. Start with [`CLAUDE.md`](../CLAUDE.md) (the map and the rules), then
[`guides/commands.md`](guides/commands.md) (every command), then whatever the task needs below.

## `guides/` — how to operate the bench

| Document                                                    | What it is                                                                                              |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| [`commands.md`](guides/commands.md)                         | Every npm command, one per Bugzilla product, each with its `:file` variant. The canonical list.         |
| [`runbook.md`](guides/runbook.md)                           | The order of operations for a complete, safe run: preflight → self-test → dry run → file → read.        |
| [`bug-filing.md`](guides/bug-filing.md)                     | How a failure becomes a Bugzilla ticket: ownership, validity gates, dedupe, the ticket format.          |
| [`validation-framework.md`](guides/validation-framework.md) | The engine: define an endpoint once, every applicable validator runs. How to add an endpoint/validator. |
| [`api-contracts.md`](guides/api-contracts.md)               | The Excel workbook → contracts → OpenAPI pipeline, and what to do after a new dump.                     |

## `reference/` — what the bench is and what it tests against

| Document                                               | What it is                                                                                          |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| [`bench-reference.md`](reference/bench-reference.md)   | The full detail: the product, architecture, pipeline spec, contracts, conventions (§ numbers kept). |
| [`business-rules.md`](reference/business-rules.md)     | The catalogue of product rules the bench asserts, with status and the spec that proves each.        |
| [`requirements-frd.md`](reference/requirements-frd.md) | The FR → test map against the six per-module FRDs: covered, gap, out of scope.                      |
| [`decision-log.md`](reference/decision-log.md)         | Every decision and incident, newest first. **Add an entry at the top after changing a flow.**       |

## `modules/` — per-module analyses the API specs were built from

| Document                                     | Module                                                                       |
| -------------------------------------------- | ---------------------------------------------------------------------------- |
| [`katchup-flow.md`](modules/katchup-flow.md) | Katchup: message/share/status codes, the application flow, payloads, gating. |
| [`kall-flow.md`](modules/kall-flow.md)       | Kall: status/type/mode codes, direct and scheduled flows, gating.            |
| [`kmail-flow.md`](modules/kmail-flow.md)     | KMail: type/receiver/priority codes, compose flow, host and endpoint map.    |
| [`kmail-schema.md`](modules/kmail-schema.md) | KMail tables on the test database and the three ways they defy assumptions.  |
| [`admin-flow.md`](modules/admin-flow.md)     | Admin / HR-Setup: the two admin surfaces, accounts, the org-build flow.      |

## `ui/` — front-end maps the e2e specs are built from

| Document                                              | What it is                                                                          |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------- |
| [`ui-screens.md`](ui/ui-screens.md)                   | Every screen's stable selectors at load and its control → action → API wiring.      |
| [`ui-build-plan.md`](ui/ui-build-plan.md)             | Per-module selectors, approach, FR traceability and current status.                 |
| [`frontend-module-map.md`](ui/frontend-module-map.md) | How the React app boots, its route map and module inventory; the KBooking boundary. |

## `scope/` — why an endpoint is not tested (hand-written, evidence-based)

| Document                                                                 | What it is                                                                        |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| [`blocked-endpoints-rationale.md`](scope/blocked-endpoints-rationale.md) | Every endpoint that genuinely cannot run today, with its reason and unblock path. |
| [`unused-endpoints.md`](scope/unused-endpoints.md)                       | Endpoints proven to have no caller in the front end.                              |

The OTP-dependent list is generated: [`contracts/otp-dependent-endpoints.md`](../contracts/otp-dependent-endpoints.md).

## `generated/` — written by `npm run framework`, never hand-edited

| Document                                                     | Written by                    | What it reconciles                                           |
| ------------------------------------------------------------ | ----------------------------- | ------------------------------------------------------------ |
| [`coverage.md`](generated/coverage.md)                       | `coverage-ledger.spec.ts`     | Every documented endpoint and screen against the registry.   |
| [`live-endpoints.md`](generated/live-endpoints.md)           | `live-coverage.spec.ts`       | What runs on the live application and what is blocked.       |
| [`blocked-endpoints.md`](generated/blocked-endpoints.md)     | `live-coverage.spec.ts`       | The blocked set, grouped by reason.                          |
| [`component-routing.md`](generated/component-routing.md)     | `component-routing.spec.ts`   | Every endpoint → its Bugzilla component.                     |
| [`payload-audit.md`](generated/payload-audit.md)             | `payload-audit.spec.ts`       | Every documented example field is actually sent.             |
| [`ui-coverage.md`](generated/ui-coverage.md)                 | `ui-coverage.spec.ts`         | Every screen, the check catalogue and the interaction flows. |
| [`katchup-ui-coverage.md`](generated/katchup-ui-coverage.md) | `katchup-ui-coverage.spec.ts` | Every Katchup feature against its UI spec.                   |

## `audits/` — dated, point-in-time

| Document                                                                          | What it is                                                                               |
| --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| [`api-coverage-depth.md`](audits/api-coverage-depth.md)                           | For each registered endpoint, what it gets beyond the generic sweep; the live re-checks. |
| [`katchup-ground-truth-2026-10-03.md`](audits/katchup-ground-truth-2026-10-03.md) | Katchup read from backend and frontend source, cross-referenced with the bench.          |

## `api-specs/` — the product owner's source files

| File                              | What it is                                                                       |
| --------------------------------- | -------------------------------------------------------------------------------- |
| `KPOST API (N).xlsx`              | The KPost/KMail API workbook. `npm run contract:excel` converts the highest `N`. |
| `Admin_module - API Services.pdf` | The Admin module's authoritative payloads (`npm run contract:admin:pdf`).        |
| `Admin_module.xlsx`               | The Admin module's endpoint list (a simplified subset; the PDF wins).            |

## `archive/` — superseded, kept because other comments cite them

| Document                                                                       | Superseded by                                         |
| ------------------------------------------------------------------------------ | ----------------------------------------------------- |
| [`test-bench-plan-2026-10-02.md`](archive/test-bench-plan-2026-10-02.md)       | `CLAUDE.md` and the decision log.                     |
| [`frontend-test-plan-2026-09-30.md`](archive/frontend-test-plan-2026-09-30.md) | `ui/ui-build-plan.md` and `generated/ui-coverage.md`. |
| [`ui-write-flows-2026-09-28.md`](archive/ui-write-flows-2026-09-28.md)         | `ui/ui-build-plan.md` and `generated/ui-coverage.md`. |

## Conventions

- Folder names say what a document is for; file names are lowercase kebab-case; dated files carry
  their date so a reader knows what "now" meant when it was written.
- A document is either hand-written or generated, never both. Generated files say so in their first
  lines and are regenerated by `npm run framework` (ledgers) or the `contract:*` commands.
- One document per purpose. When a plan is finished, it moves to `archive/` with a banner naming
  what replaced it, rather than being kept alongside its successor.
- History goes in the decision log, not in the reference documents.
