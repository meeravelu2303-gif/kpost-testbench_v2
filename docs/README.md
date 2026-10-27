# Documentation index

One line per document. Start with [`CLAUDE.md`](../CLAUDE.md) (the map and the rules), then
[`guides/commands.md`](guides/commands.md) (every command), then whatever the task needs below.

## `guides/` — how to operate the bench

| Document                                                    | What it is                                                                                              |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| [`commands.md`](guides/commands.md)                         | Every command, one section per product (preview and file), plus before/after a run.                     |
| [`bug-filing.md`](guides/bug-filing.md)                     | How a failure becomes a Bugzilla ticket: ownership, validity gates, dedupe, the ticket format.          |
| [`validation-framework.md`](guides/validation-framework.md) | The engine: define an endpoint once, every applicable validator runs. How to add an endpoint/validator. |
| [`api-contracts.md`](guides/api-contracts.md)               | The Excel workbook → contracts → OpenAPI pipeline, and what to do after a new dump.                     |
| [`run-levels.md`](guides/run-levels.md)                     | Smoke, sanity and regression: how tags select them and how `scripts/run-level.mjs` runs them.           |

## `reference/` — what the bench is and what it tests against

| Document                                                   | What it is                                                                                    |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| [`kpost-product.md`](reference/kpost-product.md)           | What KPOST is, the application flow the bench exercises, and its architecture risk.           |
| [`business-rules.md`](reference/business-rules.md)         | The catalogue of product rules the bench asserts, with status and the spec that proves each.  |
| [`requirements-frd.md`](reference/requirements-frd.md)     | The FR → test map against the six per-module FRDs: covered, gap, out of scope.                |
| [`decision-log.md`](reference/decision-log.md)             | Every decision and incident, newest first. **Add an entry at the top after changing a flow.** |
| [`cross-layer-matrix.md`](reference/cross-layer-matrix.md) | Which cross-layer flow (UI write → API/DB read) proves which module.                          |

## `proposals/` — suggested changes, not applied

| Document                                           | What it is                                                                                                                                   |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| [`frd-updates.md`](proposals/frd-updates.md)       | New FRD requirements for features the tests exercise but the per-module FRD lacks.                                                           |
| [`mobile-testing.md`](proposals/mobile-testing.md) | The KPost Flutter mobile app: Patrol and the open-source tools around it, coverage, blockers, order of work (decided 2026-10-27, not built). |

## `modules/` — per-module analyses the API specs were built from

| Document                                     | Module                                                                       |
| -------------------------------------------- | ---------------------------------------------------------------------------- |
| [`katchup-flow.md`](modules/katchup-flow.md) | Katchup: message/share/status codes, the application flow, payloads, gating. |
| [`kall-flow.md`](modules/kall-flow.md)       | Kall: status/type/mode codes, direct and scheduled flows, gating.            |
| [`kmail-flow.md`](modules/kmail-flow.md)     | KMail: type/receiver/priority codes, compose flow, host and endpoint map.    |
| [`kmail-schema.md`](modules/kmail-schema.md) | KMail tables on the test database and the three ways they defy assumptions.  |
| [`admin-flow.md`](modules/admin-flow.md)     | Admin / HR-Setup: the two admin surfaces, accounts, the org-build flow.      |

## `ui/` — front-end maps the e2e specs are built from

| Document                            | What it is                                                                                                           |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| [`ui-screens.md`](ui/ui-screens.md) | Every screen's selectors and control → API wiring; the app's route map, module inventory and the K-Booking boundary. |

## `scope/` — why an endpoint is not tested (the blocked list itself is generated: `generated/blocked-endpoints.md`)

| Document                                           | What it is                                           |
| -------------------------------------------------- | ---------------------------------------------------- |
| [`unused-endpoints.md`](scope/unused-endpoints.md) | Endpoints proven to have no caller in the front end. |

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
| [`skips.md`](generated/skips.md)                             | `skip-ledger.spec.ts`         | Every skip reason in the suite, in one of four classes.      |

## `api-specs/` — the product owner's source files

| File                              | What it is                                                                       |
| --------------------------------- | -------------------------------------------------------------------------------- |
| `KPOST API (N).xlsx`              | The KPost/KMail API workbook. `npm run contract:excel` converts the highest `N`. |
| `Admin_module - API Services.pdf` | The Admin module's authoritative payloads (`npm run contract:admin:pdf`).        |

## Conventions

- Folder names say what a document is for; file names are lowercase kebab-case; dated files carry
  their date so a reader knows what "now" meant when it was written.
- A document is either hand-written or generated, never both. Generated files say so in their first
  lines and are regenerated by `npm run framework` (ledgers) or the `contract:*` commands.
- One document per purpose. When a plan or a dated audit is finished, it is deleted (git keeps the
  history) and anything that cited it says so, rather than being kept alongside its successor.
- History goes in the decision log, not in the reference documents.
