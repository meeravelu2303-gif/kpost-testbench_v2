import { AUTH_PROFILES } from '@config/auth-profile';
import type { AuthMode, EndpointExecutor } from '@engine/endpoint-executor';
import { expect, test } from '@fixtures';

/**
 * Maintenance endpoints an ordinary account must not reach: the mobile app version (two developer
 * accounts only, CommonControllerV2.updateFlutterAppVersion), the RedBus city-list re-import, the
 * KNews feed administration (news admins only, NewsAdminController.checkAdmin), and the public
 * medium/large add-member route (no client calls it; /signupLoginForMediumAndLarge/** is permitAll).
 * Every probe is built so a wrong acceptance changes nothing: the app version is re-sent unchanged,
 * the feed id does not exist, and the add-member body is unparseable. On the QA test server only.
 */

const ORDINARY = AUTH_PROFILES.kpost.principals.find((p) => p.key === 'personal-5');
const NO_TOKEN: AuthMode = { header: undefined };
const REFUSED = [401, 403];

async function call(
  endpoints: EndpointExecutor,
  id: string,
  spec: Parameters<EndpointExecutor['sendTo']>[1],
  auth: AuthMode,
  label: string,
) {
  return endpoints.sendTo(id, spec, {
    label: `privileged:${label}`,
    auth,
    allowGlobalLifecycle: true,
    allowLiveRead: true,
  });
}

/** Records a finding when an ordinary or anonymous caller got past the gate, and soft-asserts it. */
function judge(
  endpoints: EndpointExecutor,
  input: { endpointId: string; ruleId: string; rule: string; who: string; status: number },
): void {
  const refused = REFUSED.includes(input.status);
  if (!refused) {
    endpoints.recordBusinessRuleViolation({
      endpointId: input.endpointId,
      ruleId: input.ruleId,
      rule: input.rule,
      expected: '401 or 403: the caller is not allowed',
      actual: `${input.who} got ${input.status}`,
      request: {},
    });
  }
  expect.soft(refused, `${input.ruleId}: ${input.who} is refused (got ${input.status})`).toBe(true);
}

test.describe(
  'KPost Security · maintenance endpoints refuse ordinary callers',
  {
    tag: ['@api', '@auth', '@security', '@regression'],
    annotation: [{ type: 'non-functional', description: 'security' }],
  },
  () => {
    test.skip(
      process.env.GLOBAL_LIFECYCLE !== 'true' || process.env.TEST_DB_MODE !== 'true',
      'calls shared-state endpoints on the QA test server; set GLOBAL_LIFECYCLE=true and TEST_DB_MODE=true',
    );
    test.skip(!ORDINARY, 'needs the 5th QA account (personal-5)');

    test('only the two developer accounts may set the mobile app version', async ({
      endpoints,
    }) => {
      const read = await endpoints.sendTo(
        'common-flutter-app-version',
        {},
        { label: 'privileged:app-version-read' },
      );
      const current = (JSON.parse(read.bodyText || '{}') as { version?: string }).version;
      test.skip(!current, `no app version to re-send right now (read answered ${read.status})`);
      // The current value is re-sent, so even a wrong acceptance changes nothing.
      for (const [who, auth] of [
        ['an ordinary account', { principal: ORDINARY! }],
        ['a caller without a token', NO_TOKEN],
      ] as const) {
        const sent = await call(
          endpoints,
          'common-update-flutter-app-version',
          { body: { currentVersion: current } },
          auth,
          `app-version-${who}`,
        );
        judge(endpoints, {
          endpointId: 'common-update-flutter-app-version',
          ruleId: 'PRIVILEGE-app-version-set-by-ordinary-caller',
          rule: 'updateFlutterAppVersion drives every mobile client’s upgrade prompt and is limited to two developer accounts; anyone else must be refused.',
          who,
          status: sent.status,
        });
      }
      const after = await endpoints.sendTo(
        'common-flutter-app-version',
        {},
        { label: 'privileged:app-version-reread' },
      );
      expect
        .soft((JSON.parse(after.bodyText || '{}') as { version?: string }).version)
        .toBe(current);
    });

    test('an ordinary account cannot re-import the shared RedBus city list', async ({
      endpoints,
    }) => {
      const sent = await call(
        endpoints,
        'kbooking-update-city-list',
        {},
        { principal: ORDINARY! },
        'city-list-ordinary',
      );
      judge(endpoints, {
        endpointId: 'kbooking-update-city-list',
        ruleId: 'PRIVILEGE-city-list-reimport-by-ordinary-account',
        rule: 'updatecitylist calls the RedBus partner API and rewrites the city list every user’s KBooking search reads; an ordinary account must not be able to trigger it (any login is enough today: /redbus/** needs no admin role).',
        who: 'an ordinary account',
        status: sent.status,
      });
      // When it does run, a failure must not answer 200 or hand the caller a Java exception.
      const reply = JSON.parse(sent.bodyText || '{}') as { status?: string; errorvalue?: string };
      if (sent.status < 300 && reply.status === 'FAILURE') {
        endpoints.recordBusinessRuleViolation({
          endpointId: 'kbooking-update-city-list',
          ruleId: 'ERROR-city-list-failure-answers-200',
          rule: 'A failed city-list re-import must answer a 5xx without internal details, not HTTP 200 with the exception text.',
          expected: '5xx with a plain message',
          actual: `HTTP ${sent.status}, status FAILURE, errorvalue "${reply.errorvalue ?? ''}"`,
          request: {},
        });
      }
      expect
        .soft(
          sent.status < 300 && reply.status === 'FAILURE',
          `a failed re-import answers HTTP ${sent.status} (${reply.errorvalue ?? 'no detail'})`,
        )
        .toBe(false);
    });

    test('an ordinary account cannot administer the KNews feeds', async ({ endpoints }) => {
      for (const [id, spec] of [
        ['knews-admin-feed-sync', {}],
        ['knews-admin-feed-enable', { pathParams: { feedId: 'qa_bench_no_such_feed' } }],
        ['knews-admin-feed-disable', { pathParams: { feedId: 'qa_bench_no_such_feed' } }],
      ] as const) {
        const sent = await call(endpoints, id, spec, { principal: ORDINARY! }, id);
        judge(endpoints, {
          endpointId: id,
          ruleId: 'PRIVILEGE-knews-feed-admin-by-ordinary-account',
          rule: 'The KNews feed administration (sync, enable, disable) changes every user’s news and is for news admins only.',
          who: 'an ordinary account',
          status: sent.status,
        });
      }
    });

    test('the public medium/large add-member route needs a login', async ({ endpoints }) => {
      // Unparseable on purpose: a gate answers 401/403 first; a 400 means the body was read.
      const sent = await call(
        endpoints,
        'signup-login-business-adding-user-public',
        { rawBody: '{not json', headers: { 'content-type': 'application/json' } },
        NO_TOKEN,
        'public-add-member',
      );
      judge(endpoints, {
        endpointId: 'signup-login-business-adding-user-public',
        ruleId: 'AUTH-public-add-member-route-has-no-login-gate',
        rule: 'POST /signupLoginForMediumAndLarge/addingUserByAdmin creates a member account in the company the body names; it must require a logged-in company admin (no client calls it; the Admin module uses the authenticated /admin/addingUserByAdmin).',
        who: 'a caller without a token',
        status: sent.status,
      });
    });
  },
);
