import { apiRegistry } from '@api/definitions/index';
import type { EndpointDefinition } from '@api/registry/endpoint-definition';
import {
  FR_IDS,
  LEGACY_REQUIREMENTS,
  isCurrentFr,
  isKnownRequirement,
} from '@config/frd-requirements';
import { expect, test } from '@fixtures';

/**
 * FRD traceability — the answer to "does every `requirements` tag name a real FR, and how far has the
 * migration to the six per-module FRDs (CLAUDE.md §4/§8) got?".
 *
 * (1) Every requirement id on every registered endpoint must be a known id — a current `FR-xx-NNN`,
 *     an NFR, or a still-pending legacy id (`LEGACY_REQUIREMENTS`). An unknown id fails the build, so
 *     a typo or an invented FR cannot slip in.
 * (2) `LEGACY_REQUIREMENTS` must not name an id no definition uses any more — the list stays honest
 *     and visibly shrinks as modules are migrated; a stale entry fails, forcing it to be removed.
 * The `docs/requirements-frd.md` FR→coverage map is the human-readable companion to this guard.
 */
test.describe('requirements traceability @framework', () => {
  const endpoints = apiRegistry.all().filter((d: EndpointDefinition) => !d.mockFixture);

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
