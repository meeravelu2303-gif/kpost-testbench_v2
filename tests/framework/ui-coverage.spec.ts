// Generates docs/UI-COVERAGE.md, so the "conditionals" flagged here are table formatting.
/* eslint-disable playwright/no-conditional-in-test */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT_DIR } from '@config/constants';
import { KNOWN_COMPONENTS, componentFor, suiteFor } from '@config/ownership.config';
import { AUTHENTICATED_SCREENS, NAV_LINKS } from '@ui/screens';
import { UI_CHECKS } from '@ui/ui-checks';
import { expect, test } from '@fixtures';

/**
 * THE UI coverage ledger — the front-end analogue of `coverage-ledger.spec.ts`. It accounts for every
 * screen the deep suite drives, the check catalogue every screen inherits, and the interaction flows,
 * and it **fails the build** if a screen would route a bug to a component that does not exist in the
 * KPost UI product. So UI coverage is measurable and self-checking, not asserted by hand.
 *
 * Generated to `docs/UI-COVERAGE.md`, never hand-kept.
 */

/** The interaction flows that exist today (spec files under tests/e2e), for the ledger. */
const INTERACTION_FLOWS: Array<{ flow: string; spec: string; note: string }> = [
  {
    flow: 'Navigation',
    spec: 'navigation.spec.ts',
    note: 'nav-rail icon → route, for every destination',
  },
  {
    flow: 'Login validation',
    spec: 'login.spec.ts',
    note: 'empty id / unknown id / valid id advances / wrong password → inline error',
  },
  {
    flow: 'Settings section',
    spec: 'settings.spec.ts',
    note: 'expand a section, its items reveal',
  },
  { flow: 'Screen shell', spec: 'shell.spec.ts', note: 'header + nav rail on every screen' },
];

/** The deep write flows still to build (need the gated-write approval + live tuning). */
const PLANNED_FLOWS = [
  'Katchup composer: open → Subject/message validation → send (gated, self-cleaning) → verify → recall',
  'KMail composer: open → recipient/subject validation → send (gated) → drafts',
  'Settings theme/font: change through the UI → verify applied → restore',
];

test.describe('UI coverage ledger @framework', () => {
  test('every screen routes to a real UI component, and the ledger is written', () => {
    const ui = suiteFor('kpost-ui');
    const known = KNOWN_COMPONENTS['kpost-ui'];
    const misrouted: string[] = [];

    const screenRows = AUTHENTICATED_SCREENS.map((screen) => {
      const component = componentFor(ui, [screen.screen]);
      if (known && !known.has(component)) {
        misrouted.push(`${screen.name} → "${component}" (not a KPost UI component)`);
      }
      return {
        name: screen.name,
        route: screen.route,
        component,
        controls: screen.controls.length,
      };
    });

    const checkNames = UI_CHECKS.map((c) => c.name);

    const lines: string[] = [
      '# UI coverage ledger — every screen, every check',
      '',
      '**GENERATED — do not edit.** Written by `tests/framework/ui-coverage.spec.ts`',
      '(`npm run test:framework`). It reconciles the screen registry, the UI check catalogue and the',
      'interaction flows, and fails the build if a screen would route a bug to a non-existent component.',
      '',
      '## Screens',
      '',
      `Every screen inherits the **full check catalogue** below. Covered: **${screenRows.length}** screens.`,
      '',
      '| Screen | Route | Bugzilla component | Key controls checked |',
      '| ------ | ----- | ------------------ | -------------------: |',
      ...screenRows.map((r) => `| ${r.name} | \`${r.route}\` | ${r.component} | ${r.controls} |`),
      '',
      '## UI check catalogue — runs on every screen',
      '',
      `**${checkNames.length}** checks, the front-end analogue of the API validators:`,
      '',
      ...checkNames.map((n) => `- \`${n}\``),
      '',
      '## Interaction flows (built)',
      '',
      '| Flow | Spec | What it drives |',
      '| ---- | ---- | -------------- |',
      ...INTERACTION_FLOWS.map((f) => `| ${f.flow} | \`${f.spec}\` | ${f.note} |`),
      '',
      '## Deep write flows (planned — gated, need live tuning)',
      '',
      ...PLANNED_FLOWS.map((f) => `- ${f}`),
      '',
    ];

    const outPath = path.join(ROOT_DIR, 'docs', 'UI-COVERAGE.md');
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, `${lines.join('\n')}\n`);

    // The hard guarantees.
    expect(misrouted, 'screens routed to a non-existent UI component').toEqual([]);
    expect(
      UI_CHECKS.length,
      'the UI check catalogue must cover several dimensions',
    ).toBeGreaterThan(3);
    expect(NAV_LINKS.length, 'the nav rail must have destinations to exercise').toBeGreaterThan(0);
  });
});
