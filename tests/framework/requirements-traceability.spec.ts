import { apiRegistry } from '@api/definitions/index';
import {
  FR_IDS,
  LEGACY_REQUIREMENTS,
  isCurrentFr,
  isKnownRequirement,
} from '@config/frd-requirements';
import { expect, test } from '@fixtures';

/**
 * Every endpoint's requirement ids must be known (`FR-xx-NNN`, NFR, or `LEGACY_REQUIREMENTS`), and the
 * legacy list must not keep ids nothing uses. Human-readable map: docs/reference/requirements-frd.md.
 */
test.describe('requirements traceability @framework', () => {
  const endpoints = apiRegistry.all();

  test('every requirement id on every endpoint is a known FR / NFR / pending-legacy id', () => {
    const unknown: string[] = [];
    for (const ep of endpoints) {
      for (const id of ep.requirements ?? []) {
        if (!isKnownRequirement(id)) unknown.push(`${ep.id} → ${id}`);
      }
    }
    expect(
      unknown,
      `unknown requirement ids (add to the FRD scheme or fix the tag):\n${unknown.join('\n')}`,
    ).toEqual([]);
  });

  test('the legacy-requirements list is honest — no entry is unused', () => {
    const used = new Set(endpoints.flatMap((ep) => ep.requirements ?? []));
    const stale = LEGACY_REQUIREMENTS.filter((id) => !used.has(id));
    expect(
      stale,
      `LEGACY_REQUIREMENTS names ids no definition uses any more — remove them:\n${stale.join('\n')}`,
    ).toEqual([]);
  });

  test('report FR coverage (migrated vs pending)', () => {
    const used = new Set(endpoints.flatMap((ep) => ep.requirements ?? []));
    const currentFrsReferenced = [...used].filter(isCurrentFr).sort();
    const legacyStillUsed = [...used].filter((id) => LEGACY_REQUIREMENTS.includes(id)).sort();
    // Informational — a stable record in the run log, not an assertion that can flake.
    console.log(
      `FRD traceability: ${currentFrsReferenced.length}/${FR_IDS.length} current FR ids referenced by definitions; ` +
        `${legacyStillUsed.length} legacy id(s) still pending migration: ${legacyStillUsed.join(', ') || '—'}`,
    );
    expect(currentFrsReferenced.length).toBeGreaterThan(0);
  });
});
