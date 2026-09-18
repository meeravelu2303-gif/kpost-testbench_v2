import { KATCHUP_MESSAGE_TYPE } from '@api/schemas/kpost-types';
import { testData } from '@config/test-data.config';
import { body } from '../kpost-endpoint';
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
 * `{msgID, status:5}` — see `docs/katchup-flow.md` §2.1.
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
  request: body(() => ({ groupKpostID: testData.victimKpostId, msgIDs: [], groupFlag: false })),
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
 */
export const forwardMessageApi = defineKatchupEndpoint({
  id: 'katchup-forward-message',
  requirements: ['FR-KU-035'],
  method: 'POST',
  path: '/v2/katchup/forwardKatchupMessage/',
  summary: 'Forward a message (reveal sender)',
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
  deleteMessageApi,
  markImportantApi,
  saveMessagesApi,
  reportAbuseApi,
  forwardMessageApi,
  forwardMessageNewApi,
  forwardMultipleApi,
  forwardBacktrackApi,
];
