import fs from 'node:fs';
import path from 'node:path';
import { ROOT_DIR } from '@config/constants';
import { KNOWN_COMPONENTS, componentFor, suiteFor } from '@config/ownership.config';
import {
  ALL_SCREENS,
  AUTHENTICATED_SCREENS,
  BUSINESS_SCREENS,
  NAV_LINKS,
  PUBLIC_SCREENS,
  ROUTE_ALIASES,
} from '@ui/screens';
import { UI_CHECKS } from '@ui/ui-checks';
import { expect, test } from '@fixtures';

/**
 * THE UI coverage ledger — the front-end analogue of `coverage-ledger.spec.ts`. It accounts for every
 * screen the deep suite drives, the check catalogue every screen inherits, and the interaction flows,
 * and it **fails the build** if a screen would route a bug to a component that does not exist in the
 * KPost UI product. So UI coverage is measurable and self-checking, not asserted by hand.
 *
 * Generated to `docs/generated/ui-coverage.md`, never hand-kept.
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
    flow: 'Login & session (deep)',
    spec: 'login-session.spec.ts',
    note: 'session guard redirect · Forgot-Password modal (no OTP) · Sign-Up link · logout (gated)',
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
    note: 'sender bell menu → Delete · Edit (Edited marker, BR-K03) · Save · Copy, each self-cleaning (gated)',
  },
  {
    flow: 'Katchup sub-flow actions',
    spec: 'katchup-actions-more.spec.ts',
    note: 'bell menu → Note · Reminder · Transfer · Forward · Forward-with-thread · Recall&Repost (entry wired, self-clean, gated)',
  },
  {
    flow: 'Katchup attach-and-send',
    spec: 'katchup-attach-send-e2e.spec.ts',
    note: 'compose → attach a real file → upload → send → thread renders the thumbnail (gated, self-clean)',
  },
  {
    flow: 'Katchup Note sub-flow (completion)',
    spec: 'katchup-note-subflow-e2e.spec.ts',
    note: 'bell menu Note → composer opens pre-filled with reply context → type a note body → send (gated, self-clean)',
  },
  {
    flow: 'Katchup Transfer sub-flow (completion)',
    spec: 'katchup-transfer-subflow-e2e.spec.ts',
    note: 'bell menu Transfer → Katchup recipient picker → select a contact → Done sends (gated, self-clean)',
  },
  {
    flow: 'Katchup Forward sub-flow (completion)',
    spec: 'katchup-forward-subflow-e2e.spec.ts',
    note: 'bell menu Forward → recipient picker narrows to one contact → Done → final send button → forward actually sends (gated, self-clean)',
  },
  {
    flow: 'Katchup secret/confidential message',
    spec: 'katchup-secret-message-e2e.spec.ts',
    note: 'composer → Secret message → Delete-as-per-Schedule → Done → the confidential message sends (gated, self-clean)',
  },
  {
    flow: 'Katchup search',
    spec: 'katchup-search.spec.ts',
    note: 'type in the search box → the conversation list filters to the match (read-only, safe)',
  },
  {
    flow: 'Katchup two-session',
    spec: 'katchup-two-session.spec.ts',
    note: 'account 1 sends → account 2 (own context) receives + Reply/Comment/Clarify + read receipt (gated, self-clean)',
  },
  {
    flow: 'Katchup Copy / Confidential / Bulk',
    spec: 'katchup-copies.spec.ts',
    note: '3-account: visible Copy seen by TO · Confidential Copy hidden from TO (NFR-SEC02) · bulk to many (gated)',
  },
  {
    flow: 'KMail compose',
    spec: 'kmail-compose.spec.ts',
    note: '/writemail form renders (To/Subject/body, green) · compose → send (gated KMAIL_UI_LIFECYCLE)',
  },
  {
    flow: 'Kall features',
    spec: 'kall-features.spec.ts',
    note: 'screen + tabs (green) · schedule a Kool Kall via CreateKallModal (gated KALL_UI_LIFECYCLE)',
  },
  {
    flow: 'Settings sections',
    spec: 'settings-sections.spec.ts',
    note: 'nav groups + expand General Settings / Profile Creation to their items (read-only, green)',
  },
  {
    flow: 'Verticals features',
    spec: 'verticals-features.spec.ts',
    note: 'KNews search · KDirectory · KCloud storage · KDoc/KOS tools · E-Commerce grid render (green)',
  },
  {
    flow: 'Contacts',
    spec: 'contacts.spec.ts',
    note: 'contact rail lists + searchable · blocked-contacts screen (read-only) · block→unblock (gated, self-restoring)',
  },
  {
    flow: 'Group',
    spec: 'group.spec.ts',
    note: 'create-group modal → Group Name + member → submit → delete (gated, self-cleaning)',
  },
  {
    flow: 'Profile edit',
    spec: 'profile-edit.spec.ts',
    note: 'own profile → About section edit pencil → Update → verify → restore (gated, self-restoring)',
  },
  {
    flow: 'Profile actions',
    spec: 'profile-actions.spec.ts',
    note: 'three-dot menu (Change Picture/Share/Logout) + About/Experience/Education sections (green) · Experience add (gated)',
  },
  {
    flow: 'Settings theme',
    spec: 'settings-theme.spec.ts',
    note: 'Personalize → change KPost layout theme → Apply → verify active → restore original (gated, self-restoring)',
  },
];

/**
 * The deep write flows still to build (need the gated-write approval + live tuning). Selectors are
 * mined in `docs/ui/ui-build-plan.md` (the original flow plan is archived as
 * `docs/archive/ui-write-flows-2026-09-28.md`); each has a green API lifecycle.
 */
const PLANNED_FLOWS = [
  'Katchup group send + per-recipient read receipts (needs 3 QA accounts + recording — confidential-copy and attachments are now built, see Interaction flows above)',
  'KMail composer: open → recipient/subject → send (gated) → verify in Sent → delete; reply, drafts',
  'Settings font + notifications: change through the UI → verify applied → restore (theme is built)',
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

    const screenRows = ALL_SCREENS.map((screen) => {
      const component = componentFor(ui, [screen.screen]);
      if (known && !known.has(component)) {
        misrouted.push(`${screen.name} → "${component}" (not a KPost UI component)`);
      }
      return {
        name: screen.name,
        route: screen.route,
        session: screen.session ?? 'personal',
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
      `Every screen inherits the **full check catalogue** below. Covered: **${screenRows.length}** screens ` +
        `(${AUTHENTICATED_SCREENS.length} personal-session, ${BUSINESS_SCREENS.length} business-session, ` +
        `${PUBLIC_SCREENS.length} public). Sweeps: \`screens-batch1..4\`, \`screens-business\`, \`screens-public\`.`,
      '',
      '| Screen | Route | Session | Bugzilla component | Key controls checked |',
      '| ------ | ----- | ------- | ------------------ | -------------------: |',
      ...screenRows.map(
        (r) => `| ${r.name} | \`${r.route}\` | ${r.session} | ${r.component} | ${r.controls} |`,
      ),
      '',
      '### Routes that are aliases, not screens',
      '',
      '| Route | Resolves to | Note |',
      '| ----- | ----------- | ---- |',
      ...ROUTE_ALIASES.map((a) => `| \`${a.route}\` | \`${a.resolvesTo}\` | ${a.note} |`),
      '',
      '### Public routes that need a real id (kept in their own specs)',
      '',
      '| Route | Spec |',
      '| ----- | ---- |',
      '| `/digital-card/:id` | `global-digital-card.spec.ts` |',
      '| `/koolkall/:id` | `global-kool-kall.spec.ts` |',
      '| `/profile-webview/:id` | `profile-webview.spec.ts` |',
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

    const outPath = path.join(ROOT_DIR, 'docs', 'generated', 'ui-coverage.md');
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
