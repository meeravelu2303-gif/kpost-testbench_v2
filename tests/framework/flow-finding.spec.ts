import { apiRegistry } from '@api/definitions/index';
import { resolveEndpoint } from '@engine/validation-policy';
import {
  businessRuleFindingReports,
  flowFindingReports,
  isServerError,
  type BusinessRuleFinding,
  type FlowFinding,
} from '@engine/flow-finding';
import { candidatesFromReport, mergeCandidates } from '../../src/bug-tracker/bug-candidate';
import { applyValidityGate } from '../../src/bug-tracker/validity-gate';
import { readBugzillaConfig } from '../../src/config/bugzilla.config';
import { expect, test } from '@fixtures';

/**
 * A gated lifecycle flow finds bugs the engine never touches (a 5xx on a real write). This proves
 * those findings reach Bugzilla through the SAME pipeline as engine bugs — so they inherit every
 * guarantee the owner requires: no duplicate (a stable `[KP-]` dedupe tag), no invalid bug (the
 * validity gate), and no false bug (only a 5xx is collected; a 4xx — which might be our payload — is
 * never turned into a finding).
 */

const config = { ...readBugzillaConfig(), tagPrefix: 'KP' };
const ctx = { baseURL: 'https://devapi2.kpostindia.com' };
const endpoint = resolveEndpoint(apiRegistry.get('katchup-recall-message'));

const finding = (status: number): FlowFinding => ({
  endpoint,
  method: endpoint.method,
  status,
  body: '{"statusCode":500,"message":"NullPointerException"}',
  request: { body: { msgID: 1, groupFlag: false } },
  correlationId: 'tb-flow-test',
});

test.describe('lifecycle flow findings file through the same safe pipeline @framework', () => {
  test('only a 5xx is a server fault — a 4xx never is', () => {
    expect(isServerError(500)).toBe(true);
    expect(isServerError(503)).toBe(true);
    expect(isServerError(400)).toBe(false);
    expect(isServerError(404)).toBe(false);
    expect(isServerError(200)).toBe(false);
  });

  test('a 5xx write flow → ONE valid, [KP-]-tagged candidate that dedupes across runs', () => {
    // Two observations of the same endpoint in one run consolidate to a single report...
    const reports = flowFindingReports([finding(500), finding(500)]);
    expect(reports, 'per-endpoint consolidation, not one ticket per call').toHaveLength(1);

    const candidates = reports.flatMap((r) => candidatesFromReport(r, ctx, config));
    expect(candidates, 'one server-error ticket for the endpoint').toHaveLength(1);
    // ...carrying the dedupe tag, so a re-run comments on the same ticket instead of duplicating.
    expect(candidates[0]?.id, 'a stable [KP-] dedupe tag').toMatch(/^KP-[0-9A-F]+$/);

    // The validity gate keeps it: a real 5xx is a fileable defect, not infrastructure noise.
    const gate = applyValidityGate(candidates);
    expect(gate.filed, 'a genuine server crash is valid and fileable').toHaveLength(1);
    expect(gate.rejected).toHaveLength(0);

    // A second run produces the SAME id, so the batch dedupe collapses the two into one.
    const rerun = flowFindingReports([finding(500)]).flatMap((r) =>
      candidatesFromReport(r, ctx, config),
    );
    expect(rerun[0]?.id).toBe(candidates[0]?.id);
    expect(mergeCandidates([...candidates, ...rerun]), 'never files a duplicate').toHaveLength(1);
  });

  test('a business-rule violation → ONE valid, [KP-]-tagged candidate that dedupes per (endpoint, rule)', () => {
    const brFinding: BusinessRuleFinding = {
      endpoint,
      ruleId: 'BR-C01',
      rule: 'Rescheduling must keep the same kallID.',
      expected: 'same kallID (5)',
      actual: 'a new kallID (9)',
      request: { body: { kallID: 5 } },
      correlationId: 'tb-br-test',
    };
    const candidates = businessRuleFindingReports([brFinding, brFinding]).flatMap((r) =>
      candidatesFromReport(r, ctx, config),
    );
    expect(candidates, 'one ticket per (endpoint, rule)').toHaveLength(1);
    expect(candidates[0]?.id, 'a stable [KP-] dedupe tag').toMatch(/^KP-[0-9A-F]+$/);
    expect(candidates[0]?.classification, 'classified by the rule').toBe('business-rule.br-c01');
    const gate = applyValidityGate(candidates);
    expect(gate.filed, 'a confirmed rule violation is valid and fileable').toHaveLength(1);
  });
});
