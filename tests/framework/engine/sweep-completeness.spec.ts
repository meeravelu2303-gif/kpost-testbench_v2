import { apiRegistry } from '@api/definitions/index';
import type { EndpointFilter } from '@api/registry/api-registry';
import { DEFAULT_SUITE } from '@config/ownership.config';
import { ENDPOINT_GROUPS } from '@engine/endpoint-groups';
import { expect, test } from '@fixtures';

/**
 * Every KPost API endpoint must be reached by the generic sweep, or be on the list below with a reason.
 * The sweeps are read from ENDPOINT_GROUPS, the one list every type folder's engine spec runs.
 */

/** Endpoints a sweep deliberately does not reach, each with the reason. Keep it short and honest. */
const SWEEP_EXEMPT: Readonly<Record<string, string>> = {
  'kbooking-update-city-list':
    'refreshes the shared RedBus city list for every user (sideEffect global); never run on live, contract-checked only',
  'common-validate-otp': 'consumes a one-time code; covered by the OTP lifecycle flow',
  'common-validate-mail-otp': 'consumes a one-time code; covered by the OTP lifecycle flow',
  'signup-login-user-logout':
    'ends the session the sweep itself runs on; covered by the login flow',
  'kbooking-block-ticket':
    'a successful call holds a seat at the external booking partner, a real outside side effect',
};

/** The paused KDoc/KOS module: excluded from every command until the owner says it is ready. */
const PAUSED_TAG_PREFIX = 'kos-';

/** Every engine sweep, from the one place they are declared (the type folders' specs only name a module). */
function sweepFilters(): EndpointFilter[] {
  return Object.values(ENDPOINT_GROUPS).flatMap((modules) =>
    Object.values(modules).flatMap((groups) => groups.map((group) => group.filter)),
  );
}

test.describe('generic sweep completeness @framework', () => {
  const kpostEndpoints = () => apiRegistry.find({ suites: [DEFAULT_SUITE] });
  const isPaused = (tags: readonly string[] | undefined) =>
    (tags ?? []).some((tag) => tag.startsWith(PAUSED_TAG_PREFIX));

  test('the wrapper files are discoverable', () => {
    expect(
      sweepFilters().length,
      'endpoint groups declared in src/validation-engine/endpoint-groups.ts',
    ).toBeGreaterThan(20);
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
      'endpoints no sweep selects: add a tag to a group in src/validation-engine/endpoint-groups.ts, or an entry with a reason to SWEEP_EXEMPT',
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
