import { ROOT_DIR } from '@config/constants';
import { expect, test } from '@fixtures';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

/**
 * Guards for Phase 13 — the confidence gate stays SHADOW-ONLY (master plan §15).
 *
 * The phase is unusual in that most of its instruction is restraint:
 *
 *     keep the existing confidence gate shadow-only until evidence is mature
 *     do not enforce confidence prematurely
 *
 * So these guards mostly assert that something has NOT happened, which is the kind of property that
 * decays silently — a later phase wires the gate into filing "just for the eligible ones", and the
 * gate stops being a measurement and starts being a policy before anyone has checked whether its
 * factors are ever actually available on real traffic.
 *
 * The structural boundary is the one worth pinning: the filing code must not be able to READ the
 * gate at all. A rule that cannot be reached cannot be enforced early by accident.
 *
 * Pure: nothing here sends a request or touches an account.
 */

const sourcesUnder = (...segments: string[]): { file: string; source: string }[] => {
  const dir = path.join(ROOT_DIR, ...segments);
  return readdirSync(dir, { recursive: true })
    .map(String)
    .filter((name) => name.endsWith('.ts'))
    .map((name) => ({
      file: path.join(...segments, name),
      source: readFileSync(path.join(dir, name), 'utf8'),
    }));
};

/** Source with block and line comments removed, so prose cannot satisfy or trip a code guard. */
const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

test.describe('confidence · the gate cannot reach filing @framework', () => {
  test('nothing in src/bug-tracker imports the confidence gate', () => {
    /*
     * The structural version of "shadow-only". While the filing code cannot import it, no edit can
     * accidentally make a confidence decision block or permit a ticket — the wire does not exist.
     */
    /*
     * Comments stripped first. `curated/manifest.ts` DOCUMENTS this very boundary — "deduplication,
     * confidence and filing stay separable" — and a guard that trips on its own explanation teaches
     * everyone to stop explaining things. The property under test is an import, which is code.
     */
    const offenders = sourcesUnder('src', 'bug-tracker')
      .filter(({ source }) =>
        /confidence|assessConfidence|ConfidenceDecision/.test(stripComments(source)),
      )
      .map(({ file }) => file);
    expect(
      offenders,
      'filing must not consume the confidence gate until the master plan says to arm it',
    ).toEqual([]);
  });

  test('nothing in src/bug-tracker imports the canonical-defect grouping either', () => {
    // Same reasoning for Phase 12: deduplication, confidence and filing stay separate stages.
    const offenders = sourcesUnder('src', 'bug-tracker')
      .filter(({ source }) => /canonical-defect/.test(stripComments(source)))
      .map(({ file }) => file);
    expect(offenders).toEqual([]);
  });

  test('the gate is consumed only by reporting', () => {
    /*
     * A measurement that nobody reads is as useless as one that is enforced too early. The gate IS
     * wired — into the reporting layer, which is exactly where a shadow run belongs.
     */
    // The gate's OWN exports, not the whole failure-analysis barrel — plenty of modules use the
    // classification types without ever seeing a confidence decision.
    const readers = sourcesUnder('src')
      .filter(({ file }) => !file.includes(path.join('src', 'failure-analysis')))
      .filter(({ source }) => /assessConfidence|ConfidenceDecision|confidenceFactors/.test(source))
      .map(({ file }) => file);
    expect(
      readers.length,
      'the gate has consumers, so the shadow run produces something',
    ).toBeGreaterThan(0);
    expect(
      readers.filter((file) => !file.includes(path.join('src', 'reporting'))),
      'and they are all in the reporting layer',
    ).toEqual([]);
  });
});

test.describe('confidence · the new factors are recorded, not enforced @framework', () => {
  test('no gate rule branches on the Phase 13 factors', () => {
    /*
     * The factors exist so a shadow run can measure how often each is available BEFORE anything is
     * armed on them. A rule that read one today would be enforcing confidence prematurely, which is
     * the phase's other explicit prohibition.
     */
    const gate = readFileSync(
      path.join(ROOT_DIR, 'src', 'failure-analysis', 'confidence-gate.ts'),
      'utf8',
    );
    // They must be ASSIGNED once each (in the factor assembly) and never read in a condition.
    for (const factor of ['independentlyConfirmed', 'distinctCanonicalDefect']) {
      const reads = gate.split(`factors.${factor}`).length - 1;
      expect(reads, `no rule may branch on factors.${factor} yet`).toBe(0);
    }
  });

  test('the factors are still assembled, so the shadow run records them', () => {
    const gate = readFileSync(
      path.join(ROOT_DIR, 'src', 'failure-analysis', 'confidence-gate.ts'),
      'utf8',
    );
    expect(gate).toContain('independentlyConfirmed: independentlyConfirmed(input)');
    expect(gate).toContain('distinctCanonicalDefect: distinctCanonicalDefect(input)');
  });
});

test.describe('confidence · the pipeline stages stay separate @framework', () => {
  test('each stage lives in its own module, in the master plan’s order', () => {
    /*
     *     Observation → Classification → Confirmation → Deduplication → Confidence → Filing
     *
     * Kept apart so each can be wrong on its own. A single module that detected, confirmed,
     * deduplicated and filed would have no point at which a mistake could be caught by a different
     * piece of code — which is the entire argument for the architecture.
     */
    const stages = [
      path.join('src', 'failure-analysis', 'observation.ts'),
      path.join('src', 'failure-analysis', 'classifier.ts'),
      path.join('src', 'confirmation', 'confirm.ts'),
      path.join('src', 'canonical-defect', 'equivalence.ts'),
      path.join('src', 'failure-analysis', 'confidence-gate.ts'),
      path.join('src', 'bug-tracker', 'bugzilla-filer.ts'),
    ];
    for (const stage of stages) {
      expect(
        () => readFileSync(path.join(ROOT_DIR, stage), 'utf8'),
        `${stage} is a stage of the pipeline and must exist as its own module`,
      ).not.toThrow();
    }
  });

  test('confirmation and deduplication cannot send a request', () => {
    /*
     * Both are pure by design, and that is a SAFETY property rather than a stylistic one: if either
     * could reach the network it could repeat a write, and every gate the executor enforces would
     * have a second door.
     */
    const pure = [
      ...sourcesUnder('src', 'confirmation'),
      ...sourcesUnder('src', 'canonical-defect'),
    ];
    expect(pure.length).toBeGreaterThan(0);
    const offenders = pure
      // Comments are stripped first: this file's own prose explains the boundary by naming
      // `EndpointExecutor`, and a guard that tripped on its own explanation would teach everyone to
      // stop explaining things.
      .filter(({ source }) =>
        /EndpointExecutor|apiClient|\bfetch\(|axios|sendTo\(/.test(stripComments(source)),
      )
      .map(({ file }) => file);
    expect(offenders, 'these stages reason over evidence; they never gather it').toEqual([]);
  });
});
