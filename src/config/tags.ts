/**
 * Every tag string in the bench; `lint:tags` rejects any other. Kept pure (no Node built-ins) so
 * plain Node can import it. Admin has no module tag: it joins sanity and smoke only through
 * `TAGS.admin`.
 */
export const TAGS = {
  // --- Run levels (how deep / when) ---
  /** Build-acceptance gate: broad + shallow, 1-3 per in-scope module per suite. */
  smoke: '@smoke',
  /** Post-deploy / post-fix verification; `--module`/`--bug` narrow it to one area. */
  sanity: '@sanity',
  /**
   * A sweep-generated sanity test; exempt from the sanity budget and accepted in place of
   * `@regression`.
   */
  sanitySweep: '@sanity-sweep',
  /**
   * Selects Admin tests into sanity and smoke (own runner stages); never alongside `@smoke` or
   * `@regression`.
   */
  admin: '@admin',
  /** The full stable suite (smoke and sanity are subsets, so they carry this too). */
  regression: '@regression',

  /** An end-to-end user journey across modules and accounts (`tests/e2e/journeys/`). */
  journey: '@journey',

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
 * Finer feature/area sub-tags (not modules or run levels), registered so `lint:tags` accepts them.
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
