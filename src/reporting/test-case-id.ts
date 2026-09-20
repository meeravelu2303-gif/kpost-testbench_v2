import { createHash } from 'node:crypto';

/**
 * The stable identity of a TEST CASE — what is checked, not what happened when it ran.
 *
 * Phase 2 §17.2. The bench already had three identities and none of them answered "is this the same
 * check as last week?":
 *
 * | Identity            | Answers                                   | Lives in                    |
 * | ------------------- | ----------------------------------------- | --------------------------- |
 * | `validationId`      | which EXECUTION produced this result      | a random UUID per result    |
 * | `[KP-XXXXXX]` tag   | which DEFECT was found                    | the Bugzilla summary        |
 * | correlation id      | which HTTP exchange                       | request/response headers    |
 * | **`TC-…`** (here)   | which CHECK, across runs/machines/profiles| reports and case registries |
 *
 * They stay separate on purpose. A test-case id is not a defect id: one check can find different
 * defects over time, and one defect (a platform-wide header fault) is found by hundreds of checks.
 *
 * ## What identity is made of — and what it deliberately is not
 *
 * IN: the suite, the endpoint and the validator (generated API cases); the spec file and the test's
 * title path (hand-written specs). All of it is the test DEFINITION, and all of it lives in the
 * repository.
 *
 * OUT, deliberately: run id, worker/parallel index, browser project, run profile, machine, host URL,
 * timestamps, account ids, credentials and every result value. The same check executed on Chromium
 * and WebKit, under `kpost` and `kpost-deep`, on a laptop and in CI, is ONE test case.
 *
 * Excluding the browser follows the identity rule the bench already applies to defects:
 * `uiFingerprint` excludes the browser project so one fault across three engines is one ticket
 * (`src/bug-tracker/bug-fingerprint.ts`). A per-browser test-case id would contradict it.
 *
 * ## Relationship to the Bugzilla fingerprint — a hard boundary
 *
 * A test-case id NEVER enters a bug summary, a fingerprint input or the `(endpoint, validator)`
 * fault index. Dedupe, adoption and auto-resolve all key off those, so a summary change would orphan
 * every open ticket and re-file it as new. This module is additive identity for REPORTS only.
 */

/** The one stable-id prefix. There is deliberately no second convention. */
export const TEST_CASE_ID_PREFIX = 'TC';

/** Long enough to stay readable in a report, short enough for a CI log line. */
const MAX_ID_CHARS = 100;

/** Identity of one engine-generated API case: suite + endpoint + validator. */
export interface ApiCaseIdentity {
  suiteId: string;
  endpointId: string;
  validatorName: string;
}

/** Identity of a hand-written Playwright test: its spec file + its title path. */
export interface SpecCaseIdentity {
  /** Repo-relative path, e.g. `tests/e2e/screens.spec.ts`. Separators are normalised. */
  specFile: string;
  /** describe/test titles, outermost first. The Playwright PROJECT must not be included. */
  titlePath: readonly string[];
}

const digest6 = (key: string): string =>
  createHash('sha1').update(key).digest('hex').slice(0, 6).toUpperCase();

/** Lower-cases and strips anything that would make an id awkward in a log, path or CSV cell. */
function slug(value: string): string {
  return value
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Keeps an id readable AND unique: when the readable form would be unwieldy it is truncated and a
 * digest of the FULL identity is appended, so two long ids can never collapse into one.
 */
function bounded(readable: string, canonicalKey: string): string {
  if (readable.length <= MAX_ID_CHARS) return readable;
  return `${readable.slice(0, MAX_ID_CHARS - 7)}-${digest6(canonicalKey)}`;
}

/** The surface a spec belongs to, from its path — never from the Playwright project. */
export function surfaceOf(specFile: string): string {
  const posix = specFile.replace(/\\/g, '/');
  if (posix.includes('tests/e2e-admin/')) return 'ADMINUI';
  if (posix.includes('tests/e2e/')) return 'UI';
  if (posix.includes('tests/api/')) return 'API';
  if (posix.includes('tests/framework/')) return 'FW';
  if (posix.includes('tests/setup/')) return 'SETUP';
  if (posix.includes('tests/integration/')) return 'INT';
  return 'SPEC';
}

/** The canonical identity string that is hashed/compared. Never rendered as the id itself. */
export function apiIdentityKey(identity: ApiCaseIdentity): string {
  return `api|${identity.suiteId}|${identity.endpointId}|${identity.validatorName}`;
}

export function specIdentityKey(identity: SpecCaseIdentity): string {
  const file = identity.specFile.replace(/\\/g, '/');
  return `spec|${file}|${identity.titlePath.join(' > ')}`;
}

/**
 * `TC-API-<suite>-<endpoint>-<validator>` — e.g.
 * `TC-API-kpost-api-common-languages-response.status-code`.
 *
 * Readable on purpose: the id says which endpoint and which check, so a report row needs no lookup
 * table. It changes only when the endpoint id or the validator name changes — both of which are
 * deliberate, reviewable edits in the repository.
 */
export function apiTestCaseId(identity: ApiCaseIdentity): string {
  const readable = [
    TEST_CASE_ID_PREFIX,
    'API',
    slug(identity.suiteId),
    slug(identity.endpointId),
    slug(identity.validatorName),
  ].join('-');
  return bounded(readable, apiIdentityKey(identity));
}

/**
 * `TC-<SURFACE>-<spec>-<slug of the titles>-<hash6>` — e.g.
 * `TC-UI-screens-katchup-renders-every-key-control-9F2A41`.
 *
 * Hand-written tests need no manual id: the identity is the spec plus the title path, which the
 * author already wrote. The trailing digest of the FULL title path keeps ids unique when two titles
 * slug to the same text, and keeps the readable part short.
 *
 * Moving a test to another file, or renaming it, changes its id. That is intended and visible: it is
 * a new test definition as far as traceability is concerned. For a case where that must not happen,
 * `explicitTestCaseId` pins the id in the spec.
 */
export function specTestCaseId(identity: SpecCaseIdentity): string {
  const file = identity.specFile.replace(/\\/g, '/');
  const base = (file.split('/').pop() ?? file).replace(/\.(spec|setup)\.ts$/i, '');
  const titles = identity.titlePath.filter(Boolean).join('-');
  const readable = [TEST_CASE_ID_PREFIX, surfaceOf(file), slug(base), slug(titles)]
    .filter(Boolean)
    .join('-');
  const key = specIdentityKey(identity);
  return bounded(`${readable}-${digest6(key)}`, key);
}

/**
 * An id pinned by hand, for the rare case where a derived id must survive a rename or a file move.
 * Validated so a typo cannot introduce a second convention or a duplicate-looking id.
 */
export function explicitTestCaseId(id: string): string {
  if (!/^TC-[A-Z0-9][A-Z0-9._-]*$/i.test(id)) {
    throw new Error(
      `Invalid explicit test-case id "${id}". It must start with "${TEST_CASE_ID_PREFIX}-" and ` +
        'contain only letters, digits, dot, dash or underscore.',
    );
  }
  return id;
}

/** The Playwright annotation a spec (or the case generator) uses to carry its id. */
export const TEST_CASE_ID_ANNOTATION = 'test-case-id';

export interface RegisteredCase {
  id: string;
  /** The canonical identity this id was derived from (`apiIdentityKey` / `specIdentityKey`). */
  identityKey: string;
  /** Where it came from, for the collision message: a spec path or an endpoint id. */
  source: string;
}

export interface TestCaseIdCollision {
  id: string;
  conflicting: { identityKey: string; source: string }[];
}

/**
 * Two DIFFERENT definitions sharing one id, which would silently merge two cases in every report.
 * The same definition registered twice (an endpoint's case seen in two reports) is not a collision.
 */
export function detectCollisions(cases: readonly RegisteredCase[]): TestCaseIdCollision[] {
  const byId = new Map<string, Map<string, string>>();
  for (const entry of cases) {
    const identities = byId.get(entry.id) ?? new Map<string, string>();
    identities.set(entry.identityKey, entry.source);
    byId.set(entry.id, identities);
  }
  return [...byId.entries()]
    .filter(([, identities]) => identities.size > 1)
    .map(([id, identities]) => ({
      id,
      conflicting: [...identities.entries()].map(([identityKey, source]) => ({
        identityKey,
        source,
      })),
    }));
}

/**
 * Fails loudly, naming BOTH sides. Never picks a winner: a collision means two checks would be
 * reported as one, and the only correct response is to stop and rename one of them.
 */
export function assertNoCollisions(cases: readonly RegisteredCase[]): void {
  const collisions = detectCollisions(cases);
  if (!collisions.length) return;
  const detail = collisions
    .map(
      (collision) =>
        `  ${collision.id}\n` +
        collision.conflicting.map((c) => `    ← ${c.source}  [${c.identityKey}]`).join('\n'),
    )
    .join('\n');
  throw new Error(
    `${collisions.length} stable test-case id collision(s) — two different test definitions would ` +
      `be reported as one case:\n${detail}\n` +
      'Rename one of the conflicting tests, or pin an explicit id with explicitTestCaseId().',
  );
}
