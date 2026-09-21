import { ROOT_DIR } from '@config/constants';
import { expect, test } from '@fixtures';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import * as calibrationModule from '../../src/state-calibration/index';
import {
  CALIBRATION_VERDICTS,
  CalibrationSession,
  FORBIDDEN_CALIBRATION_TERMS,
  KATCHUP_PHASES,
  deriveReadPerspective,
  deriveReadTransitionMechanism,
  observedRepresentation,
} from '../../src/state-calibration/index';
import { observeBody } from '../../src/state-observation/index';

/**
 * Guards for Phase 4D — the calibration infrastructure.
 *
 * Entirely OFFLINE. Every observation below is produced by the real Phase 4C extractor from a
 * synthetic body, so the whole chain — body → observation → session → finding — is exercised without
 * a single live request.
 *
 * What they prove: that a before/after comparison is anchored to one resource; that a derivation
 * returns UNKNOWN rather than forcing a conclusion; and that a finding can never carry a verdict
 * this layer is forbidden to reach.
 */

const MSG = '8101';

/** A conversation body where the message is unread. */
const unread = {
  data: [
    { msgID: 8101, status: 0, readTime: null },
    // A second message, so every comparison has a chance to pick the wrong row.
    { msgID: 8247, status: 2, readTime: '2026-09-01T00:00:00.000+00:00' },
  ],
};

/** The same conversation after the message has been read. */
const read = {
  data: [
    { msgID: 8101, status: 2, readTime: '2026-09-20T10:00:00.000+00:00' },
    { msgID: 8247, status: 2, readTime: '2026-09-01T00:00:00.000+00:00' },
  ],
};

const CTX = { correlationId: 'tb-cal', runId: 'run-cal', testCaseId: 'TC-CAL' };

function observationsFor(body: unknown): ReturnType<typeof observeBody> {
  return [
    ...observeBody(body, { ...CTX, observationId: 'katchup.message.lifecycle-via-conversation' }),
    ...observeBody(body, { ...CTX, observationId: 'katchup.message.read-time-via-conversation' }),
  ];
}

/** A session in which the sender's view changed across the recipient's API read. */
function sessionWithChange(): CalibrationSession {
  const session = new CalibrationSession('test.scenario', '2026-09-20T00:00:00.000Z', 'run-cal');
  session.record(KATCHUP_PHASES.senderBefore, observationsFor(unread), { actorRole: 'sender' });
  session.record(KATCHUP_PHASES.recipientBefore, observationsFor(unread), {
    actorRole: 'recipient',
  });
  session.record(KATCHUP_PHASES.senderAfter, observationsFor(read), { actorRole: 'sender' });
  session.record(KATCHUP_PHASES.recipientAfter, observationsFor(read), { actorRole: 'recipient' });
  return session;
}

/** A session in which nothing moved. */
function sessionWithoutChange(): CalibrationSession {
  const session = new CalibrationSession('test.scenario', '2026-09-20T00:00:00.000Z', 'run-cal');
  for (const phase of Object.values(KATCHUP_PHASES)) {
    session.record(phase, observationsFor(unread));
  }
  return session;
}

const SOURCES = ['calibration-result.ts', 'session.ts', 'katchup-read.ts', 'index.ts'] as const;
const source = (file: string): string =>
  readFileSync(path.join(ROOT_DIR, 'src', 'state-calibration', file), 'utf8');

const FORBIDDEN_IMPORTS = [
  'bug-tracker',
  'failure-analysis',
  'reporting',
  'validators',
  'validation-engine',
  'api/client',
  'api/definitions',
  'playwright',
  'database',
  'flows',
] as const;

const LIVE_SPEC = path.join(
  ROOT_DIR,
  'tests',
  'api',
  'kpost',
  'katchup',
  'state-calibration.spec.ts',
);

// ---------------------------------------------------------------------------------------------
// 1. Session recording and correlation
// ---------------------------------------------------------------------------------------------

test.describe('state calibration: session @framework', () => {
  test('observations are recorded against their phase and actor', () => {
    const session = sessionWithChange();
    expect(session.phases()).toEqual([
      KATCHUP_PHASES.senderBefore,
      KATCHUP_PHASES.recipientBefore,
      KATCHUP_PHASES.senderAfter,
      KATCHUP_PHASES.recipientAfter,
    ]);
    const senderRecords = session.select({ phase: KATCHUP_PHASES.senderBefore });
    expect(senderRecords.every((r) => r.actorRole === 'sender')).toBe(true);
  });

  test('a before/after comparison is anchored to ONE resource', () => {
    const session = sessionWithChange();
    // 8247 is Read in both phases; 8101 moves. Selecting by resource is what keeps them apart.
    expect(
      session.one({ phase: KATCHUP_PHASES.senderBefore, stateKey: 'status', resourceId: MSG })
        ?.rawValue,
    ).toBe(0);
    expect(
      session.one({ phase: KATCHUP_PHASES.senderAfter, stateKey: 'status', resourceId: MSG })
        ?.rawValue,
    ).toBe(2);
    expect(
      session.one({ phase: KATCHUP_PHASES.senderBefore, stateKey: 'status', resourceId: '8247' })
        ?.rawValue,
    ).toBe(2);
  });

  test('two sessions share nothing', () => {
    const first = sessionWithChange();
    const second = new CalibrationSession('other', '2026-09-20T00:00:00.000Z');
    expect(second.records()).toEqual([]);
    expect(second.phases()).toEqual([]);
    expect(first.records().length).toBeGreaterThan(0);
  });

  test('the result carries observations and findings but no response body', () => {
    const session = sessionWithChange();
    session.addFinding(deriveReadPerspective(session, MSG));
    const serialised = JSON.stringify(session.result());
    expect(serialised).toContain('katchup.message.lifecycle-via-conversation');
    // The envelope and untouched sibling fields never enter the result.
    expect(serialised).not.toContain('"data"');
    expect(session.result().records.length).toBeGreaterThan(0);
  });

  test('cleanup outcomes are recorded separately from observations', () => {
    const session = sessionWithChange();
    session.addCleanup({ kind: 'katchup-message', id: MSG, outcome: 'CLEANED' });
    expect(session.cleanup()).toEqual([{ kind: 'katchup-message', id: MSG, outcome: 'CLEANED' }]);
    // A cleanup record is not an observation and never mixes into one.
    expect(session.records().some((r) => 'outcome' in r)).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------
// 2. Derivation — the read transition mechanism
// ---------------------------------------------------------------------------------------------

test.describe('state calibration: transition mechanism @framework', () => {
  test('a sender-visible change across the recipient API read is CONFLICTED against the model', () => {
    const finding = deriveReadTransitionMechanism(sessionWithChange(), MSG);
    // Phase 4B declares the transition UI-only; evidence of an API-driven change contradicts that,
    // and the contradiction is the finding — not a silent model edit.
    expect(finding.verdict).toBe('CONFLICTED');
    expect(finding.statement).toContain('performs the read transition');
    expect(finding.bearsOnConflicts).toContain('CONF-KATCHUP-READ-PERSPECTIVE');
    expect(finding.evidence.length).toBeGreaterThan(0);
  });

  test('no change means UNKNOWN, with what would resolve it', () => {
    const finding = deriveReadTransitionMechanism(sessionWithoutChange(), MSG);
    expect(finding.verdict).toBe('UNKNOWN');
    expect(finding.statement).toContain('did NOT change');
    expect(finding.whatWouldResolve).toContain('UI');
  });

  test('missing observations yield UNKNOWN rather than a guess', () => {
    const empty = new CalibrationSession('empty', '2026-09-20T00:00:00.000Z');
    const finding = deriveReadTransitionMechanism(empty, MSG);
    expect(finding.verdict).toBe('UNKNOWN');
    expect(finding.evidence).toEqual([]);
    expect(finding.whatWouldResolve).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------------------------
// 3. Derivation — the read perspective
// ---------------------------------------------------------------------------------------------

test.describe('state calibration: read perspective @framework', () => {
  test('a sender-visible change confirms the field is not a private per-caller view', () => {
    const finding = deriveReadPerspective(sessionWithChange(), MSG);
    expect(finding.verdict).toBe('CONFIRMED_REPRESENTATION');
    expect(finding.statement).toContain('NOT a private per-caller view');
    // The claim is bounded — it does not silently generalise to group messages.
    expect(finding.limitation).toContain('1:1');
    expect(finding.limitation).toContain('group');
  });

  test('without a witnessed read the Phase 4B UNKNOWN stands unchanged', () => {
    const finding = deriveReadPerspective(sessionWithoutChange(), MSG);
    expect(finding.verdict).toBe('UNKNOWN');
    expect(finding.statement).toContain('Phase 4B UNKNOWN stands');
  });

  test('the derivation never resolves the perspective from an absent observation', () => {
    const partial = new CalibrationSession('partial', '2026-09-20T00:00:00.000Z');
    partial.record(KATCHUP_PHASES.senderBefore, observationsFor(unread), { actorRole: 'sender' });
    const finding = deriveReadPerspective(partial, MSG);
    expect(finding.verdict).toBe('UNKNOWN');
  });

  test('an OBSERVED representation states values without interpreting them', () => {
    const session = sessionWithChange();
    const finding = observedRepresentation(
      'katchup.representation',
      session.select({ phase: KATCHUP_PHASES.senderAfter, stateKey: 'status', resourceId: MSG }),
      'How this build represents it.',
    );
    expect(finding.verdict).toBe('OBSERVED');
    expect(finding.statement).toContain('status=2');
    // Raw, not translated.
    expect(finding.statement).not.toContain('READ');
  });

  test('an empty selection is UNKNOWN, not a silently empty OBSERVED', () => {
    expect(observedRepresentation('x', [], 'note.').verdict).toBe('UNKNOWN');
  });
});

// ---------------------------------------------------------------------------------------------
// 4. Verdict vocabulary and architecture
// ---------------------------------------------------------------------------------------------

test.describe('state calibration: boundaries @framework', () => {
  test('the verdict vocabulary contains no pass/fail concept', () => {
    expect([...CALIBRATION_VERDICTS]).toEqual([
      'OBSERVED',
      'CONFIRMED_REPRESENTATION',
      'UNKNOWN',
      'CONFLICTED',
    ]);
    for (const forbidden of ['PASS', 'FAIL', 'BUG', 'DEFECT']) {
      expect([...CALIBRATION_VERDICTS], forbidden).not.toContain(forbidden);
    }
  });

  test('no finding carries a judgement term', () => {
    const session = sessionWithChange();
    const findings = [
      deriveReadTransitionMechanism(session, MSG),
      deriveReadPerspective(session, MSG),
    ];
    const serialised = JSON.stringify(findings);
    for (const term of FORBIDDEN_CALIBRATION_TERMS) {
      expect(serialised, term).not.toContain(term);
    }
  });

  test('the module imports nothing from Bugzilla, confidence, validators or execution', () => {
    for (const file of SOURCES) {
      const imports = [...source(file).matchAll(/from '([^']+)'/g)].map((m) => m[1] ?? '');
      for (const specifier of imports) {
        for (const forbidden of FORBIDDEN_IMPORTS) {
          expect(specifier, `${file} imports ${specifier}`).not.toContain(forbidden);
        }
      }
    }
  });

  test('the dependency direction stays states ← state-observation ← calibration', () => {
    // The calibration layer may consume the two below it; neither may consume it.
    for (const file of ['registry.ts', 'validate.ts', 'index.ts']) {
      expect(
        readFileSync(path.join(ROOT_DIR, 'src', 'states', file), 'utf8'),
        `src/states/${file}`,
      ).not.toContain('state-calibration');
    }
    for (const file of ['extract.ts', 'index.ts']) {
      expect(
        readFileSync(path.join(ROOT_DIR, 'src', 'state-observation', file), 'utf8'),
        `src/state-observation/${file}`,
      ).not.toContain('state-calibration');
    }
  });

  test('the module performs no execution of its own', () => {
    for (const file of SOURCES) {
      const code = source(file)
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');
      for (const token of ['fetch(', 'sendTo(', 'page.', 'request(', 'login(']) {
        expect(code, `${file} contains ${token}`).not.toContain(token);
      }
    }
  });
});

// ---------------------------------------------------------------------------------------------
// 5. Live-scenario safety
// ---------------------------------------------------------------------------------------------

test.describe('state calibration: live safety @framework', () => {
  test('the live scenario cannot run without an explicit lifecycle gate', () => {
    const spec = readFileSync(LIVE_SPEC, 'utf8');
    // Each describe block is gated, so a default run — and a mock run — executes none of them.
    expect(spec).toContain('test.skip(\n    !env.KATCHUP_LIFECYCLE');
    expect(spec).toContain('test.skip(!env.KALL_LIFECYCLE');
    expect(spec).toContain('test.skip(!env.KMAIL_LIFECYCLE');
  });

  test('the live scenario registers its created resource for cleanup', () => {
    const spec = readFileSync(LIVE_SPEC, 'utf8');
    expect(spec).toContain('resources.track(');
    expect(spec).toContain("kind: 'katchup-message'");
    // The delete is the ledger's cleanup operation, not a best-effort afterthought.
    expect(spec).toContain('cleanup: () => deleteMessage(');
  });

  test('the live scenario touches no Bugzilla, confidence or failure-analysis code', () => {
    const spec = readFileSync(LIVE_SPEC, 'utf8');
    for (const forbidden of ['bug-tracker', 'failure-analysis', 'confidence', 'bugzilla']) {
      expect(spec, forbidden).not.toContain(forbidden);
    }
  });

  test('the live scenario asserts no state VALUE', () => {
    const spec = readFileSync(LIVE_SPEC, 'utf8');
    // Its only assertions are infrastructure preconditions. None compares a state field to a value.
    for (const forbidden of [
      "stateKey === 'status'",
      'toBe(2)',
      'toBe(0)',
      'rawValue).toBe(',
      'expectedStatus',
    ]) {
      expect(spec, forbidden).not.toContain(forbidden);
    }
  });

  test('the public surface calibrates only — it cannot file, score or classify', () => {
    const exported = Object.keys(calibrationModule);
    for (const forbidden of ['file', 'score', 'classify', 'assertState', 'validate']) {
      expect(exported, forbidden).not.toContain(forbidden);
    }
  });
});
