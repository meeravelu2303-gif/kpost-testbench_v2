# src/bug-tracker/ — from a failed test to a Bugzilla bug

Everything that turns a run's failures into valid, non-duplicate Bugzilla bugs, one folder per step,
in the order a finding passes through them. How the whole flow works: `docs/guides/bug-filing.md`.

| Folder      | Step                                                                                   | Files                                                           |
| ----------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `findings/` | 1. A failed check becomes a bug candidate with a stable `[KP-XXXXXX]` tag.             | `bug-candidate.ts`, `bug-fingerprint.ts`                        |
| `gates/`    | 2. Invalid findings are dropped: bench faults, timeouts, 429s, judged false positives. | `validity-gate.ts`, `known-false-positives.ts`, `gatekeeper.ts` |
| `ticket/`   | 3. The bug text: Summary, Steps, Expected, Actual, How to fix, curl.                   | `bug-builder.ts`, `guidance.ts`, `curl.ts`                      |
| `bugzilla/` | 4. Talks to Bugzilla: duplicate search, then create / comment / reopen / skip.         | `bugzilla-client.ts`, `bugzilla-filer.ts`                       |
| `status/`   | 5. Re-checks every open bug: close it if fixed, else a dated note.                     | `verify-resolve.ts`                                             |
| `filing/`   | 6. Runs steps 1-5 at the end of a run (or `bug:apply`) and writes `reports/REPORT.*`.  | `bugzilla-reporter.ts`, `filing-run.ts`, `bug-report.ts`        |

Where to change what:

- A finding that is not a real bug: add it to `gates/known-false-positives.ts` (with reason, judgedBy, date).
- How a bug reads: `ticket/bug-builder.ts` (the layout) and `ticket/guidance.ts` (plain "why / how to fix" per check).
- Who gets the bug: `src/config/ownership.config.ts`, not here.

The commands that use this code are in `scripts/bug-tracker/`, and its self-tests are in
`tests/framework/bug-tracker/`.
