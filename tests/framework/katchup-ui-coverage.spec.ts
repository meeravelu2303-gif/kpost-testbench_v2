/* eslint-disable playwright/no-conditional-in-test */
// Reconciles the Katchup feature catalogue and generates a doc — the "conditionals" are classification.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT_DIR } from '@config/constants';
import { KATCHUP_FEATURES, KATCHUP_REQUIREMENTS } from '@ui/katchup-features';
import { expect, test } from '@fixtures';

/**
 * Katchup UI coverage — makes "every Katchup feature is covered, nothing missed" **measurable**, the
 * front-end analogue of the API coverage ledger. It reconciles the feature catalogue
 * (`src/ui/katchup-features.ts`, enumerated from the FRD + the message-type enum + the frontend action
 * menus) and FAILS the build if:
 *   - a feature has no status,
 *   - a `built` feature names a spec that does not exist on disk,
 *   - a non-`built` feature has no reason,
 *   - any FR-K / BR-K / NFR the FRD defines for Katchup is represented by no feature.
 *
 * It also writes `docs/KATCHUP-UI-COVERAGE.md` so the picture is legible without reading code.
 */
test.describe('Katchup UI coverage @framework', () => {
  test('every Katchup feature is classified, specced or blocked-with-reason, and every FR is covered', () => {
    const e2eDir = path.join(ROOT_DIR, 'tests', 'e2e');

    const missingReason: string[] = [];
    const missingSpec: string[] = [];
    for (const f of KATCHUP_FEATURES) {
      if (f.status === 'built') {
        if (!f.spec) missingSpec.push(`${f.id}: built but names no spec`);
        else if (!fs.existsSync(path.join(e2eDir, f.spec))) {
          missingSpec.push(`${f.id}: spec ${f.spec} not found`);
        }
      } else if (!f.reason) {
        missingReason.push(`${f.id}: status ${f.status} but no reason`);
      }
    }

    // Every requirement the FRD defines for Katchup must map to at least one feature.
    const covered = new Set(KATCHUP_FEATURES.flatMap((f) => f.fr));
    const uncoveredReqs = KATCHUP_REQUIREMENTS.filter((r) => !covered.has(r));

    // Tally by status, for the report.
    const byStatus = new Map<string, number>();
    for (const f of KATCHUP_FEATURES) byStatus.set(f.status, (byStatus.get(f.status) ?? 0) + 1);

    const built = byStatus.get('built') ?? 0;
    const lines: string[] = [
      '# Katchup UI coverage — every feature, measured',
      '',
      '**GENERATED — do not edit.** Written by `tests/framework/katchup-ui-coverage.spec.ts`.',
      'Reconciles `src/ui/katchup-features.ts` (enumerated from the FRD, the `katchupMessageType` enum,',
      'and the frontend action menus) so a Katchup feature cannot be silently missed.',
      '',
      `**${KATCHUP_FEATURES.length}** features · **${built} built** · ` +
        [...byStatus.entries()]
          .filter(([s]) => s !== 'built')
          .map(([s, n]) => `${n} ${s}`)
          .join(' · '),
      '',
      '| Feature | FR | msgType | Category | Status | Spec / reason |',
      '| ------- | -- | ------: | -------- | ------ | ------------- |',
      ...KATCHUP_FEATURES.map(
        (f) =>
          `| ${f.name} | ${f.fr.join(', ')} | ${f.messageType ?? ''} | ${f.category} | ${f.status} | ${
            f.status === 'built' ? `\`${f.spec}\`` : f.reason
          } |`,
      ),
      '',
      '## Requirement traceability',
      '',
      `Every Katchup FR/BR/NFR the FRD defines maps to ≥1 feature. Requirements: **${KATCHUP_REQUIREMENTS.length}**, uncovered: **${uncoveredReqs.length}**.`,
      '',
    ];
    const outPath = path.join(ROOT_DIR, 'docs', 'KATCHUP-UI-COVERAGE.md');
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, `${lines.join('\n')}\n`);

    // The hard guarantees.
    expect(missingSpec, 'built features whose spec is missing').toEqual([]);
    expect(missingReason, 'non-built features missing a reason').toEqual([]);
    expect(uncoveredReqs, 'Katchup requirements represented by no UI feature').toEqual([]);
    expect(
      KATCHUP_FEATURES.length,
      'the catalogue must enumerate the full feature set',
    ).toBeGreaterThan(25);
  });
});
