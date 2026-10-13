/**
 * The single source of truth for every tag string in the bench. Import from here (or via its
 * re-export from `./constants`) so a typo is impossible — `lint:tags` rejects any tag on a test that
 * is not a value in `TAGS` (plus the dynamic `@bug-<id>` form). See `docs/TEST-RUN-LEVELS.md`.
 *
 * This module is intentionally PURE (no Node built-ins, no `__dirname`) so the plain-Node run-level
 * runner and `lint:tags` can import it directly under Node's native TypeScript loader.
 *
 * Admin has NO module tag on purpose — Admin tests are out of scope for run levels and are excluded
 * at the runner/lint level, never selected by a tag.
 */
export const TAGS = {
  // --- Run levels (how deep / when) ---
  /** Build-acceptance gate: broad + shallow, 1-3 per in-scope module per suite. */
  smoke: '@smoke',
  /** Targeted post-fix verification, run one module or one bug at a time. */
  sanity: '@sanity',
  /** The full stable suite (smoke and sanity are subsets, so they carry this too). */
  regression: '@regression',

  // --- Layers (where) ---
  ui: '@ui',
  api: '@api',

  // --- Modules (which feature) — every in-scope test carries at least one ---
  auth: '@auth',
  katchup: '@katchup',
  kall: '@kall',
  kmail: '@kmail',
  profile: '@profile',
  settings: '@settings',
  contacts: '@contacts',
  home: '@home',
  group: '@group',
  /** Business company-admin self-service on the MAIN app (BUSINESS_S). NOT the out-of-scope kpostadmin SPA. */
  userManagement: '@user-management',
  /** The vertical / standalone products (KBooking, KNews, KCloud, KOS, KWord, KPoster, KDiary, …). */
  verticals: '@verticals',
  /** App-wide / cross-cutting journeys (shell, navigation, screen-health, a11y, i18n, resilience). */
  platform: '@platform',

  // --- Type / feature sub-tags (kept from existing specs; registered so lint:tags accepts them) ---
  security: '@security',
  database: '@database',
  /** Creates/modifies/deletes data. Excluded from smoke/sanity and from production (unless ALLOW_DESTRUCTIVE_TESTS). */
  destructive: '@destructive',
  /** Optional feature tag on Signup specs; `@auth` is their MODULE tag. Kept for existing scripts. */
  signup: '@signup',
  /** API product sub-tags (existing). */
  kpostApi: '@kpost-api',
  kmailApi: '@kmail-api',
  /** KOS/KDoc-family feature tag (grep-inverted out of default UI runs). */
  kos: '@kos',
  /** Maintenance-only checks (existing). */
  maintenance: '@maintenance',
  /** Flaky/broken, excluded from ALL run levels. Must carry a code comment with reason + date. */
  quarantine: '@quarantine',
} as const;

export type Tag = (typeof TAGS)[keyof typeof TAGS];

/**
 * Feature / area sub-tags that already exist across the bench (mostly on the API validation engine
 * and workflow specs). They are NOT module tags and NOT run levels — they're finer-grained selectors
 * a test may ALSO carry. Registered here so `lint:tags` accepts them (every tag must be known), while
 * new code should prefer a `TAGS.*` constant. Admin-only area tags (@admin-*, @workplace-*, @hr-*,
 * @role-posting*, @employee-*) are deliberately absent — Admin is out of scope and excluded by path/tag.
 */
export const FEATURE_TAGS: readonly string[] = [
  '@kmail-read',
  '@profile-read',
  '@signup-login',
  '@login',
  '@session',
  '@common',
  '@needs-id',
  '@concurrency',
  '@status',
  '@dashboard',
  '@draft',
  '@attachment',
  '@bulk',
  '@content',
  '@translate',
  '@thread',
  '@subject',
  '@badge',
  '@important',
  '@external',
  '@pii',
  '@aws',
  '@kdiary',
  '@kbooking',
  '@slow',
  '@critical',
];

/** The module tags — `lint:tags` requires every in-scope test to carry at least one of these. */
export const MODULE_TAGS = [
  TAGS.auth,
  TAGS.katchup,
  TAGS.kall,
  TAGS.kmail,
  TAGS.profile,
  TAGS.settings,
  TAGS.contacts,
  TAGS.home,
  TAGS.group,
  TAGS.userManagement,
  TAGS.verticals,
  TAGS.platform,
] as const;

/**
 * A `@bug-<BugzillaID>` tag for a test that verifies a fixed bug. Put the internal `[KP-xxxxxx]`
 * fingerprint in a code comment next to the tag for traceability (e.g. `// [KP-6F5E6B]`).
 */
export const bugTag = (bugzillaId: number): `@bug-${number}` => `@bug-${bugzillaId}`;

/** Static set of every valid non-dynamic tag, for `lint:tags`. `@bug-<n>` is validated separately. */
export const ALL_TAGS: ReadonlySet<string> = new Set([...Object.values(TAGS), ...FEATURE_TAGS]);

/** True for a valid tag: a registered constant, or the dynamic `@bug-<number>` form. */
export function isValidTag(tag: string): boolean {
  return ALL_TAGS.has(tag) || /^@bug-\d+$/.test(tag);
}
