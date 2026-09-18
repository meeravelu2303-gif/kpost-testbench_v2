import {
  consolidateCascades,
  mergeCandidates,
  type BugCandidate,
} from '../../src/bug-tracker/bug-candidate';
import { candidateRejection } from '../../src/bug-tracker/validity-gate';
import { expect, test } from '@fixtures';

/**
 * A broken endpoint (5xx or timeout) trips every response-reading check at once — filing one ticket
 * per check is noise. These pin that a cascade collapses to ONE anchor ticket, that a healthy
 * endpoint's distinct findings are untouched, and that a lone timeout check is never filed.
 */

function cand(over: Partial<BugCandidate>): BugCandidate {
  return {
    id: over.id ?? 'KP-000001',
    source: 'api',
    suiteId: 'kpost-api',
    title: over.title ?? 'x',
    narrative: 'n',
    severity: 'HIGH',
    category: 'Functional',
    classification: over.classification ?? 'response.status-code',
    product: 'KPost API',
    component: 'C',
    version: 'unspecified',
    assignee: 'a@b.c',
    ownerName: 'o',
    endpoint: over.endpoint ?? 'POST /x',
    expected: 'e',
    actual: over.actual ?? 'a',
    occurrences: 1,
    environment: 'production',
    baseURL: 'http://h',
    build: 'local',
    testRunId: 'r',
    observedAt: '2026-09-18T00:00:00Z',
    evidence: {},
    ...over,
  };
}

test.describe('cascade consolidation', () => {
  test('a 5xx endpoint collapses its response-reading checks into one anchor @framework', () => {
    const out = consolidateCascades([
      cand({ id: 'A1', classification: 'response.status-code', responseStatus: 500 }),
      cand({ id: 'A2', classification: 'response.structure', responseStatus: 500 }),
      cand({ id: 'A3', classification: 'response.schema', responseStatus: 500 }),
      cand({ id: 'A4', classification: 'common.api-error', responseStatus: 500 }),
      cand({ id: 'A5', classification: 'response.error-format', responseStatus: 500 }),
    ]);
    expect(out, 'six symptom tickets become one').toHaveLength(1);
    expect(out[0]?.classification).toBe('response.status-code');
    expect(out[0]?.narrative).toContain('consolidated here');
  });

  test('a 5xx endpoint KEEPS independent input-validation findings @framework', () => {
    const out = consolidateCascades([
      cand({ id: 'B1', classification: 'response.status-code', responseStatus: 500 }),
      cand({ id: 'B2', classification: 'response.structure', responseStatus: 500 }),
      cand({ id: 'B3', classification: 'request.null-value', responseStatus: 500 }),
    ]);
    // status-code (anchor) + request.null-value (independent probe) survive; structure folds in.
    expect(out.map((c) => c.classification).sort()).toEqual([
      'request.null-value',
      'response.status-code',
    ]);
  });

  test('a timeout takes the whole endpoint down to one ticket @framework', () => {
    const out = consolidateCascades([
      cand({
        id: 'C1',
        classification: 'response.status-code',
        actual: 'Timeout 10000ms exceeded',
      }),
      cand({ id: 'C2', classification: 'request.null-value', actual: 'Timeout 10000ms exceeded' }),
      cand({ id: 'C3', classification: 'response.schema', actual: 'Timeout 10000ms exceeded' }),
    ]);
    expect(out, 'a hung endpoint is one problem, not three').toHaveLength(1);
  });

  test('a healthy endpoint is left untouched @framework', () => {
    const input = [
      cand({ id: 'D1', classification: 'request.null-value', responseStatus: 200 }),
      cand({ id: 'D2', classification: 'request.unsupported-media-type', responseStatus: 200 }),
    ];
    expect(consolidateCascades(input)).toHaveLength(2);
  });

  test('systemic candidates are never consolidated @framework', () => {
    const input = [cand({ id: 'E1', systemic: true, endpoint: undefined, responseStatus: 500 })];
    expect(consolidateCascades(input)).toHaveLength(1);
  });

  test('a standalone response-time finding is rejected by the validity gate @framework', () => {
    expect(candidateRejection(cand({ classification: 'performance.response-time' }))).toContain(
      'environmental',
    );
    expect(candidateRejection(cand({ classification: 'response.status-code' }))).toBeUndefined();
  });

  test('consolidation composes with merge (no crash on merged input) @framework', () => {
    const merged = mergeCandidates([cand({ id: 'F1', responseStatus: 200 })]);
    expect(consolidateCascades(merged)).toHaveLength(1);
  });
});
