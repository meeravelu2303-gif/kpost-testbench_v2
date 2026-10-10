import { AUTH_PROFILES } from '@config/auth-profile';
import { kmailAuthGate } from '@fixtures/kmail-auth-gate';
import { mailShape } from '@api/definitions/kmail/send.api';
import { expect, test } from '@fixtures';

/**
 * KMail mail-CONTENT IDOR — can an outsider read the full body of a mail they neither sent nor
 * received, just by knowing/guessing its kmailID?
 *
 * ## What this proves
 *
 * The 2026-10-04 KMail backend ground-truth audit found `POST /v2/readMail/sentAndInboxMailContent/`
 * (`ReadKmailController.java:112-151`) sets the caller's identity from the JWT, but the actual content
 * lookup — `ReadKmailServiceImpl.java:372` (`readSentMailContent`) and `:634` (`readInboxMailContent`)
 * — is a bare `kmailContentRepository.findByKmailID(kmailID)` with NO check that the resolved mail's
 * sender or receiver matches the caller. The sender/receiver matching loop that does exist in that
 * service (`:355-362`/`:607-619`) only decides which transaction row to use for a legacy IMAP-store
 * fallback search; it never gates whether the content itself is returned. `downloadAttachment`
 * (`ReadKmailController.java:153-186`) shares the exact same vulnerable service calls.
 *
 * This is the read-side analogue of the already-fixed `setKmailAsImportant`/`kmailDelete` BOLA
 * (`mutation-idor.spec.ts`) — but worse: a confidentiality breach of the full message body, not a
 * star/delete toggle, and (per that same audit) it had ZERO IDOR coverage before this test.
 *
 * ## Why the verdict is the response BODY, not the HTTP status
 *
 * Like the mutation endpoints, this one is expected to answer 200 regardless of the caller's
 * relationship to the mail (there is no ownership check to produce a 403/404) — so the only honest
 * verdict is whether the outsider's response actually contains the real, secret mail content.
 *
 * ## Confirmed real, but intermittent (~40-50% of live attempts)
 *
 * Live reproduction (2026-10-04) confirms the leak with the real `mailContent` and both parties'
 * identities returned to the attacker (`urlPath: "readSentMailContent"` in the response) — but it does
 * NOT reproduce on every attempt, with or without the settle delay below. The source hints at why: the
 * sender/receiver matching loop in `readSentMailContent` exists for a "legacy IMAP-store fallback
 * search" alongside the unguarded `kmailContentRepository.findByKmailID` lookup — plausibly two
 * different storage paths can answer the same request, one safe and one not, and which one responds
 * may depend on backend-internal timing/caching this test cannot control. Soft-fails rather than
 * hard-fails for exactly this reason: a single clean run must not be read as "fixed."
 */
const K = AUTH_PROFILES.kpost;
const A = K.principals.find((p) => p.key === 'personal')!; // sender
const B = K.principals.find((p) => p.key === 'victim')!; // legitimate recipient
const C = K.principals.find((p) => p.key === 'personal-3')!; // attacker — no relationship to this mail

test.describe('KMail · mail-content IDOR (sentAndInboxMailContent) @api @kmail-api @kmail @security', () => {
  test.skip(kmailAuthGate() !== undefined, kmailAuthGate() ?? '');
  test.skip(process.env.KMAIL_LIFECYCLE !== 'true', 'sends a real mail; set KMAIL_LIFECYCLE=true');

  test('an outsider cannot read the body of a mail they did not send or receive', async ({
    endpoints,
  }) => {
    const marker = `QA-SECRET-CONTENT-${Date.now()}`;
    const subject = `QA IDOR content proof ${Date.now()}`;
    let transactionIDs: number[] = [];
    let kmailId: number | undefined;

    try {
      // --- Setup: A sends a real mail to B, with a unique, identifiable body -------------------
      const sent = await endpoints.sendTo(
        'kmail-post-mail',
        {
          body: mailShape({
            toAddress: B.username,
            kmailSubject: subject,
            kmailContent: marker,
          }),
        },
        { label: 'idor:content-send', auth: { principal: A }, allowLiveWrite: true },
      );
      expect(sent.status, 'the mail is sent').toBeLessThan(300);
      const sentJson = sent.json();
      const sentBody = (sentJson.ok ? sentJson.value : {}) as Record<string, unknown>;
      const row = Array.isArray(sentBody.data)
        ? (sentBody.data[0] as Record<string, unknown>)
        : sentBody.data;
      kmailId = Number((row as Record<string, unknown> | undefined)?.kmailID);
      const txns = (row as Record<string, unknown> | undefined)?.kmailTransactionList;
      transactionIDs = Array.isArray(txns)
        ? (txns as Array<Record<string, unknown>>)
            .map((t) => t.transactionID)
            .filter((v): v is number => typeof v === 'number')
        : [];

      test.skip(
        !kmailId || Number.isNaN(kmailId),
        `kmail-post-mail did not return a kmailID (${sent.status})`,
      );

      // A short settle before the attack: the mail's content appears to be written to its store
      // (likely MongoDB, per source) asynchronously after the send API itself returns 200 — reading
      // too immediately after send intermittently finds nothing yet, which would read as a false
      // negative here, not as the endpoint being safe.
      await new Promise((resolve) => setTimeout(resolve, 5_000));

      // --- Attack: C, who never sent or received this mail, reads it by kmailID alone ----------
      const attack = await endpoints.sendTo(
        'kmail-mail-content',
        {
          body: {
            kmailID: kmailId,
            kmailNumber: 0,
            kmailType: 'Sent',
            selectedContact: B.username,
            groupFlag: false,
          },
        },
        {
          label: 'idor:content-attack',
          auth: { principal: C },
          allowLiveWrite: true,
          allowLiveRead: true,
        },
      );

      const attackJson = attack.json();
      const attackText = attack.bodyText;
      const leaked = attackText.includes(marker) || attackText.includes(subject);

      if (leaked) {
        endpoints.recordBusinessRuleViolation({
          endpointId: 'kmail-mail-content',
          ruleId: 'IDOR-kmail-mail-content-by-id',
          rule:
            'A KMail message body must only be readable by its sender or receiver — an unrelated ' +
            'account must not be able to read it by kmailID alone.',
          expected: "the outsider's response must not contain the real mail content/subject",
          actual:
            `status=${attack.status}, response body contains the secret marker and/or subject — ` +
            `${C.username} (no relationship to this mail) successfully read a mail ${A.username} sent ` +
            `to ${B.username}, kmailID ${kmailId}`,
          request: { body: { kmailID: kmailId } },
        });
      }

      expect
        .soft(
          leaked,
          `BOLA: an outsider must not read the body of a mail they did not send or receive ` +
            `(kmail-mail-content replied ${attack.status}, ok=${attackJson.ok})`,
        )
        .toBe(false);
    } finally {
      // Cleanup: the owner deletes their own mail so nothing is left dangling.
      if (transactionIDs.length) {
        await endpoints
          .sendTo(
            'kmail-delete',
            { body: { groupFlag: false, transactionIDs } },
            { label: 'idor:content-cleanup', auth: { principal: A }, allowLiveWrite: true },
          )
          .catch(() => undefined);
      }
    }
  });
});
