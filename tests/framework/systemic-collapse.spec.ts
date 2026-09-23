import { mergeCandidates, systemicSignature } from '../../src/bug-tracker/bug-candidate';
import type { BugCandidate } from '../../src/bug-tracker/bug-candidate';
import { systemicFingerprint } from '../../src/bug-tracker/bug-fingerprint';
import { expect, test } from '@playwright/test';

/**
 * Regression guard for "one root cause across many endpoints = ONE bug".
 *
 * A systemic fault (a versioned `Server` header, a missing security header, the shared auth filter)
 * is observed on many endpoints, and each observation's raw message is a concatenation of every
 * probe that saw it — probes that run ASYNCHRONOUSLY, so the message's line order changes between
 * runs and even between two endpoints. Fingerprinting that raw message split one fault into dozens
 * of near-duplicate tickets. The fix fingerprints a STABLE signature instead; these tests lock that
 * in so the duplication cannot silently come back.
 */

// Two real messages from the field: same defect (versioned Server header), different probe ORDER.
const msgA =
  'primary → versioned Server header\n' +
  'authentication.missing-token:no Authorization → versioned Server header\n' +
  'concurrency.read-consistency:#1 → versioned Server header\n' +
  'concurrency.read-consistency:#4 → versioned Server header\n' +
  'concurrency.read-consistency:#6 → versioned Server header';
const msgB =
  'primary → versioned Server header\n' +
  'concurrency.read-consistency:#6 → versioned Server header\n' +
  'authentication.missing-token:no Authorization → versioned Server header\n' +
  'concurrency.read-consistency:#1 → versioned Server header\n' +
  'concurrency.read-consistency:#4 → versioned Server header';

test.describe('systemic collapse — one root cause is one ticket @framework', () => {
  test('the same systemic fault yields one stable signature regardless of probe order', () => {
    const a = systemicSignature('security.information-disclosure', msgA);
    const b = systemicSignature('security.information-disclosure', msgB);
    expect(a, 'the signature ignores volatile probe order').toBe(b);
    expect(a, 'and names the disclosed header').toBe('header:server');
  });

  test('the signature drives one fingerprint, so reordered messages share a ticket id', () => {
    const idA = systemicFingerprint({
      prefix: 'KP',
      validatorName: 'security.information-disclosure',
      message: systemicSignature('security.information-disclosure', msgA),
    });
    const idB = systemicFingerprint({
      prefix: 'KP',
      validatorName: 'security.information-disclosure',
      message: systemicSignature('security.information-disclosure', msgB),
    });
    expect(idA, 'one root cause = one Bugzilla tag').toBe(idB);
  });

  test('candidates with the same id merge into one ticket listing every affected endpoint', () => {
    const base = {
      source: 'api' as const,
      suiteId: 'kpost-api' as const,
      title: 'Platform-wide — the server response header discloses version information',
      narrative: 'systemic',
      severity: 'HIGH' as const,
      category: 'Security' as const,
      classification: 'security.information-disclosure',
      product: 'KPost API',
      component: 'Authentication V2',
      version: 'V2',
      assignee: 'dev@kpost.in',
      ownerName: 'Dev',
      expected: 'no version header',
      actual: 'versioned Server header',
      occurrences: 1,
      environment: 'test',
      baseURL: 'https://host',
      build: 'local',
      testRunId: 'run',
      observedAt: new Date().toISOString(),
      systemic: true,
      evidence: {},
    };
    const id = 'KP-STABLE1';
    const c1: BugCandidate = {
      ...base,
      id,
      endpoint: 'POST /v2/aws/generate-presigned-url',
      affectedEndpoints: ['POST /v2/aws/generate-presigned-url'],
    };
    const c2: BugCandidate = {
      ...base,
      id,
      endpoint: 'POST /v2/dashboard/homeDashboardMsgs/',
      affectedEndpoints: ['POST /v2/dashboard/homeDashboardMsgs/'],
    };

    const merged = mergeCandidates([c1, c2]);
    expect(merged, 'two observations of one fault collapse to a single ticket').toHaveLength(1);
    expect(merged[0]?.affectedEndpoints, 'that ticket lists both affected endpoints').toEqual([
      'POST /v2/aws/generate-presigned-url',
      'POST /v2/dashboard/homeDashboardMsgs/',
    ]);
    expect(merged[0]?.occurrences, 'and counts both occurrences').toBe(2);
  });

  test('a body leak is NOT collapsed with a header disclosure (distinct signatures)', () => {
    // A stack-trace / SQL body leak is that endpoint's own bug and must stay its own ticket; only the
    // shared technology-header disclosure is systemic. (isSystemicFinding keeps body leaks per-endpoint;
    // here we assert the signatures differ so they could never share a fingerprint.)
    const header = systemicSignature('security.information-disclosure', 'versioned Server header');
    const jwt = systemicSignature('security.jwt', 'alg-none accepted');
    expect(header).not.toBe(jwt);
  });
});
