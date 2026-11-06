import type { ApiResponseWrapper } from '@api/client/response-wrapper';
import { AUTH_PROFILES } from '@config/auth-profile';
import type { Principal } from '@config/auth.config';
import { expect, test } from '@fixtures';
import { retryOrSkip } from '../../../support/live-condition';

/**
 * Another user's profile, read by KPost ID. The backend's own rule for another viewer
 * (UserProfileControllerV2.java:392-417, applyProfilePrivacy): date of birth, present address,
 * alternate mobile and landline are blanked unless the owner's privacyDetails sets that key to
 * "true"; the password, KMail password and access code are never returned. Owner control: A's own
 * profile holds the value, so a blank for C means the rule worked. Both routes that serve A's
 * profile to someone else are held to it: getUserProfileUsingKpostID and shareUserDetails (the share
 * link). Read-only.
 */
const P = AUTH_PROFILES.kpost.principals;
const A = P.find((p) => p.key === 'personal'); // whose profile is read
const C = P.find((p) => p.key === 'personal-3'); // another signed-in user

const PRIVATE = ['dateOfBirth', 'presentAddress', 'alternateMobile', 'landLine'] as const;
const SECRET = ['password', 'kmailPassword', 'accessCode'] as const;

/** The first value of `key` anywhere in a JSON answer. */
function find(value: unknown, key: string): unknown {
  if (!value || typeof value !== 'object') return undefined;
  if (!Array.isArray(value) && key in value) return (value as Record<string, unknown>)[key];
  for (const child of Object.values(value)) {
    const hit = find(child, key);
    if (hit !== undefined) return hit;
  }
  return undefined;
}
const json = (ex: ApiResponseWrapper): unknown => {
  const parsed = ex.json();
  return parsed.ok ? parsed.value : undefined;
};
/** A real value: text or a number, not blank or 0 (an object or list is not a field value). */
const filled = (v: unknown): boolean =>
  (typeof v === 'string' && v.trim() !== '' && v !== '0') || (typeof v === 'number' && v !== 0);

test.describe(
  'KPost Security · another user sees my profile only as my privacy settings allow @api @kpost-api @security @profile',
  {
    tag: ['@api', '@profile', '@security', '@regression'],
    annotation: [{ type: 'non-functional', description: 'security' }],
  },
  () => {
    test.skip(!A || !C, 'needs the personal and personal-3 principals');

    test("a profile read by KPost ID hides the owner's private fields and secrets @api @kpost-api @security", async ({
      endpoints,
    }) => {
      const read = (id: string, who: Principal, body: unknown, label: string) =>
        endpoints.sendTo(
          id,
          { body },
          {
            label: `xuser-privacy:${label}`,
            auth: { principal: who },
            allowLiveRead: true,
            allowLiveWrite: true,
          },
        );
      const own = await endpoints.sendTo(
        'profile-get-user-profile',
        {},
        { label: 'xuser-privacy:owner', auth: { principal: A! }, allowLiveRead: true },
      );
      retryOrSkip(own.status !== 200, `A's own profile read answered HTTP ${own.status}`);
      const mine = json(own);
      let privacy: Record<string, unknown> = {};
      try {
        const raw = find(mine, 'privacyDetails');
        privacy = (typeof raw === 'string' ? JSON.parse(raw) : (raw ?? {})) as Record<
          string,
          unknown
        >;
      } catch {
        privacy = {};
      }
      // Hidden from others: the owner has a value and has not chosen to show it.
      const hidden = PRIVATE.filter(
        (k) =>
          filled(find(mine, k)) &&
          !/^true$/i.test(
            typeof privacy[k] === 'string' || typeof privacy[k] === 'boolean'
              ? String(privacy[k])
              : '',
          ),
      );
      if (!hidden.length)
        test.info().annotations.push({
          type: 'not-judged',
          description: `privacy fields: A's own profile has none of ${PRIVATE.join(', ')} set and hidden, so only the secrets are judged`,
        });

      for (const [route, id, body] of [
        ['getUserProfileUsingKpostID', 'profile-user-profile-by-kpostid', { kpostID: A!.username }],
        ['shareUserDetails', 'profile-share-user-details', { kpostID: A!.username }],
      ] as const) {
        const ex = await read(id, C!, body, route);
        retryOrSkip(ex.status === 0, `${route} did not answer (timeout)`);
        if (ex.status >= 300) {
          test.info().annotations.push({
            type: 'not-judged',
            description: `${route}: HTTP ${ex.status} for C, nothing returned to judge`,
          });
          continue;
        }
        const theirs = json(ex);
        const shown = [
          // Shown = the owner's real value; a masked one (shareUserDetails masks the date of birth
          // as e.g. 19XX-05-XX) is the route doing its job.
          ...hidden.filter(
            (k) => JSON.stringify(find(theirs, k)) === JSON.stringify(find(mine, k)),
          ),
          ...SECRET.filter((k) => filled(find(theirs, k))),
        ];
        if (shown.length)
          endpoints.recordBusinessRuleViolation({
            endpointId: id,
            ruleId: `AUTHZ-${id}-private-fields`,
            rule: "Another user sees a profile only as its owner's privacy settings allow: date of birth, present address, alternate mobile and landline stay hidden unless the owner shows them, and secrets are never returned.",
            expected: `none of ${[...hidden, ...SECRET].join(', ')} in ${C!.username}'s view of ${A!.username}`,
            actual: `HTTP ${ex.status}: ${route} gave ${C!.username} ${shown.join(', ')} of ${A!.username}`,
            request: { body },
            correlationId: ex.correlationId,
          });
        expect
          .soft(shown, `${route} shows another user none of the owner's hidden fields or secrets`)
          .toEqual([]);
      }
    });
  },
);
