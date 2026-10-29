import { KNEWS_SETTINGS_SAMPLE } from '@api/definitions/kpost/knews/knews.api';
import { sendShape } from '@api/definitions/kpost/katchup/send.api';
import type { ParsedJson } from '@api/client/response-wrapper';
import { AUTH_PROFILES } from '@config/auth-profile';
import type { Principal } from '@config/auth.config';
import type { EndpointExecutor } from '@engine/endpoint-executor';
import { expect, test } from '@fixtures';

/**
 * Cross-user checks for the endpoints the module security specs do not reach yet. Each one uses a
 * record our own QA account owns, tries it as an unrelated QA account, and keeps the owner control:
 * the owner's identical call must work, or the refusal proves nothing. QA accounts only; every
 * record made here is removed again.
 */
const principal = (key: string): Principal =>
  AUTH_PROFILES.kpost.principals.find((p) => p.key === key)!;
const OWNER = principal('personal');
const RECEIVER = principal('victim');
const OUTSIDER = principal('personal-3');
// changeCaption (any user can rewrite anyone's message) is not probed here: it is sideEffect
// 'global', so the guard refuses it on live; it needs the owner's go-ahead.

function bodyOf<T>(exchange: { json(): ParsedJson }): T | undefined {
  const parsed = exchange.json();
  return parsed.ok ? (parsed.value as T) : undefined;
}

async function deleteOwn(endpoints: EndpointExecutor, msgID: number | undefined): Promise<void> {
  if (!msgID) return;
  await endpoints
    .sendTo(
      'katchup-delete-message',
      { body: { messageIds: [msgID], groupFlag: false } },
      { label: 'cross-user:cleanup', auth: { principal: OWNER }, allowLiveWrite: true },
    )
    .catch(() => undefined);
}

test.describe(
  'KPost Security · cross-user gaps @api @security',
  { tag: ['@api', '@katchup', '@regression'] },
  () => {
    test.describe.configure({ mode: 'default' });

    test('a message cannot be sent as someone else without logging in', async ({ endpoints }) => {
      test.skip(
        process.env.KATCHUP_LIFECYCLE !== 'true',
        'writes a message; set KATCHUP_LIFECYCLE=true',
      );
      const sent = await endpoints.sendTo(
        'common-send-message',
        { body: sendShape({ sender: OWNER.username, subject: 'QA bench no-login send' }) },
        { label: 'cross-user:public-send', auth: { header: undefined }, allowLiveWrite: true },
      );
      const data = bodyOf<{ data?: { msgID?: number }[] }>(sent)?.data;
      const msgID = Array.isArray(data) ? data[0]?.msgID : undefined;
      try {
        if (sent.status < 300)
          endpoints.recordBusinessRuleViolation({
            endpointId: 'common-send-message',
            ruleId: 'KPV2-PUBLIC-SEND-IMPERSONATION',
            rule:
              'Sending a Katchup message must require a login, and the sender must be the logged-in user; ' +
              'a request with no token must not deliver a message in another person’s name.',
            expected: 'HTTP 401: no token, no message',
            actual: `HTTP ${sent.status}: a message was delivered as ${OWNER.username} with no token (msgID ${msgID ?? '?'})`,
            request: {
              body: sendShape({ sender: OWNER.username, subject: 'QA bench no-login send' }),
            },
            correlationId: sent.correlationId,
          });
        expect
          .soft(sent.status, 'sending as our account with no token must need a login (401)')
          .toBe(401);
      } finally {
        await deleteOwn(endpoints, msgID);
      }
    });

    test("another user's kpostId in the KNews settings body changes only the caller's settings", async ({
      endpoints,
    }) => {
      const read = async (who: Principal) =>
        bodyOf<{ data?: Record<string, unknown> }>(
          await endpoints.sendTo(
            'knews-get-settings',
            {},
            { label: 'cross-user:knews-read', auth: { principal: who } },
          ),
        )?.data;
      const ownerBefore = await read(OWNER);
      const receiverBefore = await read(RECEIVER);
      const marker = {
        ...KNEWS_SETTINGS_SAMPLE,
        category: 'Cross User Probe',
        kpostId: OWNER.username,
      };
      const saved = await endpoints.sendTo(
        'knews-update-settings',
        { body: marker },
        {
          label: 'cross-user:knews-write-other',
          auth: { principal: RECEIVER },
          allowLiveWrite: true,
          ownedIdentifiers: [OWNER.username],
        },
      );
      try {
        expect(saved.status, 'the save itself is accepted (it is the caller’s own settings)').toBe(
          200,
        );
        const ownerAfter = await read(OWNER);
        if (ownerAfter?.category !== ownerBefore?.category)
          endpoints.recordBusinessRuleViolation({
            endpointId: 'knews-update-settings',
            ruleId: 'KPV2-KNEWS-SETTINGS-IDOR',
            rule: 'updateKnewsSettings must change only the logged-in user’s settings, whatever kpostId the body names.',
            expected: `${OWNER.username}'s category stays "${String(ownerBefore?.category)}"`,
            actual: `it became "${String(ownerAfter?.category)}" after ${RECEIVER.username} saved settings naming it`,
            request: { body: marker },
            correlationId: saved.correlationId,
          });
        expect
          .soft(ownerAfter?.category, 'our settings are untouched by someone naming our kpostId')
          .toBe(ownerBefore?.category);
      } finally {
        // Put the receiver's own settings back (no delete API: a first save stays).
        const restore = receiverBefore
          ? Object.fromEntries(
              Object.keys(KNEWS_SETTINGS_SAMPLE).map((k) => [k, receiverBefore[k] ?? undefined]),
            )
          : KNEWS_SETTINGS_SAMPLE;
        await endpoints
          .sendTo(
            'knews-update-settings',
            { body: restore },
            {
              label: 'cross-user:knews-restore',
              auth: { principal: RECEIVER },
              allowLiveWrite: true,
            },
          )
          .catch(() => undefined);
      }
    });

    test("a stranger cannot check our uploaded file's status by its uuid", async ({
      endpoints,
    }) => {
      test.skip(process.env.AWS_LIFECYCLE !== 'true', 'presigns an S3 key; set AWS_LIFECYCLE=true');
      const generated = await endpoints.sendTo(
        'aws-generate-presigned',
        { body: { extension: 'pdf', fileName: 'qa-bench.pdf', fileSize: '940' } },
        { label: 'cross-user:presign', auth: { principal: OWNER }, allowLiveWrite: true },
      );
      const uuid = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i.exec(
        generated.bodyText ?? '',
      )?.[1];
      expect(uuid, 'our presign minted a uuid').toBeTruthy();
      try {
        const check = (who: Principal, label: string) =>
          endpoints.sendTo(
            'aws-check-attachment-get',
            { pathParams: { uuid: uuid! } },
            { label, auth: { principal: who }, allowLiveRead: true, ownedIdentifiers: [uuid!] },
          );
        const own = await check(OWNER, 'cross-user:s3-check-owner');
        expect(own.status, 'owner control: we see our own presigned file (417, not uploaded)').toBe(
          417,
        );
        const foreign = await check(OUTSIDER, 'cross-user:s3-check-outsider');
        if (foreign.status !== 406)
          endpoints.recordBusinessRuleViolation({
            endpointId: 'aws-check-attachment-get',
            ruleId: 'KPV2-S3-CHECK-IDOR',
            rule: 'checkAttachmenS3 must answer only for the caller’s own uuid (406 "not belongs to the user" otherwise).',
            expected: 'HTTP 406 for a stranger (the owner got 417)',
            actual: `HTTP ${foreign.status} for ${OUTSIDER.username} on ${OWNER.username}'s uuid`,
            request: { pathParams: { uuid: uuid! } },
            correlationId: foreign.correlationId,
          });
        expect.soft(foreign.status, 'a stranger is told the uuid is not theirs (406)').toBe(406);
      } finally {
        await endpoints
          .sendTo(
            'aws-delete-attachment',
            { pathParams: { uuid: uuid ?? '' } },
            {
              label: 'cross-user:s3-cleanup',
              auth: { principal: OWNER },
              allowLiveWrite: true,
              ownedIdentifiers: uuid ? [uuid] : [],
            },
          )
          .catch(() => undefined);
      }
    });
  },
);
