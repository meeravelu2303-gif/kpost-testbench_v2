import { defineArtifact } from '../artifact';
import type { FlowDefinition } from '../flow';

/**
 * Katchup 1-to-1 message lifecycle — the Phase 2B proof-of-concept flow.
 *
 * ## What this proves
 *
 * That a business flow can be described as data: ordered steps, named roles, a value produced by one
 * step and explicitly consumed by later ones, and a requirement reference that carries no text. It
 * replaces nothing — `tests/api/kpost/katchup/feature.spec.ts` and the UI specs are untouched and
 * continue to run exactly as before.
 *
 * ## Two steps have no execution binding, and that is the point
 *
 * Phase 2A established that the read receipt (FR-K07) is verified nowhere: the API spec asserts only
 * `expect.soft(receipts.status).toBe(200)` and defers the real check to the UI, while the UI spec
 * defers it back to the API. Inspecting the registry shows why neither could do better:
 *
 *  - there is **no endpoint that marks a 1:1 message read** — opening the conversation is the only
 *    thing the client does, so "recipient reads" has no call of its own; and
 *  - there is **no 1:1 read-receipt endpoint at all**. `katchup-read-status-group` is group-only
 *    (`src/api/definitions/kpost/katchup/read.api.ts:153`, "Per-recipient read receipts for a group
 *    message"), and `katchup-unopened-count` is a caller-scoped unread count, not a per-message
 *    receipt.
 *
 * Rather than invent an endpoint or quietly drop the steps, both are declared with an
 * `unboundReason`. The business flow stays complete and truthful, and the gap becomes a
 * machine-readable fact a guard can report instead of an absence nobody notices.
 */

/** The msgID the send returns — the value the whole downstream flow depends on. */
export const MESSAGE_ID = defineArtifact<number>(
  'messageId',
  'the msgID the Katchup send endpoint returned for the message under test',
);

/**
 * A marker unique to this run, used to recognise the message in a conversation body.
 *
 * Produced by the same step as the id because it is chosen when the message is composed; it is what
 * the existing specs already use (`QA recall ${Date.now()}`) to find the message in a text body.
 */
export const MESSAGE_MARKER = defineArtifact<string>(
  'messageMarker',
  'the unique text placed in the message body so it can be recognised in a conversation',
);

export const KATCHUP_MESSAGE_1TO1_FLOW: FlowDefinition = {
  flowId: 'katchup.message-1to1-lifecycle',
  name: 'Katchup 1-to-1 message lifecycle',
  module: 'katchup',
  /*
   * Ids only — never text. Both resolve in the Phase 1 registry: FR-KU-003 is the send requirement
   * carried by `katchup-send-message`, and FR-K07 is the read-receipt/unread id, which Phase 1
   * records as SUPERSEDED with no successor (the per-module FRDs define no equivalent). Referencing
   * a superseded id is deliberate and honest: it is the id this behaviour actually has.
   */
  requirementIds: ['FR-KU-003', 'FR-K07'],
  actorRoles: ['sender', 'recipient'],
  cleanupStrategy: 'ledger-managed',
  status: 'ACTIVE',
  description:
    'Actor A sends a 1:1 Katchup message to Actor B; B observes and reads it; A observes the read ' +
    'receipt. The last two steps have no execution binding in this repository — see the file header.',
  steps: [
    {
      stepId: 'authenticate-sender',
      name: 'the sender is authenticated',
      actor: 'sender',
      action: 'auth.login',
      phase: 'precondition',
      bindings: [{ channel: 'API', endpointId: 'signup-login-user-login' }],
    },
    {
      stepId: 'authenticate-recipient',
      name: 'the recipient is authenticated',
      actor: 'recipient',
      action: 'auth.login',
      phase: 'precondition',
      /*
       * The recipient must be a SESSION actor, not merely a name in a payload: the flow requires B
       * to observe, which needs B's own token. The existing account pool already distinguishes
       * `session | reference | mutable`; binding roles to accounts is the Actor model's job.
       */
      bindings: [{ channel: 'API', endpointId: 'signup-login-user-login' }],
    },
    {
      stepId: 'send-message',
      name: 'the sender sends a message to the recipient',
      actor: 'sender',
      action: 'katchup.send-message',
      phase: 'action',
      produces: [MESSAGE_ID, MESSAGE_MARKER],
      bindings: [
        { channel: 'API', endpointId: 'katchup-send-message' },
        { channel: 'UI', helper: 'tests/e2e/support/katchup.ts#sendMessage' },
      ],
    },
    {
      stepId: 'recipient-observes-message',
      name: 'the recipient sees the message in the conversation',
      actor: 'recipient',
      action: 'katchup.read-conversation',
      phase: 'action',
      consumes: [MESSAGE_ID, MESSAGE_MARKER],
      bindings: [
        { channel: 'API', endpointId: 'katchup-conversation' },
        { channel: 'UI', helper: 'tests/e2e/support/katchup.ts#openReceivedConversation' },
      ],
    },
    {
      stepId: 'recipient-reads-message',
      name: 'the recipient opens the message, marking it read',
      actor: 'recipient',
      action: 'katchup.read-message',
      phase: 'action',
      consumes: [MESSAGE_ID],
      unboundReason:
        'No endpoint marks a 1:1 Katchup message read. The web client marks a thread read as a ' +
        'side effect of opening the conversation, so there is no call to bind. Binding this step ' +
        'needs either a documented mark-read endpoint or a UI adapter that opens the thread and ' +
        'can evidence the resulting state change.',
    },
    {
      stepId: 'sender-observes-read-receipt',
      name: 'the sender sees the read receipt for that message',
      actor: 'sender',
      action: 'katchup.read-receipt',
      phase: 'action',
      consumes: [MESSAGE_ID],
      unboundReason:
        'No 1:1 read-receipt endpoint is registered. katchup-read-status-group is group-only and ' +
        'katchup-unopened-count is a caller-scoped unread count, not a per-message receipt. This is ' +
        'the FR-K07 gap Phase 2A identified: the API spec defers the check to the UI and the UI ' +
        'spec defers it back, because neither surface has a call that answers it.',
    },
  ],
};
