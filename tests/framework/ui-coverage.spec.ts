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
  { flow: 'Screen shell', spec: 'shell.spec.ts', note: 'header + nav rail on every screen' },
  {
    flow: 'Katchup compose',
    spec: 'katchup-compose.spec.ts',
    note: 'open a chat → open composer → enter Subject (BR-K01) + message; gated send + recall (green)',
  },
  {
    flow: 'Katchup message actions',
    spec: 'katchup-actions.spec.ts',
    note: 'sender bell menu → Delete (confirm) and Edit (resend + Edited marker, BR-K03), self-cleaning (gated)',
  },
];

/**
 * The deep write flows still to build (need the gated-write approval + live tuning). Selectors are
 * mined and the flows are specified in `docs/ui-write-flows.md`; each has a green API lifecycle.
 */
const PLANNED_FLOWS = [
  'Katchup group / confidential-copy / attachments (needs 3 QA accounts + recording)',
  'KMail composer: open → recipient/subject → send (gated) → verify in Sent → delete; reply, drafts',
  'Settings theme/font: change through the UI → verify applied → restore (safe, self-restoring)',
  'Profile: Edit Profile → change About → Update → verify → restore',
  'Contacts: search → add → block → unblock → remove (inside the Katchup rail)',
  'Kall: schedule → verify in log → reschedule (status flips) → delete (direct-call ring stays UI-only)',
  'KDiary: create event → verify → delete (reached from inside Katchup)',
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
