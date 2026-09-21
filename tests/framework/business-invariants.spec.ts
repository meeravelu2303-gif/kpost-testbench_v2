import { apiRegistry } from '@api/definitions/index';
import { ROOT_DIR } from '@config/constants';
import { expect, test } from '@fixtures';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  BUSINESS_INVARIANTS,
  conflictedInvariants,
  invariantSummary,
  invariantsOf,
  validateInvariants,
  type BusinessInvariant,
  type InvariantModule,
} from '../../src/business-rules/invariants/index';
import { isActorRoleId } from '../../src/actors/index';
import { isRegisteredRequirementId } from '../../src/requirements/index';
import { hasState } from '../../src/states/index';

/**
 * Guards for the Business Invariant Model (master plan §7).
 *
 * The model's whole value is that a rule cannot claim to be covered without naming the evidence, so
 * most of these check the CLAIMS rather than the mechanics: a `VERIFIED` rule must name a spec that
 * exists on disk, every requirement id must be one the Requirement Source Registry knows, every
 * actor must be a role the actor model defines, and every conflict must survive.
 *
 * They also pin the architectural boundary: the invariant layer must not import the validation
 * engine, the validators or the Bugzilla pipeline. An invariant that depended on the machinery meant
 * to verify it could not be used to judge that machinery.
 */

const INVARIANT_DIR = path.join(ROOT_DIR, 'src', 'business-rules', 'invariants');

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (entry.name.endsWith('.ts')) out.push(full);
  }
  return out;
}

/** Source with comments stripped, so a guard matches code and never its own explanatory prose. */
function code(file: string): string {
  return readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** The leading repository path of a `verifiedBy` note, which may carry a trailing explanation. */
function specPath(verifiedBy: string): string | undefined {
  const match = /^([\w./-]+\.(?:spec\.)?ts)/.exec(verifiedBy.trim());
  return match?.[1];
}

test.describe('business invariants: the model is internally valid @framework', () => {
  test('every invariant passes the model validator against the real vocabularies', () => {
    const problems = validateInvariants(BUSINESS_INVARIANTS, {
      isKnownRequirement: isRegisteredRequirementId,
      isKnownActor: isActorRoleId,
      isKnownState: hasState,
      isKnownEndpoint: (id) => apiRegistry.has(id),
    });
    expect(
      problems.map((problem) => `${problem.code} · ${problem.invariantId} · ${problem.detail}`),
      'a declared rule that cites an unknown requirement, actor, state or endpoint credits coverage it does not have',
    ).toEqual([]);
  });

  test('the catalogue is not empty and covers every module it declares', () => {
    const summary = invariantSummary();
    expect(summary.total, 'the catalogue was loaded').toBeGreaterThan(30);
    const modules: InvariantModule[] = [
      'signup-login',
      'katchup',
      'group',
      'kall',
      'kmail',
      'kdirectory',
      'admin',
      'cross-cutting',
    ];
    const empty = modules.filter((module) => invariantsOf(module).length === 0);
    expect(empty, 'a declared module with no rules is a section nobody filled in').toEqual([]);
  });

  test('every id is unique and shaped like a documented rule id', () => {
    const ids = BUSINESS_INVARIANTS.map((entry) => entry.invariantId);
    expect(new Set(ids).size, 'ids are unique').toBe(ids.length);
    const odd = ids.filter((id) => !/^(BR|FR|NFR)-[A-Z0-9-]+$/.test(id));
    expect(odd, 'an invariant id comes from a document, never from a test name').toEqual([]);
  });
});

test.describe('business invariants: a claim must carry its evidence @framework', () => {
  test('every VERIFIED or PARTIAL rule names a spec that actually exists', () => {
    /*
     * This is the guard the model exists for. The discovery phases found the repository crediting
     * itself with coverage it did not have — a mail SEND tagged as satisfying "read receipts" — and
     * that was possible because nothing forced the claim to point at something checkable.
     */
    const claimed = BUSINESS_INVARIANTS.filter(
      (entry) => entry.status === 'VERIFIED' || entry.status === 'PARTIAL',
    );
    expect(claimed.length, 'some rules do claim coverage').toBeGreaterThan(5);

    const missing = claimed
      .map((entry) => ({ entry, file: specPath(entry.verifiedBy ?? '') }))
      .filter(({ file }) => !file || !existsSync(path.join(ROOT_DIR, file)))
      .map(({ entry }) => `${entry.invariantId} → ${entry.verifiedBy ?? '(nothing)'}`);
    expect(
      missing,
      'a rule claiming coverage must point at a spec on disk, not at a description',
    ).toEqual([]);
  });

  test('no rule is credited to an endpoint tag or a requirement id alone', () => {
    // `appliesTo` holds endpoint IDS (validated above) or a named UI action. A bare requirement id
    // there would be the exact over-crediting the plan forbids: a requirement is not an action.
    const suspect = BUSINESS_INVARIANTS.flatMap((entry) =>
      entry.appliesTo
        .filter((target) => /^(FR|NFR|BR)-/.test(target))
        .map((target) => `${entry.invariantId} → ${target}`),
    );
    expect(suspect, 'a requirement id is not something a rule can be applied to').toEqual([]);
  });

  test('every documented conflict survives in the model', () => {
    const conflicted = conflictedInvariants().map((entry) => entry.invariantId);
    // The three the repository already carries, each recorded before this phase existed.
    for (const id of ['BR-C01', 'FR-GM-014', 'BR-SL-ACTIVATE']) {
      expect(conflicted, `${id} carries an unresolved conflict and must keep it`).toContain(id);
    }
    const unexplained = conflictedInvariants()
      .filter((entry) => (entry.conflict ?? '').length < 60)
      .map((entry) => entry.invariantId);
    expect(unexplained, 'a conflict must state both positions, not merely flag one').toEqual([]);
  });
});

test.describe('business invariants: architectural boundary @framework', () => {
  test('the invariant layer imports no engine, validator or Bugzilla module', () => {
    /*
     * Declarative only. `../business-rule.ts` beside it is the EXECUTABLE rule and does import the
     * engine — that file is untouched, and this boundary is what keeps the two from merging.
     */
    const offenders = sourceFiles(INVARIANT_DIR).flatMap((file) => {
      const source = code(file);
      return [...source.matchAll(/from\s*'([^']+)'/g)]
        .map((match) => match[1] as string)
        .filter((specifier) => /@engine\/|@validators\/|bug-tracker|@reporting\//.test(specifier))
        .map((specifier) => `${path.basename(file)} → ${specifier}`);
    });
    expect(
      offenders,
      'an invariant that depends on the machinery meant to verify it cannot judge that machinery',
    ).toEqual([]);
  });

  test('the layer declares no executable check', () => {
    // No `check()`, no expected status code, no verdict. Driving a rule is Phase 6/7's job.
    const offenders = sourceFiles(INVARIANT_DIR)
      .filter((file) =>
        /\bcheck\s*\(|ValidationOutcome|ValidationContext|expectedStatus/.test(code(file)),
      )
      .map((file) => path.basename(file));
    expect(offenders, 'the model states rules; it does not run them').toEqual([]);
  });
});

test.describe('business invariants: the catalogue and the document agree @framework', () => {
  test('every rule id in docs/business-rules.md is declared in the registry', () => {
    /*
     * The document stays the human-readable source narrative; the registry is what code reads. The
     * one direction that must hold is that the document cannot name a rule the registry lacks —
     * otherwise a reader would believe a rule is modelled when nothing knows about it.
     */
    const doc = readFileSync(path.join(ROOT_DIR, 'docs', 'business-rules.md'), 'utf8');
    const declared = new Set(BUSINESS_INVARIANTS.map((entry) => entry.invariantId));
    // Ids appear in the tables as **BOLD**, which is what distinguishes a rule id from a prose
    // mention of a requirement id such as FR-KU-017 inside a sentence.
    const mentioned = [...doc.matchAll(/\*\*((?:BR|FR|NFR)-[A-Z0-9-]+)/g)].map(
      (match) => match[1] as string,
    );
    expect(mentioned.length, 'the document was parsed').toBeGreaterThan(20);
    const undeclared = [...new Set(mentioned)].filter((id) => !declared.has(id)).sort();
    expect(
      undeclared,
      'docs/business-rules.md names a rule the invariant registry does not declare',
    ).toEqual([]);
  });
});

test.describe('business invariants: generated report @framework', () => {
  test('writes docs/BUSINESS-INVARIANTS.md', () => {
    const summary = invariantSummary();
    const row = (entry: BusinessInvariant): string =>
      `| \`${entry.invariantId}\` | ${entry.statement} | ${entry.actors.join(', ') || '—'} | ` +
      `${entry.evidence.join(', ')} | ${entry.status} | ` +
      `${entry.verifiedBy ?? entry.gap ?? '—'} |`;

    const modules: InvariantModule[] = [
      'signup-login',
      'katchup',
      'group',
      'kall',
      'kmail',
      'kdirectory',
      'admin',
      'cross-cutting',
    ];

    const lines: string[] = [
      '# Business invariants — what the product must do, and how well we show it',
      '',
      '**GENERATED — do not edit.** Written by `tests/framework/business-invariants.spec.ts`',
      '(`npm run test:framework`) from `src/business-rules/invariants/`.',
      '',
      '`docs/business-rules.md` remains the source narrative — where each rule comes from and why.',
      'This is the measured view: the same rules, with the evidence each one actually has today.',
      '',
      '**Status is not importance.** `VERIFIED` means a named spec asserts the rule against a',
      'response or a read-back state; it does NOT mean the application obeys it. `BR-C01` is',
      'VERIFIED and is believed to be violated on live — that is the point of the layer.',
      '',
      '| | Count |',
      '| - | ----: |',
      `| Declared invariants | **${String(summary.total)}** |`,
      `| — VERIFIED (a spec asserts it) | ${String(summary.byStatus.VERIFIED)} |`,
      `| — PARTIAL (something asserted, gap recorded) | ${String(summary.byStatus.PARTIAL)} |`,
      `| — TO_DO | ${String(summary.byStatus.TO_DO)} |`,
      `| — OUT_OF_SCOPE (reason recorded) | ${String(summary.byStatus.OUT_OF_SCOPE)} |`,
      `| Carrying an unresolved conflict | ${String(summary.conflicted)} |`,
      '',
      '## Unresolved conflicts',
      '',
      'Preserved, never resolved by this layer.',
      '',
      '| Rule | Conflict |',
      '| ---- | -------- |',
      ...conflictedInvariants().map(
        (entry) => `| \`${entry.invariantId}\` | ${entry.conflict ?? ''} |`,
      ),
      '',
      ...modules.flatMap((module) => [
        `## ${module}`,
        '',
        '| Rule | Statement | Actors | Evidence needed | Status | Spec / gap |',
        '| ---- | --------- | ------ | --------------- | ------ | ---------- |',
        ...invariantsOf(module).map(row),
        '',
      ]),
    ];
    writeFileSync(path.join(ROOT_DIR, 'docs', 'BUSINESS-INVARIANTS.md'), lines.join('\n'));
    expect(summary.total).toBeGreaterThan(30);
  });
});
