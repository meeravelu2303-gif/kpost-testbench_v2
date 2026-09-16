/**
 * The canonical set of FRD requirement ids, from the six per-module FRDs in `D:\Kpost Documents`
 * (2026-09-16). Every `requirements` tag on an endpoint definition must name an id that exists here;
 * `tests/framework/requirements-traceability.spec.ts` enforces it and reports FR coverage.
 *
 * The old FullSuite scheme (`FR-S/K/C/M`, `BR-*`) was renumbered into per-module `FR-xx-NNN`. Legacy
 * ids still on some definitions are listed in `LEGACY_REQUIREMENTS` so the guard passes during the
 * migration while that set visibly shrinks to empty (CLAUDE.md §8, to-do item 3). The FR→coverage
 * map is `docs/requirements-frd.md`.
 */

/** Builds `PREFIX-001..PREFIX-NNN`. */
function range(prefix: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => `${prefix}-${String(i + 1).padStart(3, '0')}`);
}

/** Every functional-requirement id defined across the six module FRDs. */
export const FR_IDS: readonly string[] = [
  ...range('FR-SL', 32), // Signup & Login
  ...range('FR-KU', 57), // Katchup (compose, disappearing, sent/received actions)
  ...range('FR-GMSG', 12), // Katchup — Group Messaging (§8 of the Katchup FRD)
  ...range('FR-GC', 8), // Group — Creation
  ...range('FR-GM', 16), // Group — Management
  ...range('FR-KL', 9), // Kall
  ...range('FR-KM', 25), // KMail
  ...range('FR-KD', 6), // KDirectory
];

/** Non-functional ids the validators already map onto (CLAUDE.md §4). */
export const NFR_IDS: readonly string[] = [
  'NFR-SEC01',
  'NFR-SEC02',
  'NFR-SEC03',
  'NFR-R01',
  'NFR-R02',
  'NFR-P01',
];

/**
 * Legacy ids still present on definitions, pending migration to the per-module scheme. Each line is
 * a to-do; the guard fails if a tag names an id in NEITHER the current scheme nor this list, and
 * reports how many legacy ids remain so the migration is measurable. Migrated modules are removed
 * from here. (Kall was migrated first — its `FR-C*`/`BR-C01` ids are gone.)
 */
export const LEGACY_REQUIREMENTS: readonly string[] = [
  // These have NO clean equivalent in the new per-module scheme, so they stay tagged as-is rather
  // than be force-mapped (each is a genuine endpoint whose behaviour the new FRDs do not FR-trace):
  'FR-K07', // Katchup unread-count / read-receipt reads — no count/receipt FR in FR-KU-*
  'FR-M02', // KMail draft — drafts are not an FR in the 25-FR KMail scheme
  'FR-M07', // KMail delete — not FR-traced
  'FR-S05', // company-logo trio — not FR-traced (was a signup-era id)
  'FR-S11', // active-session / login-history / access-code — session mgmt has no FR-SL
  'FR-S12', // logout / logout-all — no FR-SL for logout
];

const KNOWN = new Set<string>([...FR_IDS, ...NFR_IDS, ...LEGACY_REQUIREMENTS]);

/** Whether a requirement id is recognised (current scheme, an NFR, or a pending legacy id). */
export function isKnownRequirement(id: string): boolean {
  return KNOWN.has(id);
}

/** Whether an id belongs to the current per-module scheme (i.e. not legacy, not an NFR). */
export function isCurrentFr(id: string): boolean {
  return FR_IDS.includes(id);
}
