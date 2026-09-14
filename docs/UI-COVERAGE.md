# UI coverage ledger — every screen, every check

**GENERATED — do not edit.** Written by `tests/framework/ui-coverage.spec.ts`
(`npm run test:framework`). It reconciles the screen registry, the UI check catalogue and the
interaction flows, and fails the build if a screen would route a bug to a non-existent component.

## Screens

Every screen inherits the **full check catalogue** below. Covered: **6** screens.

| Screen | Route | Bugzilla component | Key controls checked |
| ------ | ----- | ------------------ | -------------------: |
| Home | `/home` | Home | 1 |
| Katchup | `/katchup` | Katchup | 2 |
| Kall | `/kall` | General | 1 |
| KMail | `/kmail` | KMail | 1 |
| Profile | `/userprofile` | Settings | 1 |
| Settings | `/settings` | Settings | 1 |

## UI check catalogue — runs on every screen

**4** checks, the front-end analogue of the API validators:

- `ui.health`
- `ui.performance`
- `ui.responsive`
- `ui.accessibility`

## Interaction flows (built)

| Flow | Spec | What it drives |
| ---- | ---- | -------------- |
| Navigation | `navigation.spec.ts` | nav-rail icon → route, for every destination |
| Login validation | `login.spec.ts` | empty id / unknown id / valid id advances / wrong password → inline error |
| Settings section | `settings.spec.ts` | expand a section, its items reveal |
| Screen shell | `shell.spec.ts` | header + nav rail on every screen |

## Deep write flows (planned — gated, need live tuning)

- Katchup composer: open → Subject/message validation → send (gated, self-cleaning) → verify → recall
- KMail composer: open → recipient/subject validation → send (gated) → drafts
- Settings theme/font: change through the UI → verify applied → restore

