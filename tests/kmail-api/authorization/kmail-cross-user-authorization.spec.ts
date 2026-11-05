import { AUTH_PROFILES } from '@config/auth-profile';
import type { Principal } from '@config/auth.config';
import { KMAIL_TYPE } from '@api/contract/kpost-types';
import { mailShape } from '@api/definitions/kmail/send.api';
import type { EndpointExecutor } from '@engine/endpoint-executor';
import { kmailAuthGate } from '@fixtures/kmail-auth-gate';
import { expect, test } from '@fixtures';

/**
 * KMail writes and downloads that name another user's record:
 * - deleteDraftMail looks the draft up by `kmailID` alone and deletes that row
 *   (KmailDraftServiceImpl.java:621-628, 670): C names A's draft;
 * - add/edit/deleteOtherDomainContact act on (token kpostID, contactEmailID)
 *   (CommonMailController.java:813, 842, 871): C names a contact address A has saved;
 * - downloadODAttachment checks canAccessMail first (ReadKmailController.java:313-315): C asks for
 *   the attachment of A's mail.
 * Every probe runs A's identical call as the owner control, and the verdict is A's own read-back
 * (draft list, the contact row, the file bytes), never C's status code alone. Only QA addresses are
 * used; every mail, draft and contact made here is removed.
 */
const K = AUTH_PROFILES.kpost;
const A: Principal = K.principals.find((p) => p.key === 'personal')!; // owner
const B: Principal = K.principals.find((p) => p.key === 'victim')!; // QA recipient / contact address
const C: Principal = K.principals.find((p) => p.key === 'personal-3')!; // unrelated attacker
/** The engine's KMail contact-write account: its contact rows are expected to churn. */
const A5: Principal = K.principals.find((p) => p.key === 'personal-5')!;

type Row = Record<string, unknown>;

function bodyOf(ex: { json(): { ok: boolean; value?: unknown } }): Row {
  const parsed = ex.json();
  return (parsed.ok ? parsed.value : {}) as Row;
}

function firstRow(body: Row): Row {
  const data = body.data;
  return ((Array.isArray(data) ? data[0] : data) as Row | undefined) ?? {};
}

/** A finding when `harm` describes one, recorded and soft-asserted (false = no harm). */
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
      request: { body: v.request },
    });
  expect
    .soft(Boolean(v.harm), `BOLA (${v.endpointId}, HTTP ${v.status}): ${v.harm ?? ''}`)
    .toBe(false);
}

test.describe(
  'KMail Security · cross-user writes and downloads by id @api @kmail-api @security',
  {
    tag: ['@api', '@kmail', '@security', '@regression'],
    annotation: [{ type: 'non-functional', description: 'security' }],
  },
  () => {
    test.describe.configure({ timeout: 120_000 });
    test.skip(kmailAuthGate() !== undefined, kmailAuthGate() ?? '');
    test.skip(
      process.env.KMAIL_LIFECYCLE !== 'true',
      'writes real drafts, contacts and mail; set KMAIL_LIFECYCLE=true',
    );
    test.skip(
      !A || !B || !C || !A5,
      'needs the personal, victim, personal-3 and personal-5 principals',
    );

    test("an unrelated user cannot delete another user's draft by kmailID @api @kmail-api @security", async ({
      endpoints,
    }) => {
      const marker = `QA XU draft ${Date.now()}`;
      const saved = await endpoints.sendTo(
        'kmail-draft-save',
        {
          body: mailShape({
            toAddress: B.username,
            kmailType: KMAIL_TYPE.draft,
            kmailSubject: marker,
          }),
        },
        { label: 'kmail-xu:draft-save', auth: { principal: A }, allowLiveWrite: true },
      );
      const r = firstRow(bodyOf(saved));
      const draftMailID = typeof r.draftMailID === 'string' ? r.draftMailID : '';
      const kmailID =
        typeof r.kmailID === 'number' || typeof r.kmailID === 'string' ? String(r.kmailID) : '';
      test.skip(
        !kmailID || kmailID === '0',
        `draftMail returned no kmailID (HTTP ${saved.status})`,
      );

      const owned = [kmailID, Number(kmailID), draftMailID].filter(Boolean);
      const listed = async (step: string): Promise<boolean> => {
        const ex = await endpoints.sendTo(
          'kmail-all-drafts',
          {},
          { label: `kmail-xu:draft-owner-${step}`, auth: { principal: A } },
        );
        return ex.bodyText.includes(marker);
      };
      let present = await listed('control');
      try {
        test.skip(!present, 'owner control: the new draft is not in A’s own draft list');

        // By kmailID alone: the server looks the draft up by that id with no owner filter
        // (KmailDraftServiceImpl.java:621-628). A's own delete below sends the same body.
        const deleteBody = { kmailID, draftMailID: '' };
        const attack = await endpoints.sendTo(
          'kmail-draft-delete',
          { body: deleteBody },
          {
            label: 'kmail-xu:draft-delete-attack',
            auth: { principal: C },
            allowLiveWrite: true,
            ownedIdentifiers: owned,
          },
        );
        present = await listed('after-attack');
        verdict(endpoints, {
          endpointId: 'kmail-draft-delete',
          ruleId: 'IDOR-kmail-draft-delete-cross-user',
          rule: "deleteDraftMail must delete only a draft the caller wrote: an unrelated user must not delete another user's draft by naming its kmailID.",
          expected: "the request is refused and the owner's draft is still in its draft list",
          request: deleteBody,
          status: attack.status,
          harm: !present
            ? `${C.username} deleted ${A.username}'s draft ${kmailID} (gone from A's getAllDraftMails)`
            : attack.bodyText.includes(marker)
              ? `the response disclosed ${A.username}'s draft subject`
              : undefined,
        });
      } finally {
        if (present) {
          // The owner's identical delete: the control that the call shape works.
          const own = await endpoints
            .sendTo(
              'kmail-draft-delete',
              { body: { kmailID, draftMailID: '' } },
              {
                label: 'kmail-xu:draft-cleanup',
                auth: { principal: A },
                allowLiveWrite: true,
                ownedIdentifiers: owned,
              },
            )
            .catch(() => undefined);
          expect.soft(own?.status, 'owner control: A deletes its own draft').toBeLessThan(300);
        }
      }
    });

    test("an unrelated user cannot add over, edit or delete another user's outside contact @api @kmail-api @security", async ({
      endpoints,
      databases,
    }) => {
      const database = databases.for('kmail-api');
      test.skip(!database.enabled, 'needs the KPOST_QA connection to read the contact row');
      const owner = A5;
      const contactEmailID = B.username;
      const stamp = Date.now();
      const table = 'TBL_KPOST_KMAIL_OTHER_DOMAIN_CONTACTS';
      const row = (who: Principal) =>
        database.findOne<{
          contact_name: string | null;
          reference_name: string | null;
          delete_status: unknown;
        }>({ table, where: { kpost_id: who.username, contact_email_id: contactEmailID } });
      const call = (who: Principal, id: string, body: Row, label: string) =>
        endpoints.sendTo(
          id,
          { body },
          { label: `kmail-xu:od-${label}`, auth: { principal: who }, allowLiveWrite: true },
        );
      const active = (r: { delete_status: unknown } | undefined) =>
        r !== undefined && Number(r.delete_status ?? 0) === 0;

      const before = await row(owner);
      const attackerBefore = await row(C);
      const ownerName = `QA XU owner contact ${stamp}`;
      try {
        await call(
          owner,
          'kmail-add-od-contact',
          { contactEmailID, contactName: `QA XU owner add ${stamp}`, referenceName: 'QA XU' },
          'owner-add',
        );
        // Owner control: A's own edit lands on its row.
        const ownerEdit = await call(
          owner,
          'kmail-edit-od-contact',
          { contactEmailID, contactName: ownerName },
          'owner-edit-control',
        );
        const control = await row(owner);
        test.skip(
          !active(control) || control?.contact_name !== ownerName,
          `owner control: A's own add + edit did not land (edit HTTP ${ownerEdit.status})`,
        );

        const ownerUnchanged = async (): Promise<string | undefined> => {
          const now = await row(owner);
          if (!active(now)) return `${owner.username}'s contact ${contactEmailID} is deleted`;
          if (now?.contact_name !== ownerName)
            return `${owner.username}'s contact ${contactEmailID} is now named ${JSON.stringify(now?.contact_name)}`;
          return undefined;
        };

        const editBody = { contactEmailID, contactName: `QA XU HIJACK edit ${stamp}` };
        const edit = await call(C, 'kmail-edit-od-contact', editBody, 'edit-attack');
        verdict(endpoints, {
          endpointId: 'kmail-edit-od-contact',
          ruleId: 'IDOR-kmail-edit-od-contact-cross-user',
          rule: "editOtherDomainContactsDetails must change only the caller's own contact: an unrelated user must not rename another user's outside contact by naming its address.",
          expected: "the owner's contact row is unchanged",
          request: editBody,
          status: edit.status,
          harm: await ownerUnchanged(),
        });

        const deleteBody = { contactEmailID };
        const removal = await call(C, 'kmail-delete-od-contact', deleteBody, 'delete-attack');
        verdict(endpoints, {
          endpointId: 'kmail-delete-od-contact',
          ruleId: 'IDOR-kmail-delete-od-contact-cross-user',
          rule: "deleteOtherDomainContact must delete only the caller's own contact: an unrelated user must not delete another user's outside contact by naming its address.",
          expected: "the owner's contact row is still active",
          request: deleteBody,
          status: removal.status,
          harm: await ownerUnchanged(),
        });

        // C's own add of the same address must make C's row, never re-point the owner's.
        const addBody = {
          contactEmailID,
          contactName: `QA XU HIJACK add ${stamp}`,
          referenceName: 'QA XU',
        };
        const add = await call(C, 'kmail-add-od-contact', addBody, 'add-attack');
        verdict(endpoints, {
          endpointId: 'kmail-add-od-contact',
          ruleId: 'IDOR-kmail-add-od-contact-cross-user',
          rule: "addOtherDomainContacts must write only the caller's own contact list: adding an address another user has saved must not change that user's contact.",
          expected: "the owner's contact row is unchanged",
          request: addBody,
          status: add.status,
          harm: await ownerUnchanged(),
        });
      } finally {
        // Each side back to how it was: a contact that existed before keeps its name, a new one is
        // removed (soft delete, the app's own).
        for (const [who, was] of [
          [owner, before],
          [C, attackerBefore],
        ] as const) {
          await (
            active(was)
              ? call(
                  who,
                  'kmail-add-od-contact',
                  {
                    contactEmailID,
                    contactName: was?.contact_name ?? '',
                    referenceName: was?.reference_name ?? '',
                  },
                  'restore',
                )
              : call(who, 'kmail-delete-od-contact', { contactEmailID }, 'cleanup')
          ).catch(() => undefined);
        }
      }
    });

    test("an unrelated user cannot download another pair's attachment via downloadODAttachment @api @kmail-api @security", async ({
      endpoints,
    }) => {
      test.skip(
        process.env.AWS_LIFECYCLE !== 'true',
        'uploads a real (tiny) file to S3; set AWS_LIFECYCLE=true',
      );
      // A 1x1 JPEG (well under the 64 KB upload cap).
      const content = Buffer.from(
        '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/2wBDAQMDAwQDBAgEBAgQCwkLEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAj/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k=',
        'base64',
      );
      const fileName = `qa-xu-${Date.now()}.jpg`;
      let transactionIDs: number[] = [];
      let kmailID: number | undefined;
      try {
        const presign = await endpoints.sendTo(
          'aws-generate-presigned',
          { body: { extension: 'jpg', fileName, fileSize: String(content.length) } },
          { label: 'kmail-xu:presign', auth: { principal: A }, allowLiveWrite: true },
        );
        const raw = presign.bodyText.trim();
        const url = raw.startsWith('{')
          ? String((JSON.parse(raw) as { presignedURL?: string }).presignedURL ?? '')
          : raw.replace(/^"|"$/g, '');
        const uuid = url.match(
          /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i,
        )?.[1];
        test.skip(!uuid, `generate-presigned-url named no uuid (HTTP ${presign.status})`);
        const put = await fetch(url, {
          method: 'PUT',
          headers: { 'Content-Type': 'image/jpeg' },
          body: content,
        });
        test.skip(put.status >= 300, `the S3 upload failed (HTTP ${put.status})`);

        const sent = await endpoints.sendTo(
          'kmail-post-mail',
          {
            body: mailShape({
              toAddress: B.username,
              kmailSubject: `QA XU OD attachment ${Date.now()}`,
              attachmentFlag: 1,
              attachmentUuid: [uuid],
            }),
          },
          { label: 'kmail-xu:od-send', auth: { principal: A }, allowLiveWrite: true },
        );
        const mail = firstRow(bodyOf(sent));
        kmailID = typeof mail.kmailID === 'number' ? mail.kmailID : undefined;
        const txns = mail.kmailTransactionList;
        transactionIDs = Array.isArray(txns)
          ? (txns as Row[])
              .map((t) => t.transactionID)
              .filter((v): v is number => typeof v === 'number')
          : [];
        test.skip(!kmailID, `the mail with the attachment was not sent (HTTP ${sent.status})`);

        // The web's own body (KmailMessageBox.js kmailInfo + targetFileName).
        const odBody = (kmailType: string): Row => ({
          kmailID,
          kmailNumber: typeof mail.kmailNumber === 'number' ? mail.kmailNumber : 0,
          kmailType,
          groupFlag: false,
          targetFileName: fileName,
        });
        const download = (who: Principal, kmailType: string, label: string) =>
          endpoints.sendTo(
            'kmail-download-od-attachment',
            { body: odBody(kmailType) },
            {
              label: `kmail-xu:od-${label}`,
              auth: { principal: who },
              allowLiveRead: true,
              allowLiveWrite: true,
              ownedIdentifiers: [kmailID!, uuid!],
            },
          );
        const owner = await download(A, 'sent', 'owner-control');
        // The identical body: canAccessMail runs before kmailType is read.
        const attack = await download(C, 'sent', 'attack');
        const leaked = attack.status < 300 && attack.bodyText.length > 0;
        verdict(endpoints, {
          endpointId: 'kmail-download-od-attachment',
          ruleId: 'IDOR-kmail-download-od-attachment-cross-user',
          rule: "downloadODAttachment must serve only a mail's sender or receivers: an unrelated user must not download another pair's attachment by naming the kmailID.",
          expected: 'HTTP 403 and no file',
          request: odBody('sent'),
          status: attack.status,
          harm: leaked
            ? `${C.username} downloaded ${attack.bodyText.length} bytes of the attachment of mail ${kmailID} (${A.username} → ${B.username})`
            : undefined,
        });
        if (!leaked)
          test.skip(
            owner.status !== 200 || owner.bodyText.length === 0,
            `owner control: A could not download its own attachment (HTTP ${owner.status}), so C's refusal proves nothing`,
          );
        expect.soft(attack.status, 'the outsider is refused with 403').toBe(403);
      } finally {
        if (transactionIDs.length)
          await endpoints
            .sendTo(
              'kmail-delete',
              { body: { groupFlag: false, transactionIDs } },
              {
                label: 'kmail-xu:od-cleanup',
                auth: { principal: A },
                allowLiveWrite: true,
                ownedIdentifiers: [...transactionIDs, ...(kmailID ? [kmailID] : [])],
              },
            )
            .catch(() => undefined);
      }
    });
  },
);
