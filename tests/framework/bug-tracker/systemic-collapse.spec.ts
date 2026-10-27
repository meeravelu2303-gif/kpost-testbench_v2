import {
  mergeCandidates,
  systemicSignature,
} from '../../../src/bug-tracker/findings/bug-candidate';
import type { BugCandidate } from '../../../src/bug-tracker/findings/bug-candidate';
import { systemicFingerprint } from '../../../src/bug-tracker/findings/bug-fingerprint';
import { expect, test } from '@playwright/test';

/**
 * One root cause across many endpoints = ONE bug. Async probes reorder a systemic finding's
 * message, so it is fingerprinted by a stable signature, not the raw text.
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
    // A body leak stays per-endpoint; only the shared header disclosure is systemic.
    const header = systemicSignature('security.information-disclosure', 'versioned Server header');
    const jwt = systemicSignature('security.jwt', 'alg-none accepted');
    expect(header).not.toBe(jwt);
  });
});
