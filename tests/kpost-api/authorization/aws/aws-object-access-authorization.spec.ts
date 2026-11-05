// AWS S3 object access across users. Gated on AWS_LIFECYCLE: each presign makes a 0-byte S3
// placeholder plus an attachment row, and every one made here is deleted by its owner in `finally`.
import { AUTH_PROFILES } from '@config/auth-profile';
import type { Principal } from '@config/auth.config';
import type { EndpointExecutor } from '@engine/endpoint-executor';
import { expect, test } from '@fixtures';

/**
 * The presigned-URL endpoints must not let one user reach an S3 object another user created.
 * PresignedURLController / PreSignedURLServiceImpl scope every object by the token's kpostID:
 * - the generators mint a fresh uuid under `<caller>/Kmail/…` or `<caller>/Katchup/…`, and overwrite
 *   the body's `kpostID` and `bucketName` (PresignedURLController.java:87-88, 119-120;
 *   PreSignedURLServiceImpl.java:91-100, 203-217), so a body naming another user must not aim a URL
 *   into their folder;
 * - deleteAttachmentFromS3 finds the path by (uuid, caller) (PreSignedURLServiceImpl.java:379-391)
 *   and answers 404 for someone else's uuid;
 * - checkAttachmenS3 answers 406 "UUID is not belongs to the user" (PresignedURLController.java:211-215)
 *   and the POST checkAttachmentS3 reports someone else's uuid as "3" (Invalid_user,
 *   PreSignedURLServiceImpl.java:445-459), never its upload state.
 *
 * Nothing is ever uploaded: the only S3 objects are the server's own 0-byte placeholders, well
 * under UPLOAD_MAX_BYTES, and each is deleted through deleteAttachmentFromS3 by its owner. A's
 * owner calls are the control: A sees and deletes its own object, C's identical call must not.
 */
const A: Principal = AUTH_PROFILES.kpost.principals.find((p) => p.key === 'personal')!;
const C: Principal = AUTH_PROFILES.kpost.principals.find((p) => p.key === 'personal-3')!;

type Row = Record<string, unknown>;
const META = { extension: 'pdf', fileName: 'qa-bench.pdf', fileSize: '940' };
const UUID_RE = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;
/** The S3 folder a user's objects live in (`@` becomes `_`, PreSignedURLServiceImpl.java:93). */
const folderOf = (who: Principal) => `${who.username.replace('@', '_')}/`;

/** Presigns as `who`; returns the minted uuid (from the URL's file name) and the raw body. */
async function presign(
  endpoints: EndpointExecutor,
  who: Principal,
  id: 'aws-generate-presigned' | 'aws-katchup-presigned',
  body: Row,
  step: string,
): Promise<{ status: number; text: string; uuid: string | undefined }> {
  const ex = await endpoints.sendTo(
    id,
    { body },
    {
      label: `aws-xu:presign-${step}`,
      auth: { principal: who },
      allowLiveWrite: true,
      ownedIdentifiers: [A.username, C.username],
    },
  );
  const text = ex.bodyText ?? '';
  return { status: ex.status, text, uuid: text.match(UUID_RE)?.[1] };
}

async function remove(
  endpoints: EndpointExecutor,
  who: Principal,
  uuid: string,
  step: string,
): Promise<{ status: number; text: string }> {
  const ex = await endpoints.sendTo(
    'aws-delete-attachment',
    { pathParams: { uuid } },
    {
      label: `aws-xu:delete-${step}`,
      auth: { principal: who },
      allowLiveWrite: true,
      ownedIdentifiers: [uuid],
    },
  );
  return { status: ex.status, text: ex.bodyText ?? '' };
}

async function checkGet(
  endpoints: EndpointExecutor,
  who: Principal,
  uuid: string,
  step: string,
): Promise<{ status: number; text: string }> {
  const ex = await endpoints.sendTo(
    'aws-check-attachment-get',
    { pathParams: { uuid } },
    {
      label: `aws-xu:check-get-${step}`,
      auth: { principal: who },
      allowLiveRead: true,
      ownedIdentifiers: [uuid],
    },
  );
  return { status: ex.status, text: ex.bodyText ?? '' };
}

/** The POST check's code for `uuid` ("0" uploaded … "3" Invalid_user), or undefined when absent. */
async function checkPost(
  endpoints: EndpointExecutor,
  who: Principal,
  uuid: string,
  step: string,
): Promise<{ status: number; code: string | undefined }> {
  const ex = await endpoints.sendTo(
    'aws-check-attachment',
    { body: { attachmentsUuid: [uuid] } },
    {
      label: `aws-xu:check-post-${step}`,
      auth: { principal: who },
      ownedIdentifiers: [uuid],
    },
  );
  const parsed = ex.json();
  const data = ((parsed.ok ? (parsed.value as Row).data : undefined) ?? []) as Array<
    Record<string, string>
  >;
  const entry = Array.isArray(data) ? data.find((e) => uuid in e) : undefined;
  return { status: ex.status, code: entry?.[uuid] };
}

/** Deletes an object as its owner, soft-checking it went (the owner control for C's delete). */
async function cleanup(
  endpoints: EndpointExecutor,
  owner: Principal,
  uuid: string | undefined,
  alreadyGone: boolean,
): Promise<void> {
  if (!uuid || alreadyGone) return;
  const own = await remove(endpoints, owner, uuid, `cleanup-${owner.key}`).catch(() => ({
    status: 0,
    text: '',
  }));
  expect
    .soft(own.status, `owner control: ${owner.username} deletes its own object ${uuid}`)
    .toBe(200);
}

/** A finding when `harm` describes one, recorded and soft-asserted (undefined = no harm). */
function verdict(
  endpoints: EndpointExecutor,
  v: {
    endpointId: string;
    ruleId: string;
    rule: string;
    expected: string;
    request: Row;
    status: number;
    harm: string | undefined;
  },
): void {
  if (v.harm)
    endpoints.recordBusinessRuleViolation({
      endpointId: v.endpointId,
      ruleId: v.ruleId,
      rule: v.rule,
      expected: v.expected,
      actual: `HTTP ${v.status}: ${v.harm}`,
      request: v.request,
    });
  expect
    .soft(Boolean(v.harm), `BOLA (${v.endpointId}, HTTP ${v.status}): ${v.harm ?? ''}`)
    .toBe(false);
}

test.describe(
  'KPost Security · AWS S3 object access across users @api @kpost-api @security',
  {
    tag: ['@api', '@auth', '@security', '@regression', '@platform', '@aws'],
    annotation: [{ type: 'non-functional', description: 'security' }],
  },
  () => {
    test.describe.configure({ mode: 'default', timeout: 120_000 });
    test.skip(
      process.env.AWS_LIFECYCLE !== 'true',
      'creates 0-byte S3 placeholders (deleted afterwards); set AWS_LIFECYCLE=true',
    );
    test.skip(!A || !C, 'needs the personal and personal-3 principals');

    test("an unrelated user cannot check or delete another user's KMail S3 object @api @aws @security", async ({
      endpoints,
    }) => {
      const made = await presign(endpoints, A, 'aws-generate-presigned', META, 'kmail-owner');
      const uuid = made.uuid;
      test.skip(!uuid, `generate-presigned-url minted no uuid (HTTP ${made.status})`);
      let gone = false;
      try {
        // Owner control: A sees its own fresh placeholder (417 = presigned, nothing uploaded).
        const ownerCheck = await checkGet(endpoints, A, uuid!, 'owner-control');
        expect
          .soft(ownerCheck.status, 'owner control: A checks its own presigned uuid (417)')
          .toBe(417);
        const ownerPost = await checkPost(endpoints, A, uuid!, 'owner-control');
        expect.soft(ownerPost.code, 'owner control: A’s POST check reports "1"').toBe('1');

        // --- checkAttachmenS3 (GET) ---------------------------------------------------------
        const xCheck = await checkGet(endpoints, C, uuid!, 'attack');
        verdict(endpoints, {
          endpointId: 'aws-check-attachment-get',
          ruleId: 'IDOR-aws-check-attachment-get-cross-user',
          rule: "checkAttachmenS3 must answer 406 'UUID is not belongs to the user' for another user's uuid (PresignedURLController.java:211-215), not its upload state.",
          expected: 'HTTP 406, nothing about the object',
          request: { pathParams: { uuid } },
          status: xCheck.status,
          harm: [200, 417].includes(xCheck.status)
            ? `${C.username} learned the upload state of ${A.username}'s object ${uuid}: ${xCheck.text.slice(0, 120)}`
            : undefined,
        });

        // --- checkAttachmentS3 (POST) -------------------------------------------------------
        const xPost = await checkPost(endpoints, C, uuid!, 'attack');
        verdict(endpoints, {
          endpointId: 'aws-check-attachment',
          ruleId: 'IDOR-aws-check-attachment-cross-user',
          rule: 'checkAttachmentS3 must report another user\'s uuid as "3" (Invalid_user) or not at all (PreSignedURLServiceImpl.java:445-459), never its upload state.',
          expected: 'code "3" or no entry',
          request: { body: { attachmentsUuid: [uuid] } },
          status: xPost.status,
          harm:
            xPost.code !== undefined && xPost.code !== '3'
              ? `${C.username} got upload code "${xPost.code}" for ${A.username}'s object ${uuid}`
              : undefined,
        });

        // --- deleteAttachmentFromS3 ---------------------------------------------------------
        const xDelete = await remove(endpoints, C, uuid!, 'attack');
        const after = await checkGet(endpoints, A, uuid!, 'after-delete-attack');
        // 404 = no folder any more; a transport error or 5xx is "not re-checked", not "gone".
        gone = after.status === 404;
        verdict(endpoints, {
          endpointId: 'aws-delete-attachment',
          ruleId: 'IDOR-aws-delete-attachment-cross-user',
          rule: "deleteAttachmentFromS3 must delete only the caller's own object: it looks the path up by (uuid, caller) and answers 404 for anyone else's (PreSignedURLServiceImpl.java:379-391).",
          expected: "HTTP 404, and A's object is still there (A's check still answers 417)",
          request: { pathParams: { uuid } },
          status: xDelete.status,
          harm:
            xDelete.status === 200 || gone
              ? `${C.username} deleted ${A.username}'s object ${uuid} (delete HTTP ${xDelete.status}; A's check now HTTP ${after.status})`
              : undefined,
        });
        expect.soft(xDelete.status, 'C’s delete of A’s uuid is a 404').toBe(404);
      } finally {
        await cleanup(endpoints, A, uuid, gone);
      }
    });

    test("an unrelated user cannot delete another user's Katchup S3 object @api @aws @security", async ({
      endpoints,
    }) => {
      // The check endpoints read only KMail attachments, so the owner's own delete afterwards is
      // the read-back: it can only answer 200 if the object was still A's to delete.
      const made = await presign(endpoints, A, 'aws-katchup-presigned', META, 'katchup-owner');
      const uuid = made.uuid;
      test.skip(!uuid, `katchup/generate-presigned-url minted no uuid (HTTP ${made.status})`);
      let ownerDeleted = false;
      try {
        const xDelete = await remove(endpoints, C, uuid!, 'katchup-attack');
        const own = await remove(endpoints, A, uuid!, 'katchup-owner-after-attack');
        ownerDeleted = own.status === 200;
        verdict(endpoints, {
          endpointId: 'aws-delete-attachment',
          ruleId: 'IDOR-aws-delete-attachment-katchup-cross-user',
          rule: "deleteAttachmentFromS3 must delete only the caller's own Katchup object (katchupAttachmentRepo.getAttachmentPath(uuid, caller), PreSignedURLServiceImpl.java:384-391).",
          expected: "HTTP 404 for C; A's own delete afterwards succeeds",
          request: { pathParams: { uuid } },
          status: xDelete.status,
          harm:
            xDelete.status === 200
              ? `${C.username} deleted ${A.username}'s Katchup object ${uuid} ("${xDelete.text.slice(0, 80)}"); A's own delete then answered ${own.status}`
              : undefined,
        });
        expect.soft(xDelete.status, 'C’s delete of A’s Katchup uuid is a 404').toBe(404);
        expect.soft(own.status, 'owner control: A deletes its own Katchup object').toBe(200);
      } finally {
        await cleanup(endpoints, A, uuid, ownerDeleted);
      }
    });

    test('a presign naming another user in the body still lands in the caller’s own S3 folder @api @aws @security', async ({
      endpoints,
    }) => {
      // Owner control: A's own presign lands in A's folder.
      const own = await presign(endpoints, A, 'aws-generate-presigned', META, 'folder-owner');
      // C's identical call, naming A (and another bucket) in the fields the controller overwrites.
      const attackBody = {
        ...META,
        kpostID: A.username,
        kpostId: A.username,
        bucketName: 'qa-bench-no-such-bucket',
      };
      const attack = await presign(
        endpoints,
        C,
        'aws-generate-presigned',
        attackBody,
        'folder-attack',
      );
      try {
        expect
          .soft(own.text, 'owner control: A’s presigned URL is under A’s folder')
          .toContain(folderOf(A));
        const inA = attack.text.includes(folderOf(A));
        verdict(endpoints, {
          endpointId: 'aws-generate-presigned',
          ruleId: 'IDOR-aws-generate-presigned-foreign-folder',
          rule: "generate-presigned-url must place the object under the caller's own folder: the body's kpostID and bucketName are overwritten from the token and config (PresignedURLController.java:87-88).",
          expected: `a URL under ${folderOf(C)}, never under ${folderOf(A)}`,
          request: { body: attackBody },
          status: attack.status,
          harm: inA
            ? `${C.username} got an upload URL inside ${A.username}'s S3 folder (${folderOf(A)})`
            : undefined,
        });
        if (attack.uuid && !inA)
          expect.soft(attack.text, 'C’s URL is under C’s own folder').toContain(folderOf(C));
      } finally {
        await cleanup(endpoints, A, own.uuid, false);
        // Whoever the server filed C's object under deletes it; C first (the expected owner).
        if (attack.uuid) {
          const byC = await remove(endpoints, C, attack.uuid, 'folder-cleanup-c').catch(() => ({
            status: 0,
            text: '',
          }));
          if (byC.status !== 200) await cleanup(endpoints, A, attack.uuid, false);
        }
      }
    });
  },
);
