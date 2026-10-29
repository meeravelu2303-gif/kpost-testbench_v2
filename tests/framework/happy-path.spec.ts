import { expect, test } from '@fixtures';
import {
  blockReason,
  buildHappyPath,
  endpointOf,
  flowCreditsFrom,
  happyPathHeadline,
  happyPathMarkdown,
  isHappyPathTitle,
  type HappyPathTest,
} from '../../src/reporting/happy-path';

/** Engine describe titles as `describeEndpointCases` writes them. */
const SEND = 'KPost Katchup · sends › POST /v2/katchup/sendMessage/ [katchup-send-message]';
const OTP = 'KPost Common · OTP › POST /v2/common/sendOTP/ [common-send-otp]';
const ROLE = 'KPost core admin (/admin/*) › POST /admin/updateRole [admin-update-role]';
const LIST = 'KPost Contacts › POST /v2/contacts/myContacts/ [contacts-my-contacts]';

test.describe('happy-path report @framework', () => {
  test('only the status-code check is the happy path', () => {
    expect(isHappyPathTitle('response.status-code — The primary response status is one of …')).toBe(
      true,
    );
    expect(isHappyPathTitle('response.content-type — Content-Type matches …')).toBe(false);
  });

  test('reads the endpoint id and route from the engine describe title', () => {
    expect(endpointOf(SEND)).toEqual({
      endpointId: 'katchup-send-message',
      endpoint: 'POST /v2/katchup/sendMessage/',
    });
    expect(endpointOf('SMOKE · API · Katchup')).toBeUndefined();
  });

  test('turns guard and flow skip messages into plain reasons', () => {
    expect(
      blockReason(
        'POST /v2/common/sendOTP/: sends a real OTP/SMS/e-mail — BLOCKED (SMS kill-switch); it may run only …',
      ),
    ).toBe('sends a real OTP / SMS / e-mail');
    expect(
      blockReason(
        'POST /admin/updateRole changes state shared by the whole environment and TEST_ENV=production (…)',
      ),
    ).toBe('changes data shared by the whole environment (company, app version)');
    expect(
      blockReason('BLOCKED: needs the msgID from "a message sends", which did not complete'),
    ).toBe('needs a record an earlier step did not create');
    expect(blockReason('not executed — prerequisite failed: response.status-code')).toBe(
      'an earlier check of the same endpoint failed',
    );
  });

  test('one row per endpoint with its best result, and honest totals', () => {
    const tests: HappyPathTest[] = [
      { describe: SEND, outcome: 'unexpected', ran: true, error: 'Expected: 200\nReceived: 500' },
      // The same endpoint planned under a second profile passed: the endpoint counts as passed.
      { describe: SEND, outcome: 'expected', ran: true },
      {
        describe: OTP,
        outcome: 'skipped',
        ran: true,
        skipReason:
          'POST /v2/common/sendOTP/: sends a real OTP/SMS/e-mail — BLOCKED (SMS kill-switch)',
      },
      {
        describe: ROLE,
        outcome: 'unexpected',
        ran: true,
        error: '\u001b[31mExpected: 200\u001b[39m\nReceived: 404',
      },
      { describe: LIST, outcome: 'skipped', ran: false },
    ];
    const summary = buildHappyPath(tests);
    expect(summary.rows.map((r) => [r.endpointId, r.status])).toEqual([
      ['admin-update-role', 'failed'],
      ['common-send-otp', 'blocked'],
      ['contacts-my-contacts', 'not-run'],
      ['katchup-send-message', 'passed'],
    ]);
    expect(summary.rows[0]!.reason).toBe('Expected: 200');
    expect(summary.counts).toEqual({ passed: 1, failed: 1, blocked: 1, 'not-run': 1 });
    expect(happyPathHeadline(summary)).toBe(
      'happy path: 1/4 endpoints passed (25%) · 1 failed · 1 blocked · 1 not run',
    );

    const md = happyPathMarkdown('kpost-api', summary, { generatedAt: '2026-10-29T00:00:00Z' });
    expect(md).toContain('| ✅ Passed | 1 | 25% |');
    expect(md).toContain('## ❌ Failed (1)');
    expect(md).toContain('**sends a real OTP / SMS / e-mail** (1)');
    expect(md).toContain('- `POST /v2/contacts/myContacts/` (contacts-my-contacts)');
  });

  test('a passing flow proves the endpoints it drove with an expected answer, its own product only', () => {
    const annotation = JSON.stringify([
      [
        'common-validate-otp',
        { suite: 'kpost-api', route: 'POST /v2/common/validateOTP/', status: 200, ok: true },
      ],
      // A deliberately bad call (the flow expected the 400) proves nothing about the happy path.
      [
        'common-send-otp',
        { suite: 'kpost-api', route: 'POST /v2/common/sendOTP/', status: 400, ok: false },
      ],
      // Another product's endpoint the flow touched on the way.
      [
        'kmail-saluations',
        { suite: 'kmail-api', route: 'GET /v2/common/getSaluations/', status: 200, ok: true },
      ],
    ]);
    const credits = flowCreditsFrom(annotation, 'kpost-api');
    expect(credits).toEqual([
      { endpointId: 'common-validate-otp', route: 'POST /v2/common/validateOTP/' },
    ]);
    expect(flowCreditsFrom('not json', 'kpost-api')).toEqual([]);

    // The engine check alone could not pass (no fresh OTP); the flow did, so the endpoint passes by a flow.
    const VALIDATE = 'KPost Common · OTP › POST /v2/common/validateOTP/ [common-validate-otp]';
    const summary = buildHappyPath(
      [
        { describe: VALIDATE, outcome: 'unexpected', ran: true, error: 'Received: 500' },
        { describe: SEND, outcome: 'expected', ran: true },
      ],
      [...credits, { endpointId: 'signup-login-signup', route: 'POST /v2/signupLogin/signup/' }],
    );
    expect(summary.rows.map((r) => [r.endpointId, r.status, r.source])).toEqual([
      ['common-validate-otp', 'passed', 'flow'],
      ['katchup-send-message', 'passed', 'engine'],
      // Driven only by a flow, never by the engine: still a row.
      ['signup-login-signup', 'passed', 'flow'],
    ]);
    const md = happyPathMarkdown('kpost-api', summary, { generatedAt: '2026-10-29T00:00:00Z' });
    expect(md).toContain('| — by its own check | 1 | |');
    expect(md).toContain('| — by a flow | 2 | |');
  });
});
