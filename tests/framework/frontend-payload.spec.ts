import { apiRegistry } from '@api/definitions/index';
import type { EndpointDefinition } from '@api/registry/endpoint-definition';
import type { RequestFactoryHelpers } from '@api/registry/endpoint-definition';
import type { RequestSpec } from '@api/client/request-builder';
import { expect, test } from '@fixtures';

/**
 * Frontend-verified payload guard — the answer to "is the body correct when the workbook has NO
 * example to check against?".
 *
 * `payload-audit.spec.ts` compares each request to the workbook's documented *example*, so it cannot
 * see an endpoint the workbook documents no body for. Those bodies are built from the authoritative
 * source — the real KPost / KMail frontend (`D:\KPOST_PROJECTS\KPOST_REACTJS_2023_V1`, and the KMail
 * UI inside it) and, where the frontend does not call the route, the backend controller/DTO. This
 * guard pins the field set that source review established (2026-09-18), so a later edit that drops or
 * renames a field — the exact regression that files a false bug (e.g. sending `msgID` where the app
 * sends `messageIds`, or omitting `selectedContact` and tripping the backend's unguarded
 * `selectedContact.toLowerCase()` NPE) — fails the build instead of shipping.
 *
 * Each entry is the MINIMUM set of top-level fields the real client sends. The bench may send more
 * (a superset is fine); it may never send fewer or a differently-named field.
 */

// Same static stub as payload-audit: these factories never chain to a live call.
const STUB: RequestFactoryHelpers = {
  call: (() => Promise.resolve({})) as RequestFactoryHelpers['call'],
  tenantId: 'qa-audit',
};

/**
 * endpoint id -> the exact top-level fields the authoritative client sends. Verified against the
 * frontend service layer (and, for the two routes the frontend never calls, the KMail backend DTO).
 */
const FRONTEND_VERIFIED: Record<string, string[]> = {
  // --- KMail (KPost React app's KMail UI + KMail backend controllers) ---
  // Kmail.js getKmailChat / KmailMessage.fetchMail — thread paging fields.
  'kmail-selected-contact-mails': [
    'selectedContact',
    'fetchMailType',
    'groupFlag',
    'lastKmailID',
    'firstKmailID',
    'count',
  ],
  // MessageContainer MailObj — the backend NPEs on a missing selectedContact.
  'kmail-mail-content': ['kmailID', 'kmailNumber', 'kmailType', 'selectedContact', 'groupFlag'],
  // WriteMailPage SaveDraftMailService — the compose shape reused for a draft.
  'kmail-draft-save': ['toAddress', 'kmailSubject', 'kmailContent', 'kmailSendDate', 'kmailType'],
  // CommonMailController.clearStatusOfKmailsContacts — shape "A" (all mails for a contact).
  'kmail-clear-status': ['selectedContact'],

  // --- Katchup ---
  // Katchup.js DeleteMessage — the field is `messageIds` (ARRAY), not `msgID`.
  'katchup-delete-message': ['messageIds', 'groupFlag'],
  // Katchup.js BlockContactService (also KPost core contacts).
  'contacts-block': ['contactID', 'isBlocked'],

  // --- KDiary (Diary.js) ---
  // GetDiaryScheduleBySelectedDate — start + null end.
  'kdiary-get-event-selected-date': ['scheduleStartDateAndTime', 'scheduleEndDateAndTime'],
  // AddDiaryScheduleParticipants — `eventID` SINGULAR (not the eventIds array of remarks).
  'kdiary-add-participants': ['eventID', 'participants'],
  // UpdateDiaryScheduleRemarks — eventIds is a plural ARRAY here (contrast with addparticipants).
  'kdiary-update-remarks': ['eventIds', 'remarks', 'remarksDescription'],

  // --- KOS ---
  // KOS.js CreateKWordDoc.
  'kos-create-doc': ['titleOfDocument', 'subject', 'documentType', 'convertToKad', 'initiatedBy'],
  // KOS.js GenerateAIResponse — {prompt, aiType} (chatResponse).
  'kos-ai-chat': ['prompt', 'aiType'],
  // AI_Common.js GeneratePropmt — {message, prompt, requestType} (messageAssist, NOT aiType).
  'kos-ai-assist': ['message', 'prompt', 'requestType'],
};

function multipartKeys(spec: RequestSpec): string[] {
  // Multipart carries its JSON in a `text` part — pull the parsed keys so a multipart draft counts.
  const text = spec.multipart?.text;
  return typeof text === 'string'
    ? Object.keys((JSON.parse(text) as Record<string, unknown>) ?? {})
    : [];
}

function sentKeys(spec: RequestSpec): Set<string> {
  const parts = [
    ...Object.keys((spec.body as object) ?? {}),
    ...Object.keys((spec.query as object) ?? {}),
    ...Object.keys((spec.pathParams as object) ?? {}),
    ...multipartKeys(spec),
  ];
  return new Set(parts.map((k) => k.toLowerCase()));
}

/** Builds one endpoint's request and returns a failure string, or null when it sends every field. */
async function underSend(d: EndpointDefinition, required: string[]): Promise<string | null> {
  const spec = await Promise.resolve(d.request ? d.request(STUB) : {}).catch(
    (error: unknown) => new Error((error as Error).message),
  );
  if (spec instanceof Error) return `${d.id}: request factory threw (${spec.message})`;
  const sent = sentKeys(spec);
  const absent = required.filter((f) => !sent.has(f.toLowerCase()));
  return absent.length ? `${d.id}: missing ${absent.join(', ')}` : null;
}

test.describe('frontend-verified payloads @framework', () => {
  test('every documented endpoint id in the guard still exists', () => {
    const ids = new Set(apiRegistry.all().map((d: EndpointDefinition) => d.id));
    const missing = Object.keys(FRONTEND_VERIFIED).filter((id) => !ids.has(id));
    expect(missing, 'a frontend-verified id no longer exists — update the guard').toEqual([]);
  });

  test('each endpoint sends every field the real client sends (no under-send)', async () => {
    const byId = new Map(apiRegistry.all().map((d: EndpointDefinition) => [d.id, d]));
    const checks = Object.entries(FRONTEND_VERIFIED)
      .map(([id, required]) => ({ d: byId.get(id), required }))
      .filter((c): c is { d: EndpointDefinition; required: string[] } => c.d !== undefined)
      .map((c) => underSend(c.d, c.required));
    const failures = (await Promise.all(checks)).filter((f): f is string => f !== null);

    expect(
      failures,
      'a bench payload no longer matches the authoritative frontend/backend shape — a wrong/incomplete body files a false bug; restore the field(s) or update the frontend-verified record with new evidence',
    ).toEqual([]);
  });
});
