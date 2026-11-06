import type { ApiResponseWrapper } from '@api/client/response-wrapper';
import { sendShape } from '@api/definitions/kpost/katchup/send.api';
import type { Principal } from '@config/auth.config';
import type { EndpointExecutor } from '@engine/endpoint-executor';
import { FILES, uniqueName } from '@fixtures/files';
import { expect } from '@fixtures';
import { uploadFile, type Uploaded } from './attachments';

/**
 * Katchup helpers for the cross-user authorization specs: real 1:1 messages between QA accounts,
 * read back and removed again. (katchup-cross-user-authorization.spec.ts keeps its own copies.)
 */

export type Row = Record<string, unknown>;

/** `data` of a Katchup answer as rows (an object becomes one row). */
export function rowsOf(exchange: ApiResponseWrapper): Row[] {
  const parsed = exchange.json();
  const data = parsed.ok ? (parsed.value as { data?: unknown }).data : undefined;
  return (Array.isArray(data) ? data : data ? [data] : []) as Row[];
}

export const msgIDsOf = (rows: Row[]): number[] =>
  rows.map((r) => Number(r.msgID)).filter((id) => Number.isFinite(id) && id > 0);

/** The served body is exactly the uploaded file. */
export const sameBytes = (exchange: ApiResponseWrapper, up: Uploaded): boolean =>
  exchange.status > 0 &&
  exchange.status < 300 &&
  (exchange.bodyDigest?.sha256 === up.sha256 || exchange.bodyText === up.bytes.toString('utf8'));

/** `from` sends `to` a plain 1:1 message; its msgIDs (empty when the send failed). */
export async function sendText(
  endpoints: EndpointExecutor,
  from: Principal,
  to: Principal,
  subject: string,
  text: string,
  label: string,
): Promise<number[]> {
  const sent = await endpoints.sendTo(
    'katchup-send-message',
    { body: sendShape({ receiver: to.username, subject, actualMessage: text }) },
    { label: `${label}:send`, auth: { principal: from }, allowLiveWrite: true },
  );
  expect(sent.status, `${from.key} sends ${to.key} a message (setup)`).toBeLessThan(300);
  return msgIDsOf(rowsOf(sent));
}

/** `from` uploads a small text file (live S3, under the 64 KB cap) and sends it to `to`. */
export async function sendAttachment(
  endpoints: EndpointExecutor,
  from: Principal,
  to: Principal,
  tag: string,
): Promise<{ up: Uploaded; msgIDs: number[] }> {
  const up = await uploadFile(endpoints, from, FILES.txt, {
    route: 'katchup',
    name: uniqueName(FILES.txt, tag),
    label: `${tag}:presign`,
  });
  const sent = await endpoints.sendTo(
    'katchup-send-message',
    {
      body: sendShape({
        receiver: to.username,
        subject: 'QA cross-user attachment',
        uuid: [up.uuid],
      }),
    },
    {
      label: `${tag}:send`,
      auth: { principal: from },
      allowLiveWrite: true,
      ownedIdentifiers: [up.uuid],
    },
  );
  expect(sent.status, `${from.key} sends ${to.key} the attachment (setup)`).toBeLessThan(300);
  return { up, msgIDs: msgIDsOf(rowsOf(sent)) };
}

/** Deletes messages for `as` (best effort; cleanup). */
export async function deleteMessages(
  endpoints: EndpointExecutor,
  as: Principal,
  msgIDs: readonly number[],
  label: string,
): Promise<void> {
  for (const msgID of msgIDs)
    await endpoints
      .sendTo(
        'katchup-delete-message',
        { body: { messageIds: [msgID], groupFlag: false } },
        { label, auth: { principal: as }, allowLiveWrite: true, ownedIdentifiers: [msgID] },
      )
      .catch(() => undefined);
}

/** `who`'s latest page of the 1:1 conversation with `other`, as raw text (empty on failure). */
export async function conversationText(
  endpoints: EndpointExecutor,
  who: Principal,
  other: Principal,
  label: string,
): Promise<{ status: number; text: string; msgIDs: number[] }> {
  const ex = await endpoints.sendTo(
    'katchup-conversation',
    { body: { groupFlag: false, firstMsgID: null, lastMsgID: null, receiver: other.username } },
    { label, auth: { principal: who }, allowLiveRead: true },
  );
  return { status: ex.status, text: ex.bodyText ?? '', msgIDs: msgIDsOf(rowsOf(ex)) };
}
