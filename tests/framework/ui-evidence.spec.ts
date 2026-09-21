import { ROOT_DIR } from '@config/constants';
import { expect, test } from '@fixtures';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Phase 16 — what a UI write flow is allowed to call PROOF (master plan §18).
 *
 * ## The rule, in the plan's own words
 *
 *     Do not equate button click, dialog close, URL change, or input value with successful
 *     business behaviour.
 *
 * The reason is circularity. A UI test that clicks Send and then asserts the composer cleared has
 * asked the client whether the client thinks it succeeded. Every one of those signals is produced by
 * the same code that would be wrong if the feature were broken — optimistic rendering shows the
 * bubble, the dialog closes on click rather than on response, and the URL changes before anything is
 * saved. The bench already has the counter-example: `cross-channel.spec.ts` sends in the browser and
 * proves it through the RECIPIENT's API read.
 *
 * ## What this audit does
 *
 * It classifies every gated UI WRITE spec by the strongest evidence it carries, writes
 * `docs/UI-EVIDENCE-AUDIT.md`, and fails when a write flow has none and no recorded reason. It does
 * not try to judge individual assertions — a regex cannot tell a meaningful `toBeVisible` from a
 * meaningless one. It asks the cruder, checkable question: does this spec ever leave the client that
 * performed the action?
 *
 * Pure: nothing here sends a request or opens a browser.
 */

const E2E_DIRS = ['tests/e2e', 'tests/e2e-admin'];

/**
 * The three things that count as outcome evidence, strongest first.
 *
 * Each leaves the client that performed the action, which is the whole property:
 * an API read asks the server; a second browser context asks a different session; a reload throws
 * away the client's optimistic state and re-fetches.
 */
const EVIDENCE_KINDS = [
  {
    key: 'API',
    label: 'API / state read-back',
    pattern: /endpoints\.sendTo|observeAs\(/,
  },
  {
    key: 'CROSS_ACTOR',
    label: "a second actor's own browser",
    pattern: /STORAGE_STATE_2|STORAGE_STATE_3|newContext\(/,
  },
  {
    key: 'RELOAD',
    label: 'UI read-back after a reload',
    pattern: /\.reload\(/,
  },
] as const;

/**
 * Signals that are NOT evidence, named so the report can say what a weak spec is relying on.
 *
 * `toHaveCount(0)` on the control that was just clicked is the clearest case: it asserts the menu
 * closed, which happens on click whether or not the server ever answered.
 */
const WEAK_SIGNALS: readonly (readonly [RegExp, string])[] = [
  [/toHaveCount\(0/, 'a menu or dialog closing'],
  [/toHaveURL/, 'a URL change'],
  [/toHaveValue/, 'an input holding a value'],
];

/**
 * Write flows with no outcome evidence, each with the reason and the path to fixing it.
 *
 * This is coverage DEBT, deliberately visible rather than silently tolerated. An entry here is a
 * claim a reviewer can check, and removing one is the definition of done for that flow.
 */
const EVIDENCE_DEBT: Readonly<Record<string, string>> = {
  'katchup-actions.spec.ts':
    'Delete, Save and Copy each assert only that the menu or confirm dialog closed — the exact signal ' +
    'the master plan forbids. Delete has a ready path: the plan names "delete → read-back proves ' +
    'absence", and the API read-back must run as the SENDER, which displaces that account\'s browser ' +
    'session (the Phase 8 defect), so it has to be the last action of the test or use a re-auth.',
  'katchup-actions-more.spec.ts':
    'Note, Reminder, Transfer and Forward assert the sub-flow modal was driven, not that the resulting ' +
    'message exists. Each has an API counterpart already driven by katchup/feature.spec.ts, so the ' +
    'read-back is available; it needs the same sender-session care as Delete.',
  'katchup-compose.spec.ts':
    "Send and recall are asserted in the sender's own view. Recall is recipient-side by definition " +
    "(BR-K03), so the meaningful evidence is the RECIPIENT's read — which cross-channel.spec.ts " +
    'already demonstrates and this spec predates.',
  'katchup-copies.spec.ts':
    'The confidential-copy concealment IS asserted across three real browser sessions, which is strong ' +
    'cross-actor evidence; it is listed here only because the SEND itself is confirmed in the ' +
    "sender's own view. Lower priority than the rest.",
  'katchup-continuous.spec.ts':
    'Reproduces "the second send fails without a refresh". Its signal is deliberately the failed ' +
    'network call rather than a read-back, because the defect is that the send never happens. ' +
    'Adding an API read-back would confirm absence but not the freeze; both would be better.',
  'kall-features.spec.ts':
    'The schedule form is driven but Submit is codegen-blocked (the participant picker is a nested ' +
    'custom widget), so there is no created call to read back yet. The plan names "Kall schedule → ' +
    'call record exists with correct participants"; the API lifecycle already proves that half.',
  'kmail-compose.spec.ts':
    'Send is confirmed by the toast and the compose form clearing. The plan names "mail send → ' +
    'transaction state exists"; the kmail API lifecycle can read the sent mail back by kmailID.',
  'contacts.spec.ts':
    'Block and unblock are asserted through the blocked-contacts panel, which is the same client. The ' +
    'API block/unblock lifecycle is green, so a read-back of getblockContactDetails is available.',
  'kdiary.spec.ts':
    'The diary UI is reached from inside the rails and the write is asserted by the toast. The API ' +
    'lifecycle proves createEvent/deleteEvent, so an eventID read-back is available.',
  'profile-actions.spec.ts':
    'Read-only assertions on the profile sections; the two write flows it would cover are ' +
    'codegen-blocked (hover-revealed pencils). No write is performed, so there is nothing to read back ' +
    'yet — it is listed for completeness rather than as debt.',
  'profile-edit.spec.ts':
    'About edit reads the value back in the UI and restores it. That is a genuine read-back but through ' +
    'the same client; getUserProfileUsingKpostID would make it independent.',
  'settings-theme.spec.ts':
    'A theme change is client-side by nature and is restored by the test. getPersonalize would confirm ' +
    'it persisted server-side, which is the part currently unproven.',
  'usermanagement.spec.ts':
    'Deliberately stops before completing the add — finishing it provisions a real member account, ' +
    'which is gated at the API level. Nothing is written, so there is nothing to read back.',
  'login-session.spec.ts':
    'Logout is asserted by the redirect to /login. Here the redirect IS the behaviour rather than a ' +
    'proxy for it, but the session being dead server-side is the stronger claim and is unproven.',
  'admin-screens.spec.ts':
    'Gated behind ADMIN_UI_LIFECYCLE because the SSO seed writes a token into the admin origin, but ' +
    'the spec itself only navigates and asserts each screen mounted — it performs no application ' +
    'write, so there is no outcome to read back. It is blocked for a separate reason: no dedicated ' +
    'admin UI test deployment exists, and the plan is explicit that automated UI tests must not be ' +
    'pointed at the production admin UI merely because it responds.',
  'katchup-two-session.spec.ts':
    'Carries cross-actor evidence (a real second browser receives the message), so it is NOT debt. ' +
    'Listed only because its own composer entry point is blocked for a non-contact — the same limit ' +
    'cross-channel.spec.ts works around with a declared API-seeded precondition.',
};

interface SpecRow {
  file: string;
  write: boolean;
  evidence: string[];
  weak: string[];
}

function specFiles(): string[] {
  const out: string[] = [];
  for (const dir of E2E_DIRS) {
    const root = path.join(ROOT_DIR, dir);
    for (const name of readdirSync(root)) {
      if (name.endsWith('.spec.ts')) out.push(path.join(root, name));
    }
  }
  return out.sort();
}

function audit(): SpecRow[] {
  return specFiles().map((file) => {
    const source = readFileSync(file, 'utf8');
    return {
      file: path.basename(file),
      // The repository's own convention: a UI flow that writes is gated behind a `*_UI_LIFECYCLE`
      // flag. Using the gate rather than guessing from verbs means the classification cannot drift
      // from the safety control that already decides which specs may write.
      write: /UI_LIFECYCLE/.test(source),
      evidence: EVIDENCE_KINDS.filter((kind) => kind.pattern.test(source)).map((kind) => kind.key),
      weak: WEAK_SIGNALS.filter(([pattern]) => pattern.test(source)).map(([, label]) => label),
    };
  });
}

test.describe('UI evidence audit @framework', () => {
  test('every UI write flow either proves its outcome or records why it cannot', () => {
    /*
     * The guard the phase turns on. A write flow with no outcome evidence and no recorded reason is
     * a test that can only tell you the client did not crash — and it reads on every report as
     * feature coverage.
     */
    const undocumented = audit()
      .filter((row) => row.write && row.evidence.length === 0 && !EVIDENCE_DEBT[row.file])
      .map((row) => row.file);
    expect(
      undocumented,
      'a UI write flow must leave the client that performed the action, or say why it cannot',
    ).toEqual([]);
  });

  test('every debt entry still names a real spec and gives a path', () => {
    // A debt list that outlives its specs stops being a plan and becomes decoration.
    const present = new Set(audit().map((row) => row.file));
    expect(
      Object.keys(EVIDENCE_DEBT).filter((file) => !present.has(file)),
      'an entry for a spec that no longer exists hides nothing and misleads',
    ).toEqual([]);
    expect(
      Object.entries(EVIDENCE_DEBT)
        .filter(([, reason]) => reason.length < 60)
        .map(([file]) => file),
      'a reason must say what is missing and how it would be closed',
    ).toEqual([]);
  });

  test('the reference flow really does carry API evidence', () => {
    /*
     * `cross-channel.spec.ts` is what every entry in the debt list points at. If it ever lost its
     * API read-back the debt list would be pointing at nothing, and the standard would quietly drop
     * to whatever the weakest spec does.
     */
    const reference = audit().find((row) => row.file === 'cross-channel.spec.ts');
    expect(reference?.evidence, 'the pattern the rest are measured against').toContain('API');
  });

  test('writes docs/UI-EVIDENCE-AUDIT.md', () => {
    const rows = audit();
    const writes = rows.filter((row) => row.write);
    const proven = writes.filter((row) => row.evidence.length > 0);

    const lines = [
      '# UI evidence audit — what each UI flow accepts as proof',
      '',
      '**GENERATED — do not edit.** Written by `tests/framework/ui-evidence.spec.ts`.',
      '',
      'The master plan (§18): *do not equate button click, dialog close, URL change, or input value',
      'with successful business behaviour.* The reason is circularity — every one of those signals is',
      'produced by the same client that would be wrong if the feature were broken. Optimistic',
      'rendering shows the bubble, a dialog closes on click rather than on response, and a URL changes',
      'before anything is saved.',
      '',
      '| | Count |',
      '| - | ----: |',
      `| UI specs | ${String(rows.length)} |`,
      `| — that WRITE (gated behind a \`*_UI_LIFECYCLE\` flag) | ${String(writes.length)} |`,
      `| — …carrying outcome evidence | **${String(proven.length)}** |`,
      `| — …with recorded evidence debt | ${String(writes.length - proven.length)} |`,
      '',
      '## What counts as outcome evidence',
      '',
      'Each leaves the client that performed the action, which is the whole property.',
      '',
      '| Kind | Why it counts |',
      '| ---- | ------------- |',
      ...EVIDENCE_KINDS.map(
        (kind) =>
          `| ${kind.key} | ${kind.label} — ${
            kind.key === 'API'
              ? 'asks the server directly'
              : kind.key === 'CROSS_ACTOR'
                ? 'asks a different session, which cannot share the sender optimistic state'
                : 'throws away the client optimistic state and re-fetches'
          } |`,
      ),
      '',
      '## Per-spec',
      '',
      '| Spec | Writes | Outcome evidence | Also relies on | Status |',
      '| ---- | ------ | ---------------- | -------------- | ------ |',
      ...rows.map((row) => {
        const status = !row.write
          ? 'read-only'
          : row.evidence.length > 0
            ? 'PROVEN'
            : EVIDENCE_DEBT[row.file]
              ? 'DEBT (reason recorded)'
              : 'UNPROVEN';
        return (
          `| \`${row.file}\` | ${row.write ? 'yes' : '—'} | ` +
          `${row.evidence.join(', ') || '—'} | ${row.weak.join(', ') || '—'} | ${status} |`
        );
      }),
      '',
      '## Evidence debt — write flows that cannot yet prove their outcome',
      '',
      'Each entry says what is missing and how it would be closed. Removing an entry is the',
      'definition of done for that flow.',
      '',
      '| Spec | Why, and the path to closing it |',
      '| ---- | ------------------------------- |',
      ...Object.entries(EVIDENCE_DEBT).map(([file, reason]) => `| \`${file}\` | ${reason} |`),
      '',
    ];
    writeFileSync(path.join(ROOT_DIR, 'docs', 'UI-EVIDENCE-AUDIT.md'), lines.join('\n'));
    expect(rows.length).toBeGreaterThan(20);
  });
});
