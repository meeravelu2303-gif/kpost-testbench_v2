import { AUTH_PROFILES } from '@config/auth-profile';
import { isSqlClient } from '@database/database-client';
import { expect, test } from '@fixtures';

/**
 * updatePrivacySettingDetails must refuse a privacyDetails that is not a JSON object: one that is
 * stored makes every later read of that profile answer 500 (#13382). Run on the 4th QA account and
 * always put back in the QA DB afterwards (privacy_details NULL, privacy_status 0, as on the other
 * QA accounts), so a stored bad value never outlives the test.
 */
const K = AUTH_PROFILES.kpost;
const OWNER = K.principals.find((p) => p.key === 'personal-4');
const STRANGER = K.principals.find((p) => p.key === 'personal-3');

test.describe(
  'KPost Profile · a privacy value that is not a JSON object is refused @api @kpost-api @profile @database',
  { tag: ['@api', '@profile', '@regression'] },
  () => {
    test.skip(!OWNER?.username || !STRANGER?.username, 'needs the 3rd and 4th QA accounts');

    for (const bad of ['not-json{', '0']) {
      test(`privacyDetails ${JSON.stringify(bad)} is refused, and the profile stays readable`, async ({
        endpoints,
        databases,
      }) => {
        const db = databases.for('kpost-api');
        test.skip(
          !isSqlClient(db) || !db.writable,
          'needs the writable KPOST_QA connection to put the account back',
        );
        const kpostID = OWNER!.username;
        try {
          const save = await endpoints.sendTo(
            'profile-update-privacy',
            { body: { privacyDetails: bad } },
            { label: 'privacy:bad-value', auth: { principal: OWNER! }, allowLiveWrite: true },
          );
          expect
            .soft(save.status, `privacyDetails ${JSON.stringify(bad)} is refused (#13382)`)
            .toBeGreaterThanOrEqual(400);
          for (const [who, label] of [
            [OWNER!, 'its owner'],
            [STRANGER!, 'another user'],
          ] as const) {
            const read = await endpoints.sendTo(
              'profile-user-profile-by-kpostid',
              { body: { kpostID } },
              { label: `privacy:read-as-${label}`, auth: { principal: who }, allowLiveRead: true },
            );
            expect
              .soft(read.status, `the profile stays readable by ${label} (#13382)`)
              .toBeLessThan(500);
          }
        } finally {
          if (isSqlClient(db) && db.writable)
            await db.query(
              'UPDATE TBL_KPOST_USER_PROFILE SET privacy_details = NULL, privacy_status = 0 WHERE kpost_id = ?',
              [kpostID],
            );
        }
      });
    }
  },
);
