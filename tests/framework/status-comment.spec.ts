import type { BugSummary } from '../../src/bug-tracker/bugzilla-client';
import { plainStatusComment } from '../../src/reporting/bugzilla-reporter';
import { expect, test } from '@fixtures';

/**
 * The dated status note is what developers read in the exported sheet's "Last Comment" column, so
 * its reason must be the TRUE one, in plain English. Pins each reason to its wording.
 */
const ui: BugSummary = { id: 1, is_open: true, summary: '[KP-AAA111] KMail — network drop @ui: Error: crashed' };
const api: BugSummary = { id: 2, is_open: true, summary: '[KP-BBB222] POST /v2/x: body.y null (got 500)' };

test.describe('plain-English status comment @framework', () => {
  test('a UI bug for another browser says that browser was not tested — not "skipped on its endpoint"', () => {
    const text = plainStatusComment(ui, {
      action: 'keep',
      reason: 'its originating test did not run on firefox this pass',
      validator: 'ui',
      systemic: false,
    });
    expect(text).toContain('This bug was found on firefox, and this run did not test firefox');
    expect(text).not.toContain('skipped on its endpoint');
  });

  test('an API check that did not run says it was skipped on its endpoint', () => {
    const text = plainStatusComment(api, {
      action: 'keep',
      reason: 'validator "request.null-value" did not run on POST /V2/X',
      validator: 'request.null-value',
      systemic: false,
    });
    expect(text).toContain('skipped on its endpoint');
  });

  test('a still-broken bug quotes what failed and mentions the attached proof', () => {
    const text = plainStatusComment(
      api,
      { action: 'keep', reason: 'still failing on POST /V2/X', validator: 'x', systemic: false, evidence: 'expected 400, got 500' },
      'Proof: this run\'s failure screenshot is attached to this bug (proof.png).',
    );
    expect(text).toContain('Result: STILL BROKEN');
    expect(text).toContain('What failed on this date: expected 400, got 500');
    expect(text).toContain('proof.png');
  });
});
