import fs from 'node:fs';
import path from 'node:path';
import { apiRegistry } from '@api/definitions/index';
import type { EndpointFilter } from '@api/registry/api-registry';
import { ROOT_DIR } from '@config/constants';
import { DEFAULT_SUITE } from '@config/ownership.config';
import { expect, test } from '@fixtures';

/**
 * Every KPost API endpoint must be reached by the generic sweep (auth, input fuzz, injection, schema,
 * headers, errors, ...), or be on the short list below with a reason a reviewer can check.
 *
 * Why this exists: a 2026-10-09 audit found 55 live endpoints (Kall, Group, KDiary, Contacts,
 * Settings writes and a few more) that no sweep wrapper selected, so they only ever got one happy-path
 * lifecycle flow. Their input-validation and security bugs surfaced one run at a time, as each module
 * eventually got a wrapper, which is why every run seemed to produce new bugs. A new endpoint whose
 * tags no wrapper selects now fails here instead of staying silently uncovered.
 *
 * Wrappers are read from the spec files themselves, so the guard cannot drift from what runs.
 */

/** Endpoints a sweep deliberately does not reach, each with the reason. Keep it short and honest. */
const SWEEP_EXEMPT: Readonly<Record<string, string>> = {
  'common-validate-otp': 'consumes a one-time code; covered by the OTP lifecycle flow',
  'common-validate-mail-otp': 'consumes a one-time code; covered by the OTP lifecycle flow',
  'signup-login-user-logout':
    'ends the session the sweep itself runs on; covered by the login flow',
  'kbooking-block-ticket':
    'a successful call holds a seat at the external booking partner, a real outside side effect',
};

/** The paused KDoc/KOS module: excluded from every command until the owner says it is ready. */
const PAUSED_TAG_PREFIX = 'kos-';

/** KPost modules live under `kpost/`; the local mock-API samples are top-level `tests/api/*.spec.ts`. */
const API_TESTS_DIR = path.join(ROOT_DIR, 'tests', 'api');

function specFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return specFiles(full);
    return entry.name.endsWith('.spec.ts') ? [full] : [];
  });
}

function stringList(source: string, key: string): string[] | undefined {
  const match = new RegExp(`${key}:\\s*\\[([^\\]]*)\\]`).exec(source);
  if (!match) return undefined;
  return [...(match[1] ?? '').matchAll(/'([^']+)'/g)].map((m) => m[1] as string);
}

/** Every `describeEndpointCases` / `describeEndpointContracts` filter found in the wrapper files. */
function sweepFilters(): EndpointFilter[] {
  const filters: EndpointFilter[] = [];
  for (const file of specFiles(API_TESTS_DIR)) {
    const text = fs.readFileSync(file, 'utf8');
    for (const call of text.matchAll(
      /describeEndpoint(?:Cases|Contracts)\(\s*(\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\})/g,
    )) {
      const body = call[1] ?? '';
      const filter: EndpointFilter = {
        ...(stringList(body, 'tags') && { tags: stringList(body, 'tags') }),
        ...(stringList(body, 'excludeTags') && { excludeTags: stringList(body, 'excludeTags') }),
        ...(stringList(body, 'ids') && { ids: stringList(body, 'ids') }),
        ...(stringList(body, 'suites') && {
          suites: stringList(body, 'suites') as EndpointFilter['suites'],
        }),
      };
      filters.push(filter);
    }
  }
  return filters;
}

test.describe('generic sweep completeness @framework', () => {
  const kpostEndpoints = () => apiRegistry.find({ suites: [DEFAULT_SUITE] });
  const isPaused = (tags: readonly string[] | undefined) =>
    (tags ?? []).some((tag) => tag.startsWith(PAUSED_TAG_PREFIX));

  test('the wrapper files are discoverable', () => {
    expect(sweepFilters().length, 'sweep wrapper calls found under tests/api').toBeGreaterThan(20);
  });

  test('every KPost endpoint is reached by a sweep wrapper, or exempt with a reason', () => {
    const covered = new Set<string>();
    for (const filter of sweepFilters())
      for (const e of apiRegistry.find(filter)) covered.add(e.id);

    const unreached = kpostEndpoints()
      .filter((e) => !covered.has(e.id) && !isPaused(e.tags) && !(e.id in SWEEP_EXEMPT))
      .map((e) => `${e.id} (${e.method} ${e.path}; tags: ${(e.tags ?? []).join(', ') || 'none'})`);

    expect(
      unreached,
      'endpoints no sweep wrapper selects: add a tag to a wrapper under tests/api, or an entry with a reason to SWEEP_EXEMPT',
    ).toEqual([]);
  });

  test('every exemption is still real: the endpoint exists and no wrapper reaches it', () => {
    const covered = new Set<string>();
    for (const filter of sweepFilters())
      for (const e of apiRegistry.find(filter)) covered.add(e.id);
    const known = new Set(kpostEndpoints().map((e) => e.id));

    const stale = Object.keys(SWEEP_EXEMPT).filter((id) => !known.has(id) || covered.has(id));
    expect(stale, 'SWEEP_EXEMPT entries that no longer name an uncovered endpoint').toEqual([]);
  });
});
