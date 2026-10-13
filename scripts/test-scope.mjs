// Shared "what is an in-scope run-level test" filter — the SINGLE definition used by both
// `lint:tags` (to compute the in-scope set) and `run-level.mjs` (to build its grep exclusions), so
// the two can never disagree on which tests count. Admin and the bench's own @framework self-tests
// are out of scope and never selected by any run level.
//
// Playwright reports spec paths relative to the top-level testDir (./tests), e.g. "e2e/foo.spec.ts",
// "api/kpost/...", "framework/...", "e2e-admin/...". Match on those.

const norm = (f) => String(f).replace(/\\/g, '/');

/** Admin (out of scope) by path: tests/e2e-admin, any /admin/ dir, or an `admin-`/`admin.` spec. */
export const isAdminPath = (file) => /e2e-admin|\/admin\/|(^|\/)admin[-.]/.test(norm(file));

/** Admin by tag: @admin*, or the admin-only area tags that ride shared generators. */
export const isAdminTags = (tags) =>
  tags.some((t) => /^@admin|workplace|hr-tier|employee|role-posting/i.test(t));

/** Bench self-tests (not KPOST): tests/framework/* and the *.setup.ts auth projects. */
export const isMetaPath = (file) => /\.setup\.ts$|(^|\/)framework\//.test(norm(file));

/** Bench self-tests by tag: the API contract/coverage engine meta-tests. */
export const isMetaTags = (tags) => tags.includes('@framework');

/** 'ui' for the e2e suite, 'api' otherwise. */
export const suiteOf = (file) => (/(^|\/)e2e\//.test(norm(file)) ? 'ui' : 'api');

/** Normalise Playwright's `tags` (it drops the leading @) and de-dupe. */
export const normalizeTags = (tags) => [
  ...new Set((tags || []).map((t) => (t.startsWith('@') ? t : `@${t}`))),
];

/** True when a test is an in-scope run-level test (not admin, not a bench self-test). */
export const isInScope = (file, tags) =>
  !isMetaPath(file) && !isMetaTags(tags) && !isAdminPath(file) && !isAdminTags(tags);

/** The run levels; a run-level tag on an admin/meta test is a leak. */
export const RUN_LEVELS = ['@smoke', '@sanity', '@regression'];
