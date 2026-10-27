import { KATCHUP_MESSAGE_TYPE } from '@api/contract/kpost-types';
import { testData } from '@config/test-data.config';
import { typesOnlySchema } from '@api/schema/sample-schema';
import { body, defineUndocumentedKpostEndpoint } from '../kpost-endpoint';
import { defineKatchupEndpoint } from './katchup-endpoint';

/**
 * Katchup message actions: recall, delete, mark, report, forward. Each needs a real `msgID` we own,
 * so they are `needs-message-id` and run by the lifecycle test. None is `productionSafe`.
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
 * Legacy V1 twin of recallMessage: unused by the frontend but deployed, and it trusts the body's
 * `sender` instead of the token. Registered only to track that cross-account gap. Not in the
 * workbook, so it is defined as undocumented to skip the contract lookup.
 */
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
  requestSchema: typesOnlySchema({ msgID: 0, sender: 'x', groupFlag: false }),
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
  // The live client sends `messageIds` (an array), not `msgID`; the lifecycle supplies the real id.
  request: body(() => ({ messageIds: [0], groupFlag: false })),
  requestSchema: typesOnlySchema({ messageIds: [0], groupFlag: false }),
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
  // groupFlag is a string here, as in send.api.ts; a real boolean 400s.
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
  // Reports a received message to moderation; `reportingKpostID` is our own account.
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

// Forwards: all need a source message id.
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

export const forwardMessageApi = defineKatchupEndpoint({
  id: 'katchup-forward-message',
  requirements: ['FR-KU-035'],
  method: 'POST',
  path: '/v2/katchup/forwardKatchupMessage/',
  summary: 'Forward a message (older path)',
  tags: [...MANAGE_TAGS, 'forward', 'needs-message-id'],
  destructive: true,
  sideEffect: 'data',
  // The workbook's example shape; the web app forwards through forwardKatchupMessageNew instead.
  request: body(() => ({
    receiver: '',
    messageType: KATCHUP_MESSAGE_TYPE.forwardMessageReveal,
    subject: 'QA Bench',
    actualMessage: 'QA bench forward (older path).',
    groupFlag: 'false',
    forwardReceiverList: [testData.victimKpostId],
    groupForwardList: null,
    groupmemberList: [],
    // The rest of the workbook example: no attachment, a fresh send, no reference or shared message.
    attachmentCaption: '[]',
    status: '0',
    sessionID: 'qa-bench',
    referenceMessage: null,
    sharedMessageDetails: null,
    sharedType: 0,
    temporaryMsgID: 0,
  })),
  note: 'needs a source message to forward; the web app never calls this older route (dead import)',
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
  forwardMessageApi,
  forwardMultipleApi,
  forwardBacktrackApi,
];
