import { buildDescription } from '../../../src/bug-tracker/ticket/bug-builder';
import {
  candidateFromUiFailure,
  candidatesFromReport,
  type BugCandidate,
} from '../../../src/bug-tracker/findings/bug-candidate';
import { readBugzillaConfig, type BugzillaConfig } from '../../../src/config/bugzilla.config';
import type {
  ValidationReport,
  ValidationResult,
} from '../../../src/validation-engine/validation-result';
import { expect, test } from '@fixtures';

/**
 * A filed bug is short and plain (owner, 2026-10-26): a Summary of 2-4 sentences, numbered Steps,
 * Expected, Actual, How to fix, curl, then who/where/when, each under a label the BUGZILLA-UI
 * tracker parses. The gates keep reading `narrative`/`actual`, which this layout leaves unchanged.
 *
 * SHOW_BUG_SAMPLES=true prints the sample bugs, to read them as a developer would.
 */

const config: BugzillaConfig = { ...readBugzillaConfig(), tagPrefix: 'KP' };

function apiReport(result: Partial<ValidationResult>, body: string): ValidationReport {
  return {
    endpointId: 'profile-update-image',
    endpoint: 'POST /v2/profile/updateProfileImage/',
    method: 'POST',
    request: { method: 'POST', path: '/v2/profile/updateProfileImage/', headers: {} },
    requiresAuth: true,
    primary: { status: 500, body },
    tags: ['Profile'],
    suite: 'kpost-api',
    profile: 'FULL',
    environment: 'production',
    build: 'local',
    testRunId: 'run-420b3816',
    correlationId: 'br-26ef3be5',
    startedAt: '2026-10-27T09:15:00.000Z',
    durationMs: 120,
    results: [
      {
        validationId: 'v1',
        validatorName: 'response.status-code',
        category: 'RESPONSE',
        endpointId: 'profile-update-image',
        endpoint: 'POST /v2/profile/updateProfileImage/',
        method: 'POST',
        status: 'FAILED',
        message: 'expected 400, got 500',
        expected: 400,
        actual: 500,
        severity: 'HIGH',
        durationMs: 1,
        timestamp: '2026-10-27T09:15:00.000Z',
        correlationId: 'br-26ef3be5',
        ...result,
      },
    ],
    summary: {} as ValidationReport['summary'],
    gate: { passed: false, blocking: [] },
  } as ValidationReport;
}

const reply =
  '{"statusCode":500,"status":"FAILURE","message":"Unable to upload profile image. Please try again later","data":null}';
const apiBug = (result: Partial<ValidationResult> = {}): BugCandidate =>
  candidatesFromReport(
    apiReport(result, reply),
    { baseURL: 'https://testingapi.kpostindia.com' },
    config,
  )[0]!;

const uiBug = (): BugCandidate =>
  candidateFromUiFailure(
    {
      file: 'tests/kpost-ui/settings/kmail-settings.spec.ts',
      title: 'saving a mail signature keeps it after a reload @ui @settings',
      message: 'expected the saved signature "Regards, QA" to be shown, got an empty box',
      fullMessage: 'expected the saved signature "Regards, QA" to be shown, got an empty box',
      browser: 'chromium',
      environment: 'production',
      baseURL: 'https://test.kpostindia.com/',
      build: 'local',
      testRunId: 'run-8439c5e7',
      observedAt: '2026-10-27T09:20:00.000Z',
      failedApiCalls: ['POST /v2/generalSetting/saveMailSignature/ → 500'],
    },
    config,
  );

/** The text under `label:` up to the next blank-line-separated label, as the tracker reads it. */
/** The tracker's own section labels (BUGZILLA-UI `backend/src/lib/defectReport.ts` SECTION_START). */
const SECTION_START =
  /^(Expected|Actual|Response body[^:\n]*|Repro|curl|Owner|Environment|Run date|Filed by|Correlation ID[^:\n]*|Browsers affected|Steps[^:\n]*|Summary|What this means|Why it matters|How to fix|Classification|Category|Endpoint|Module|Representative endpoint)\s*:/i;

/** The text under `label:` up to the next section label, as the tracker reads it. */
function block(description: string, label: string): string {
  const lines = description.split('\n');
  const start = lines.indexOf(`${label}:`);
  if (start === -1) return '';
  const out: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (SECTION_START.test(line.trim())) break;
    out.push(line);
  }
  return out.join(' ').replace(/\s+/g, ' ').trim();
}

const sentences = (text: string): number =>
  text.split(/(?<=[.!?])\s+(?=[A-Z"])/).filter((s) => s.trim()).length;

test.describe('plain, short bug text @framework', () => {
  test('an API bug: labelled blocks in reading order, with a short plain Summary', () => {
    const description = buildDescription(apiBug());
    if (process.env.SHOW_BUG_SAMPLES === 'true') console.log(`\n--- API bug ---\n${description}`);

    const order = [
      'Classification:',
      'Endpoint: POST /v2/profile/updateProfileImage/',
      'Summary:',
      'Steps to reproduce:',
      'Expected:',
      'Actual:',
      'How to fix:',
      'curl:',
      'Owner: Jaganathan Murthy <jagan@kpost.in>',
      'Environment: https://testingapi.kpostindia.com',
      'Run date: 2026-10-27 09:15 UTC',
      'Filed by: kpost-testbench_v2 automated test, run run-420b3816',
    ];
    const at = order.map((label) => description.indexOf(label));
    expect(
      at.every((i) => i >= 0),
      `every block is present: ${order[at.indexOf(-1)]}`,
    ).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);

    const summary = block(description, 'Summary');
    expect(sentences(summary)).toBeGreaterThanOrEqual(2);
    expect(sentences(summary)).toBeLessThanOrEqual(4);
    expect(summary).toContain('HTTP status code');
    expect(block(description, 'Steps to reproduce')).toContain('2. Run the curl below.');
  });

  test('no engine words, no internal names, and the reply is not printed twice', () => {
    const description = buildDescription(apiBug({ actual: `status=500, body=${reply}` }));
    for (const word of [
      'centralized validation engine',
      'Preconditions:',
      'FULL profile',
      'What this means:',
      'Why it matters:',
      'maintainer of the',
      'production (',
    ]) {
      expect(description, `no "${word}"`).not.toContain(word);
    }
    expect(description, 'Actual already quotes the reply').not.toContain('Response body (HTTP');
    expect(description.split('Unable to upload profile image').length - 1).toBe(1);
  });

  test('a business rule says the rule in its own words', () => {
    const bug = apiBug({
      validatorName: 'business-rule.profile-update-image-png-5xx-crash',
      message:
        'profile-update-image-png-5xx-crash violated — updateProfileImage must reject a PNG with a clean 4xx (it is JPEG-only), never crash with a 5xx',
    });
    expect(block(buildDescription(bug), 'Summary')).toBe(
      'This rule is broken: updateProfileImage must reject a PNG with a clean 4xx (it is JPEG-only), never crash with a 5xx.',
    );
  });

  test('a UI bug: the screen, the expected behaviour in words, steps in the product', () => {
    const bug = uiBug();
    const description = buildDescription(bug);
    if (process.env.SHOW_BUG_SAMPLES === 'true') console.log(`\n--- UI bug ---\n${description}`);

    expect(block(description, 'Summary')).toBe(
      'On the Settings screen, this check failed: "Saving a mail signature keeps it after a reload". ' +
        '1 API call(s) failed while the screen loaded (listed under Actual), so the cause may be in the API.',
    );
    expect(block(description, 'Expected')).toBe('Saving a mail signature keeps it after a reload.');
    expect(description).toContain(
      '1. Sign in to https://test.kpostindia.com/ with a test account in Chromium.\n' +
        '2. Open the Settings screen.\n' +
        '3. Do what Expected describes, and compare the result with Actual.',
    );
    expect(description).toContain(
      'API calls that failed while the screen loaded:\n  - POST /v2/generalSetting/saveMailSignature/ → 500',
    );
    expect(description, 'a UI bug has no curl').not.toContain('curl:');
    expect(description, 'nor an empty endpoint line').not.toContain('Endpoint:');
  });

  test('the gates read the same narrative and actual as before', () => {
    // The validity gate and known-false-positives match on these; the new Summary must not move them.
    expect(apiBug().narrative).toContain(
      'The centralized validation engine ran "response.status-code"',
    );
    const ui = uiBug();
    expect(ui.actual).toBe(
      'expected the saved signature "Regards, QA" to be shown, got an empty box',
    );
    expect(ui.narrative).toContain('Likely API cause (contract drift');
  });

  test('a bug written by hand says so on its Filed by line', () => {
    const manual = buildDescription({ ...apiBug(), filedBy: 'manual' });
    expect(manual).toContain('Filed by: manual test');
  });

  test('a repeat count and the reproduction score join the Summary in one sentence', () => {
    const description = buildDescription({
      ...apiBug(),
      reproduction: { attempts: 3, failures: 3 },
    });
    expect(block(description, 'Summary')).toMatch(
      /It failed 3 of 3 tries, so it is not a one-off\.$/,
    );
  });
});
