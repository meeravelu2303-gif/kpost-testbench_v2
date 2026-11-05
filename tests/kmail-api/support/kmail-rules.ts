import { AUTH_PROFILES } from '@config/auth-profile';
import type { Principal } from '@config/auth.config';
import { mailShape } from '@api/definitions/kmail/send.api';
import type { EndpointExecutor } from '@engine/endpoint-executor';

/**
 * Shared helpers for the KMail validation specs (`tests/kmail-api/business-rules/kmail-*-business-rules.spec.ts`):
 * one call wrapper, a send that returns the new kmailID, the sender's thread row for a mail (with
 * its per-recipient transactions) and a cleanup that deletes a mail from every side that holds it.
 * Every address is one of our own QA accounts.
 */

const principal = (key: string): Principal =>
  AUTH_PROFILES.kpost.principals.find((p) => p.key === key)!;

export const A = principal('personal'); // sender
export const B = principal('victim'); // To recipient
export const C = principal('personal-3'); // Cc recipient

export interface Reply {
  status: number;
  json: Record<string, unknown>;
  text: string;
}

export interface Txn {
  transactionID: number;
  receiver: string;
  receiverType: number;
  deleteBySender?: string;
}

export interface MailRow {
  kmailID: number;
  kmailSubject?: string;
  priority?: number;
  kmailTransactionList: Txn[];
}

/** One call as `who`, cleared for a live write and a read-back of an id this flow minted. */
export async function call(
  endpoints: EndpointExecutor,
  id: string,
  who: Principal,
  body: Record<string, unknown> | undefined,
  label: string,
  ownedIdentifiers: string[] = [],
): Promise<Reply> {
  const ex = await endpoints.sendTo(id, body === undefined ? {} : { body }, {
    label,
    auth: { principal: who },
    allowLiveRead: true,
    allowLiveWrite: true,
    ownedIdentifiers,
  });
  const parsed = ex.json();
  return {
    status: ex.status,
    json: (parsed.ok && parsed.value && typeof parsed.value === 'object'
      ? parsed.value
      : {}) as Record<string, unknown>,
    text: ex.bodyText ?? '',
  };
}

/** The first `data` row of a reply (postMail answers a list, draftMail an object). */
export function firstRow(reply: Reply): Record<string, unknown> {
  const data = reply.json.data;
  if (Array.isArray(data)) return (data[0] as Record<string, unknown>) ?? {};
  return (data as Record<string, unknown>) ?? {};
}

export interface Sent {
  reply: Reply;
  kmailID?: number;
  body: Record<string, unknown>;
}

/** A's postMail with the live client's body and `overrides`; the kmailID when one was issued. */
export async function sendMail(
  endpoints: EndpointExecutor,
  overrides: Record<string, unknown>,
  label: string,
  ownedIdentifiers: string[] = [],
): Promise<Sent> {
  const body = mailShape({ toAddress: B.username, ...overrides });
  const reply = await call(endpoints, 'kmail-post-mail', A, body, label, ownedIdentifiers);
  const id = firstRow(reply).kmailID;
  return { reply, kmailID: typeof id === 'number' && id > 0 ? id : undefined, body };
}

/** The mail `kmailID` as `who` sees it in their thread with `other` (undefined when absent). */
export async function threadRow(
  endpoints: EndpointExecutor,
  who: Principal,
  other: string,
  kmailID: number,
  ownedIdentifiers: string[] = [],
): Promise<MailRow | undefined> {
  const r = await call(
    endpoints,
    'kmail-selected-contact-mails',
    who,
    {
      selectedContact: other,
      fetchMailType: 'A',
      groupFlag: false,
      lastKmailID: null,
      firstKmailID: null,
      count: 30,
    },
    'kmail-rules:thread',
    ownedIdentifiers,
  );
  return ((r.json.data as MailRow[] | undefined) ?? []).find((m) => m.kmailID === kmailID);
}

/**
 * Deletes a sent mail from the sender's side and from each recipient's own side, so nothing is left
 * in any QA mailbox. Never throws: cleanup must not hide the test's own result.
 */
export async function deleteEverywhere(
  endpoints: EndpointExecutor,
  kmailID: number | undefined,
  recipients: Principal[] = [B],
  other: string = B.username,
  ownedIdentifiers: string[] = [],
): Promise<void> {
  if (!kmailID) return;
  const row = await threadRow(endpoints, A, other, kmailID, ownedIdentifiers).catch(
    () => undefined,
  );
  const txns = row?.kmailTransactionList ?? [];
  const del = (who: Principal, ids: number[]) =>
    ids.length
      ? call(
          endpoints,
          'kmail-delete',
          who,
          { groupFlag: false, transactionIDs: ids },
          'kmail-rules:cleanup',
        ).catch(() => undefined)
      : Promise.resolve(undefined);
  await del(
    A,
    txns.map((t) => t.transactionID),
  );
  for (const r of recipients) {
    await del(
      r,
      txns
        .filter((t) => t.receiver.toLowerCase() === r.username.toLowerCase())
        .map((t) => t.transactionID),
    );
  }
}

/** A marker unique to this run, so a leftover from an earlier run can never match. */
export const marker = (what: string): string =>
  `QA ${what} ${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
