import { AUTH_PROFILES } from '@config/auth-profile';
import type { Principal } from '@config/auth.config';
import { expect, test } from '@fixtures';

/**
 * AWS **business-rule checks** for the two presign generators and the attachment-status check.
 * Not gated: minting a presigned URL creates no S3 object until something actually uploads to it,
 * and checking status is a pure read — both `productionSafe: true`, safe on every default run.
 *
 * `aws-generate-presigned` and `aws-katchup-presigned` are otherwise easy to mistake for the same
 * thing under two names: live-verified 2026-09-24, they mint keys under DIFFERENT S3 folders
 * (`.../Kmail/...` vs `.../Katchup/...`) — the module-scoping is the actual business rule, not just
 * "returns a URL".
 *
 * `aws-check-attachment`'s response shape looks at first glance like broken/leftover debug output
 * (`{"0": "...", "1": "...", "2": "...", "3": "...", "data": [...]}`) — the numeric keys are in fact
 * a status-code LEGEND the endpoint echoes on every call, and `data` is the real per-uuid result: an
 * array of `{uuid: statusCode}` entries. Live-verified: a uuid that was never presigned is simply
 * ABSENT from `data` (not an explicit "not found" code), while a uuid that was just presigned but not
 * yet uploaded to appears with code "1" ("folder created but file not uploaded").
 */

const A: Principal = AUTH_PROFILES.kpost.principals.find((p) => p.key === 'personal')!;

interface CheckAttachmentBody {
  data?: Array<Record<string, string>>;
}

function extractUuid(url: string): string | undefined {
  return url.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i)?.[1];
}

test.describe('KPost AWS · business rules @api @aws', () => {
  test('generate-presigned and katchup-presigned mint keys under different S3 module folders', async ({
    endpoints,
  }) => {
    const [general, katchup] = await Promise.all([
      endpoints.sendTo(
        'aws-generate-presigned',
        { body: { extension: 'pdf', fileName: 'qa-bench.pdf', fileSize: '940' } },
        { label: 'aws:generate-general', auth: { principal: A } },
      ),
      endpoints.sendTo(
        'aws-katchup-presigned',
        { body: { extension: 'pdf', fileName: 'qa-bench.pdf', fileSize: '940' } },
        { label: 'aws:generate-katchup', auth: { principal: A } },
      ),
    ]);
    expect.soft(general.status, 'generate-presigned succeeds').toBe(200);
    expect.soft(katchup.status, 'katchup-presigned succeeds').toBe(200);

    const generalUrl = general.bodyText ?? '';
    const katchupUrl = katchup.bodyText ?? '';
    expect(generalUrl, 'generate-presigned scopes the key under /Kmail/').toContain('/Kmail/');
    expect(katchupUrl, 'katchup-presigned scopes the key under /Katchup/').toContain('/Katchup/');
    expect(
      extractUuid(generalUrl),
      'each presign call mints its own distinct uuid, not a shared one',
    ).not.toBe(extractUuid(katchupUrl));
  });

  test('check-attachment: a never-presigned uuid is absent from data, not reported with a status code', async ({
    endpoints,
  }) => {
    const check = await endpoints.sendTo(
      'aws-check-attachment',
      { body: { attachmentsUuid: ['qa-bench-never-presigned-00000000'] } },
      { label: 'aws:check-nonexistent', auth: { principal: A } },
    );
    expect(check.status, 'checkAttachmentS3 succeeds').toBe(200);
    const body = JSON.parse(check.bodyText || '{}') as CheckAttachmentBody;
    const found = (body.data ?? []).some((entry) =>
      Object.prototype.hasOwnProperty.call(entry, 'qa-bench-never-presigned-00000000'),
    );
    expect(found, 'a uuid that was never presigned has no entry in data').toBe(false);
  });

  test('check-attachment: a freshly-presigned (not-yet-uploaded) uuid is reported with status "1"', async ({
    endpoints,
  }) => {
    const minted = await endpoints.sendTo(
      'aws-generate-presigned',
      { body: { extension: 'pdf', fileName: 'qa-bench.pdf', fileSize: '940' } },
      { label: 'aws:mint-for-check', auth: { principal: A } },
    );
    const uuid = extractUuid(minted.bodyText ?? '');
    expect(uuid, 'a uuid was minted to check against').toBeTruthy();
    if (!uuid) return;

    const check = await endpoints.sendTo(
      'aws-check-attachment',
      { body: { attachmentsUuid: [uuid] } },
      { label: 'aws:check-just-minted', auth: { principal: A } },
    );
    expect(check.status, 'checkAttachmentS3 succeeds').toBe(200);
    const body = JSON.parse(check.bodyText || '{}') as CheckAttachmentBody;
    const entry = (body.data ?? []).find((e) => Object.prototype.hasOwnProperty.call(e, uuid));
    expect(
      entry?.[uuid],
      'a presigned-but-not-yet-uploaded uuid is reported as status "1" (folder created but file not uploaded)',
    ).toBe('1');
  });

  test('check-attachment handles a mixed batch of a real and a fake uuid independently', async ({
    endpoints,
  }) => {
    const minted = await endpoints.sendTo(
      'aws-generate-presigned',
      { body: { extension: 'pdf', fileName: 'qa-bench.pdf', fileSize: '940' } },
      { label: 'aws:mint-for-batch', auth: { principal: A } },
    );
    const realUuid = extractUuid(minted.bodyText ?? '');
    expect(realUuid, 'a uuid was minted for the batch check').toBeTruthy();
    if (!realUuid) return;
    const fakeUuid = 'qa-bench-fake-in-batch-00000000';

    const check = await endpoints.sendTo(
      'aws-check-attachment',
      { body: { attachmentsUuid: [realUuid, fakeUuid] } },
      { label: 'aws:check-batch', auth: { principal: A } },
    );
    expect(check.status, 'checkAttachmentS3 succeeds for a mixed batch').toBe(200);
    const body = JSON.parse(check.bodyText || '{}') as CheckAttachmentBody;
    const realEntry = (body.data ?? []).find((e) =>
      Object.prototype.hasOwnProperty.call(e, realUuid),
    );
    const fakeEntry = (body.data ?? []).find((e) =>
      Object.prototype.hasOwnProperty.call(e, fakeUuid),
    );
    expect(realEntry?.[realUuid], 'the real uuid in the batch is reported').toBe('1');
    expect(fakeEntry, 'the fake uuid in the same batch is not reported').toBeUndefined();
  });
});
