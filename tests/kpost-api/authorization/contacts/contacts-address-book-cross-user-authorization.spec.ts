import { AUTH_PROFILES } from '@config/auth-profile';
import type { Principal } from '@config/auth.config';
import type { EndpointExecutor } from '@engine/endpoint-executor';
import { expect, test } from '@fixtures';
import { retryOrSkip } from '../../../support/live-condition';

/**
 * Address-book writes name the contact (`contactID`), not a record id, and every row is meant to be
 * keyed by (caller, contactID) (ContactsDirectoryDaoImpl.java:115-190, 573-605). Proven live: A keeps
 * B as a contact; C adds B, gives B a nickname, blocks and unblocks B (one and many), and deletes B,
 * all on C's own address book. After every step A's entry for B must be exactly as before, and A's
 * digital card of B must never carry C's nickname. Both address books are put back as they were.
 */
const P = AUTH_PROFILES.kpost.principals;
const A = P.find((p) => p.key === 'personal'); // the bystander whose entry must not move
const B = P.find((p) => p.key === 'victim'); // the contact both of them name
const C = P.find((p) => p.key === 'personal-3'); // the one writing
const nickname = `QA xuser nick ${Date.now()}`;

interface Row {
  contactID?: string;
  firstName?: string;
  lastName?: string;
  referenceName?: string | null;
  userType?: string;
  isBlocked?: boolean;
  deleteStatus?: boolean;
}

/** `who`'s live entry for B, or undefined. Only a 200 is evidence (a failed read retries/skips). */
async function entry(
  endpoints: EndpointExecutor,
  who: Principal,
  label: string,
): Promise<Row | undefined> {
  const read = () =>
    endpoints.sendTo(
      'contacts-my-contacts',
      { body: { lastfetchDate: null } },
      { label: `xuser-contacts:${label}`, auth: { principal: who }, allowLiveRead: true },
    );
  let ex = await read();
  if (ex.status === 401) {
    endpoints.tokens.forget(who);
    ex = await read();
  }
  retryOrSkip(ex.status !== 200, `${who.key}'s address book read answered HTTP ${ex.status}`);
  const parsed = ex.json();
  const rows = ((parsed.ok ? parsed.value : {}) as { contacts_added?: Row[] }).contacts_added ?? [];
  return rows.find(
    (r) => r.contactID?.toLowerCase() === B!.username.toLowerCase() && r.deleteStatus !== true,
  );
}

const snapshot = (r: Row | undefined) => ({
  present: !!r,
  referenceName: r?.referenceName ?? null,
  isBlocked: r?.isBlocked === true,
});

const write = (
  endpoints: EndpointExecutor,
  who: Principal,
  id: string,
  body: unknown,
  label: string,
) =>
  endpoints.sendTo(
    id,
    { body },
    { label: `xuser-contacts:${label}`, auth: { principal: who }, allowLiveWrite: true },
  );

const asContact = (row?: Row) => ({
  contactID: B!.username,
  firstName: row?.firstName ?? 'Qa',
  lastName: row?.lastName ?? 'Tester',
  userType: row?.userType ?? 'PERSONAL',
  ...(row?.referenceName ? { referenceName: row.referenceName } : {}),
});

test.describe(
  'KPost Security · an address-book change stays in the caller’s own address book @api @kpost-api @security @contacts',
  {
    tag: ['@api', '@contacts', '@security', '@regression'],
    annotation: [{ type: 'non-functional', description: 'security' }],
  },
  () => {
    test.describe.configure({ timeout: 180_000 });
    test.skip(!A || !B || !C, 'needs the personal, victim and personal-3 principals');
    test.skip(
      process.env.CONTACTS_LIFECYCLE !== 'true',
      'writes to two address books (restored afterwards); set CONTACTS_LIFECYCLE=true',
    );

    test("another user's add, nickname, block and delete of the same contact never change mine @api @kpost-api @security", async ({
      endpoints,
    }) => {
      const originalA = await entry(endpoints, A!, 'a-before');
      const originalC = await entry(endpoints, C!, 'c-before');
      let addedForA = false;
      try {
        if (!originalA) {
          const added = await write(endpoints, A!, 'contacts-add', asContact(), 'a-setup-add');
          expect(added.status, 'A adds B (setup)').toBeLessThan(300);
          addedForA = true;
        }
        const baseline = snapshot(await entry(endpoints, A!, 'a-baseline'));
        expect(baseline.present, 'control: B is in A’s address book').toBe(true);
        if (originalC)
          await write(
            endpoints,
            C!,
            'contacts-delete',
            { contactID: B!.username },
            'c-setup-delete',
          );

        const steps: Array<[string, string, unknown]> = [
          ['add', 'contacts-add', asContact()],
          [
            'nickname',
            'contacts-add-reference',
            { contactID: B!.username, referenceName: nickname },
          ],
          ['block', 'contacts-block', { contactID: B!.username, isBlocked: true }],
          [
            'unblock many',
            'contacts-block-multiple',
            { contactIDs: [B!.username], isBlocked: false },
          ],
          ['block many', 'contacts-block-multiple', { contactIDs: [B!.username], isBlocked: true }],
          ['delete', 'contacts-delete', { contactID: B!.username }],
          ['add many', 'contacts-add-multiple', [asContact()]],
        ];
        // The digital card's nickname is the viewer's own (UserProfileServiceImpl.java:309-338).
        const checkCard = async (): Promise<void> => {
          const card = { contactID: B!.username, userType: 'KnownContacts' };
          const read = (who: Principal, label: string) =>
            endpoints.sendTo(
              'profile-digital-card',
              { body: card },
              {
                label: `xuser-contacts:${label}`,
                auth: { principal: who },
                allowLiveRead: true,
              },
            );
          const forC = await read(C!, 'card-c');
          const forA = await read(A!, 'card-a');
          if (forC.status >= 300 || !forC.bodyText?.includes(nickname))
            test.info().annotations.push({
              type: 'not-judged',
              description: `digital card: C's own card of B (HTTP ${forC.status}) does not show C's nickname, so A's card proves nothing`,
            });
          else {
            const leaked = forA.bodyText?.includes(nickname) === true;
            if (leaked)
              endpoints.recordBusinessRuleViolation({
                endpointId: 'profile-digital-card',
                ruleId: 'IDOR-profile-digital-card-foreign-nickname',
                rule: "A digital card shows the viewer's own nickname for the contact, never another user's.",
                expected: `${A!.username}'s card of ${B!.username} without ${C!.username}'s nickname`,
                actual: `HTTP ${forA.status}: it carried "${nickname}"`,
                request: { body: card },
                correlationId: forA.correlationId,
              });
            expect.soft(leaked, "A's digital card of B must not carry C's nickname").toBe(false);
          }
        };
        for (const [step, id, body] of steps) {
          const own = await write(endpoints, C!, id, body, `c-${step.replace(/\W+/g, '-')}`);
          expect.soft(own.status, `C's ${step} answers without a server error`).toBeLessThan(500);
          // Right after the nickname is set, while C's entry still carries it.
          if (step === 'nickname' && own.status < 300) await checkCard();
          const now = snapshot(await entry(endpoints, A!, `a-after-${step.replace(/\W+/g, '-')}`));
          const moved = JSON.stringify(now) !== JSON.stringify(baseline);
          if (moved)
            endpoints.recordBusinessRuleViolation({
              endpointId: id,
              ruleId: `IDOR-${id}-other-address-book`,
              rule: "An address-book change acts on the caller's own entry for the contact only.",
              expected: `${A!.username}'s entry for ${B!.username} stays ${JSON.stringify(baseline)}`,
              actual: `after ${C!.username}'s ${step} (HTTP ${own.status}) it is ${JSON.stringify(now)}`,
              request: { body },
              correlationId: own.correlationId,
            });
          expect.soft(moved, `C's ${step} must not change A's entry for B`).toBe(false);
        }
      } finally {
        // C's address book back as it was (or without B), then A's.
        await write(
          endpoints,
          C!,
          'contacts-delete',
          { contactID: B!.username },
          'c-restore-delete',
        ).catch(() => undefined);
        if (originalC) {
          await write(endpoints, C!, 'contacts-add', asContact(originalC), 'c-restore-add').catch(
            () => undefined,
          );
          if (originalC.referenceName)
            await write(
              endpoints,
              C!,
              'contacts-add-reference',
              { contactID: B!.username, referenceName: originalC.referenceName },
              'c-restore-nickname',
            ).catch(() => undefined);
          if (originalC.isBlocked)
            await write(
              endpoints,
              C!,
              'contacts-block',
              { contactID: B!.username, isBlocked: true },
              'c-restore-block',
            ).catch(() => undefined);
        }
        if (addedForA)
          await write(
            endpoints,
            A!,
            'contacts-delete',
            { contactID: B!.username },
            'a-restore-delete',
          ).catch(() => undefined);
      }
    });
  },
);
