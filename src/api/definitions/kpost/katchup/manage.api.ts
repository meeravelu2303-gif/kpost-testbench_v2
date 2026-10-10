import { KATCHUP_MESSAGE_TYPE } from '@api/schemas/kpost-types';
import { testData } from '@config/test-data.config';
import { body, defineUndocumentedKpostEndpoint } from '../kpost-endpoint';
import { defineKatchupEndpoint } from './katchup-endpoint';

/**
 * Katchup **message actions** — recall, delete, mark, report, and the forwards.
 *
 * Every one acts on a `msgID` that must be a real message the caller owns. On live we have no such
 * id until the send-lifecycle test has created one, and a fabricated id would 404 or (worse) name a
 * stranger's message. So these are `needs-message-id`, registered and blocked, run by the lifecycle
 * test once it has minted an id. None is `productionSafe`: they all mutate.
 *
 * `recallMessage` follows the **live client** (`{msgID, groupFlag}`), not the workbook's stale
 * `{msgID, status:5}` — see `docs/modules/katchup-flow.md` §2.1.
 */
const MANAGE_TAGS = ['katchup-manage'] as const;

export const recallMessageApi = defineKatchupEndpoint({
  id: 'katchup-recall-message',
  requirements: ['FR-KU-028', 'FR-KU-028'],
  method: 'POST',
  path: '/v2/katchup/recallMessage/',
  summary: "Recall a sent message, removing it from the recipient's view",
  tags: [...MANAGE_TAGS, 'sender-action', 'needs-message-id'],
  destructive: true,
  sideEffect: 'data',
  // Live client payload, not the workbook's {msgID, status:5}.
  request: body(() => ({ msgID: 0, groupFlag: false })),
  note: 'live-client payload {msgID, groupFlag}; needs a real owned msgID',
});

/*
 * Legacy "V1" twin of recallMessageApi — confirmed dead from the real frontend (EndPointURL already
 * bakes in /v2, so every live call resolves to KatchupControllerV2, never this bare "katchup" path)
 * but still deployed. KatchupController.recallMessage (KatchupController.java, no HttpServletRequest
 * parameter AT ALL) passes the client-supplied FetchKatchupRO straight to
 * KatchupServiceImpl.recallMessage, which matches purely on the body's own `sender` field
 * (katchupRepo.recallKatchupMessage(msgID, sender, status)) — unlike its V2 sibling, which
 * correctly overrides sender from the JWT (`fetchKatchupRO.setSender((String)
 * request.getAttribute("kpostID"))`, KatchupControllerV2.java:741) before calling the identical
 * service method. Registered here only to prove/track the live cross-account message-tampering
 * gap — never driven as a normal client flow.
 */
// Not in the generated OpenAPI contract at all (it's a dead V1 path, never documented in the
// workbook) — defineKatchupEndpoint's workbookContract() lookup throws at module-load time for any
// path the contract doesn't know, which previously crashed every spec that imports this module.
// defineUndocumentedKpostEndpoint skips that lookup; it's normally used for real-but-undocumented
// frontend calls, but its only actual requirement is a path the generated contract doesn't have, so
// it's the correct escape valve here too.
export const legacyRecallMessageApi = defineUndocumentedKpostEndpoint({
  id: 'katchup-legacy-recall-message',
  method: 'POST',
  path: '/katchup/recallMessage',
  summary:
    '[LEGACY/dead-from-frontend] Recall a message by msgID+sender taken straight from the body',
  tags: ['katchup', ...MANAGE_TAGS, 'legacy', 'needs-message-id'],
  authentication: { required: true },
  destructive: true,
  sideEffect: 'data',
  request: body(() => ({ msgID: 0, sender: '', groupFlag: false })),
  evidence:
    'KatchupController.recallMessage (KatchupController.java) — confirmed zero frontend callers 2026-10-05; no HttpServletRequest param at all in the controller, sender is trusted from the body',
});

export const deleteMessageApi = defineKatchupEndpoint({
  id: 'katchup-delete-message',
  requirements: ['FR-KU-042'],
  method: 'POST',
  path: '/v2/katchup/deleteKatchUpMessage/',
  summary: 'Delete a sent message',
  tags: [...MANAGE_TAGS, 'sender-action', 'needs-message-id'],
  destructive: true,
  sideEffect: 'data',
  // Live client (Katchup.js DeleteMessage): the field is `messageIds` (an ARRAY), not `msgID`.
  // Sending `msgID` is the wrong shape and can leave the message undeleted (orphan). Verified
  // against the frontend, 2026-09-18. The lifecycle test supplies the real msgID it created.
  request: body(() => ({ messageIds: [0], groupFlag: false })),
  note: 'live-client payload {messageIds:[...], groupFlag}; needs a real owned msgID',
});

export const markImportantApi = defineKatchupEndpoint({
  id: 'katchup-mark-important',
  method: 'POST',
  path: '/v2/katchup/markOrUnmarkImportantMessage/',
  summary: 'Mark or unmark a message as important',
  tags: [...MANAGE_TAGS, 'needs-message-id'],
  destructive: true,
  sideEffect: 'data',
  request: body(() => ({ msgID: 0, groupFlag: false })),
  note: 'needs a real owned msgID',
});

export const saveMessagesApi = defineKatchupEndpoint({
  id: 'katchup-save-messages',
  requirements: ['FR-KU-040'],
  method: 'POST',
  path: '/v2/katchup/saveKatchupMessages/',
  summary: 'Save (bookmark) one or more messages',
  tags: [...MANAGE_TAGS, 'sender-action', 'needs-message-id'],
  destructive: true,
  sideEffect: 'data',
  // groupFlag is a STRING here (see send.api.ts's groupFlag comment) — a real boolean 400s
  // "Malformed or missing request body", live-verified 2026-09-25 (feature.spec.ts).
  request: body(() => ({ groupKpostID: testData.victimKpostId, msgIDs: [], groupFlag: 'false' })),
  note: 'needs real owned msgIDs',
});

export const reportAbuseApi = defineKatchupEndpoint({
  id: 'katchup-report-abuse',
  requirements: ['FR-KU-047'],
  method: 'POST',
  path: '/v2/katchup/reportAbuse',
  summary: 'Report a received message as abusive',
  tags: [...MANAGE_TAGS, 'recipient-action', 'needs-message-id'],
  /*
   * Reports a message to moderation — a real, visible action that names a msgID and a reason set.
   * `reportingKpostID` is our own account. Needs a real received message; blocked until one exists.
   */
  destructive: true,
  sideEffect: 'data',
  request: body(() => ({
    reportingKpostID: testData.kpostId,
    msgID: 0,
    reportID: [1],
    reason: 'QA bench test report',
  })),
  note: 'needs a real received msgID',
});

/*
 * ## Forwards — all need a source message id
 *
 * `/v2/katchup/forwardKatchupMessage/` (the older path) is confirmed unused by the current client —
 * only `forwardKatchupMessageNew` is live. Its endpoint definition, the tests that exercised it, and
 * its filed bugs were retired 2026-09-28 rather than kept testing a dead route.
 */
export const forwardMessageNewApi = defineKatchupEndpoint({
  id: 'katchup-forward-message-new',
  requirements: ['FR-KU-035', 'FR-KU-037'],
  method: 'POST',
  path: '/v2/katchup/forwardKatchupMessageNew',
  summary: 'Forward a message (newer path, reveal/hidden)',
  tags: [...MANAGE_TAGS, 'forward', 'needs-message-id'],
  destructive: true,
  sideEffect: 'data',
  request: body(() => ({
    receiver: testData.victimKpostId,
    messageType: KATCHUP_MESSAGE_TYPE.forwardMessageReveal,
    subject: 'QA Bench',
    actualMessage: 'QA bench forward.',
  })),
  note: 'needs a source message to forward',
});

export const forwardMultipleApi = defineKatchupEndpoint({
  id: 'katchup-forward-multiple',
  requirements: ['FR-KU-037'],
  method: 'POST',
  path: '/v2/katchup/forwardKatchupMultipleMsgs',
  summary: 'Forward several messages at once',
  tags: [...MANAGE_TAGS, 'forward', 'needs-message-id'],
  destructive: true,
  sideEffect: 'data',
  request: body(() => ({ forwardReceiverList: [testData.victimKpostId], groupForwardList: [] })),
  note: 'needs source messages to forward',
});

export const forwardBacktrackApi = defineKatchupEndpoint({
  id: 'katchup-forward-backtrack',
  method: 'POST',
  path: '/v2/katchup/forwardMessageBacktrackByMsgID',
  summary: 'Trace a forwarded message back to its origin',
  tags: [...MANAGE_TAGS, 'forward', 'thread', 'needs-message-id'],
  // A read despite the module — no write — but keyed by a real forwarded msgID.
  destructive: false,
  request: body(() => ({ msgID: 0 })),
  note: 'needs a real forwarded msgID',
});

export const katchupManageApis = [
  recallMessageApi,
  legacyRecallMessageApi,
  deleteMessageApi,
  markImportantApi,
  saveMessagesApi,
  reportAbuseApi,
  forwardMessageNewApi,
  forwardMultipleApi,
  forwardBacktrackApi,
];
