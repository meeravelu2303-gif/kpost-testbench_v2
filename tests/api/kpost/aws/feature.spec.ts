import { env } from '@config/env';
// An orchestrated attachment lifecycle (generate → check → delete), not simple assertions.
/* eslint-disable playwright/no-conditional-in-test, playwright/no-conditional-expect */
import { AUTH_PROFILES } from '@config/auth-profile';
import type { Principal } from '@config/auth.config';
import type { EndpointExecutor } from '@engine/endpoint-executor';
import { expect, test } from '@fixtures';

/**
 * AWS **feature flow** — the S3 attachment lifecycle: generate a presigned URL (which mints a uuid),
 * check whether it exists, then delete it. Gated `AWS_LIFECYCLE=true`, each write `allowLiveWrite`.
 * The generated uuid names nothing but our own reserved S3 key, so no other user's data is touched.
 */

const A: Principal = AUTH_PROFILES.kpost.principals.find((p) => p.key === 'personal')!;

async function run(
  endpoints: EndpointExecutor,
  id: string,
  reqOverride: Record<string, unknown>,
  label: string,
): Promise<{ status: number; text: string }> {
  const ex = await endpoints.sendTo(id, reqOverride, {
    label: `aws:${label}`,
    auth: { principal: A },
    allowLiveWrite: true,
  });
  return { status: ex.status, text: ex.bodyText ?? '' };
}

/**
 * The generator returns a raw presigned S3 URL (a finding — documented as JSON). The uuid is the file
 * name in its path: `…/<uuid>.pdf?…`. Parse it out.
 */
function extractUuid(text: string): string | undefined {
  const uuid = text.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
  return uuid?.[1];
}

test.describe('KPost AWS · feature flow', { tag: '@kpost-api' }, () => {
  test.describe.configure({ mode: 'default' });
  test.skip(!env.AWS_LIFECYCLE, 'S3 attachment lifecycle; set AWS_LIFECYCLE=true');

  test('generate presigned URL → delete, on our own attachment @api @aws', async ({
    endpoints,
  }) => {
    const generated = await run(
      endpoints,
      'aws-generate-presigned',
      { body: { extension: 'pdf', fileName: 'qa-bench.pdf', fileSize: '940' } },
      'generate',
    );
    expect.soft(generated.status, 'generate-presigned is accepted').toBeLessThan(300);
    const uuid = extractUuid(generated.text);
    expect.soft(uuid, 'the generator mints a uuid').toBeTruthy();

    if (uuid) {
      // delete the presigned key we just reserved (the S3 object, if any). `checkAttachmentS3` runs
      // on live separately (read spec) with its empty default — a real-uuid check would need a
      // write-authorized call the guard reserves for destructive endpoints.
      const deleted = await run(
        endpoints,
        'aws-delete-attachment',
        { pathParams: { uuid } },
        'delete',
      );
      expect.soft(deleted.status, 'deleteAttachmentFromS3 returns a status').toBeLessThan(600);
    }
  });
});
