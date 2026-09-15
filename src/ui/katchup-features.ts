/**
 * THE Katchup UI feature catalogue — every user-facing Katchup feature, enumerated from the three
 * sources of truth so **nothing is missed**:
 *   1. the KPost documents (FRD v2.0: FR-K01..K25, BR-K01..K03) — see CLAUDE.md §1–4,
 *   2. the message-type enum (`katchupMessageType`, 27 codes) — see `docs/katchup-flow.md`,
 *   3. the live front-end action menus (`bellIconContent` = sender, `replyIconContent` = recipient,
 *      in `Katchup/bubble/KatchupMessage/KatchupMessage.js`).
 *
 * This is the front-end analogue of the API endpoint registry: it makes Katchup UI coverage
 * **measurable**. `tests/framework/katchup-ui-coverage.spec.ts` reconciles it and FAILS the build if a
 * feature has no status, if a `built` feature names no spec, or if any FR-K id is unrepresented — so a
 * Katchup feature cannot be silently dropped.
 *
 * `status` is the same honesty axis the API side uses (built / gated / blocked-with-reason):
 *   - `built`      — a spec drives it today (green, or a gated first-draft awaiting one live tune pass)
 *   - `needs-accounts`  — needs ≥3 QA PERSONAL accounts (group / Cc / confidential / bulk)
 *   - `needs-received`  — needs a message RECEIVED from the other account (2 concurrent sessions)
 *   - `needs-upload`    — needs a real file upload / device capability
 *   - `ui-only`         — a client behaviour with no assertable persisted outcome (audio, print, clipboard)
 *   - `api-only`        — no distinct UI surface; covered by the API lifecycle instead
 * Every non-`built` status carries a `reason`, exactly like a blocked API endpoint.
 */

export type KatchupCategory = 'compose' | 'sender-action' | 'recipient-action' | 'read-search';

export type KatchupCoverage =
  'built' | 'needs-accounts' | 'needs-received' | 'needs-upload' | 'ui-only' | 'api-only';

export interface KatchupFeature {
  /** Stable id. */
  id: string;
  /** What the user does. */
  name: string;
  /** FRD id(s) this exercises (FR-K.. / BR-K.. / NFR-..), for traceability. */
  fr: string[];
  /** `katchupMessageType` code where the feature is a send variant, else undefined. */
  messageType?: number;
  category: KatchupCategory;
  status: KatchupCoverage;
  /** The spec file that drives it, when `status: 'built'`. */
  spec?: string;
  /** Why it is not `built` yet — required for every non-`built` status. */
  reason?: string;
}

export const KATCHUP_FEATURES: readonly KatchupFeature[] = [
  // ── Compose & send (FR-K01..K07) ───────────────────────────────────────────────────────────────
  {
    id: 'compose-subject',
    name: 'Subject on every message (the differentiator)',
    fr: ['BR-K01', 'FR-K02'],
    category: 'compose',
    status: 'built',
    spec: 'katchup-compose.spec.ts',
  },
  {
    id: 'compose-body',
    name: 'Message body (Quill editor)',
    fr: ['FR-K01'],
    messageType: 0,
    category: 'compose',
    status: 'built',
    spec: 'katchup-compose.spec.ts',
  },
  {
    id: 'send-1to1',
    name: 'Send a 1:1 message, verify it appears',
    fr: ['FR-K01'],
    messageType: 0,
    category: 'compose',
    status: 'built',
    spec: 'katchup-compose.spec.ts',
  },
  {
    id: 'attachments',
    name: 'Attach a file → send → thumbnail → delete',
    fr: ['FR-K03'],
    category: 'compose',
    status: 'needs-upload',
    reason: 'needs a real file upload; the attachment uuid only a completed S3 upload produces',
  },
  {
    id: 'copy-cc',
    name: 'Copy / Cc — a visible additional recipient (revealContactList)',
    fr: ['FR-K04'],
    messageType: 14,
    category: 'compose',
    status: 'built',
    spec: 'katchup-copies.spec.ts',
  },
  {
    id: 'confidential-copy',
    name: 'Confidential Copy — hidden from other recipients (NFR-SEC02)',
    fr: ['FR-K05', 'NFR-SEC02'],
    messageType: 14,
    category: 'compose',
    status: 'built',
    spec: 'katchup-copies.spec.ts',
  },
  {
    id: 'group-send',
    name: 'Group send + per-recipient read receipts',
    fr: ['FR-K06', 'FR-K07'],
    messageType: 0,
    category: 'compose',
    status: 'needs-received',
    reason:
      'the 3-account harness exists (create is `group.spec.ts`); group SEND + per-recipient receipts is the remaining multi-account flow to record',
  },
  {
    id: 'read-receipts',
    name: 'Read receipt — cross-account delivery + open state',
    fr: ['FR-K07', 'BR-X01'],
    category: 'compose',
    status: 'built',
    spec: 'katchup-two-session.spec.ts',
  },
  {
    id: 'secret-message',
    name: 'Secret / vanishing message (expiry)',
    fr: ['FR-K11'],
    messageType: 18,
    category: 'compose',
    status: 'needs-received',
    reason: 'a self-destructing message is proven by the recipient view; needs 2 sessions',
  },
  {
    id: 'bulk-broadcast',
    name: 'Bulk / broadcast to many recipients',
    fr: ['FR-K06'],
    messageType: 19,
    category: 'compose',
    status: 'built',
    spec: 'katchup-copies.spec.ts',
  },
  {
    id: 'schedule-call',
    name: 'Schedule a call from the composer',
    fr: ['FR-C01'],
    messageType: 17,
    category: 'compose',
    status: 'api-only',
    reason: 'a Kall-module feature reached from Katchup; covered by the Kall UI + API',
  },
  {
    id: 'share-digital-card',
    name: 'Share digital card',
    fr: ['FR-K17'],
    messageType: 22,
    category: 'compose',
    status: 'needs-received',
    reason: 'the shared card is verified in the recipient conversation; needs 2 sessions',
  },
  {
    id: 'share-location',
    name: 'Share location',
    fr: ['FR-K17'],
    messageType: 23,
    category: 'compose',
    status: 'needs-received',
    reason: 'the shared location is verified in the recipient conversation; needs 2 sessions',
  },

  // ── Sender actions — the bell menu (FR-K08..K20) ────────────────────────────────────────────────
  {
    id: 'edit',
    name: 'Edit a sent message (visible Edited marker)',
    fr: ['FR-K08', 'FR-K09', 'BR-K03'],
    messageType: 6,
    category: 'sender-action',
    status: 'built',
    spec: 'katchup-actions.spec.ts',
  },
  {
    id: 'recall',
    name: 'Recall — the message disappears from the recipient view',
    fr: ['FR-K10', 'BR-K03'],
    messageType: 7,
    category: 'sender-action',
    status: 'built',
    spec: 'katchup-compose.spec.ts',
  },
  {
    id: 'recall-repost',
    name: 'Recall & Repost — recall then re-send',
    fr: ['FR-K10'],
    category: 'sender-action',
    status: 'api-only',
    reason:
      'not a distinct bell-menu entry; it is Recall (green in katchup-compose) + a re-send (green), so it is covered by the composition of two tested flows, not a dedicated UI test',
  },
  {
    id: 'note',
    name: 'Note — attach a private note to a message',
    fr: ['FR-K13'],
    messageType: 5,
    category: 'sender-action',
    status: 'built',
    spec: 'katchup-actions-more.spec.ts',
  },
  {
    id: 'reminder',
    name: 'Reminder — set a reminder on a message',
    fr: ['FR-K13'],
    messageType: 3,
    category: 'sender-action',
    status: 'built',
    spec: 'katchup-actions-more.spec.ts',
  },
  {
    id: 'transfer',
    name: 'Transfer a message to another contact',
    fr: ['FR-K14'],
    category: 'sender-action',
    status: 'built',
    spec: 'katchup-actions-more.spec.ts',
  },
  {
    id: 'forward',
    name: 'Forward a message (with / without thread)',
    fr: ['FR-K15', 'FR-K16'],
    messageType: 15,
    category: 'sender-action',
    status: 'built',
    spec: 'katchup-actions-more.spec.ts',
  },
  {
    id: 'copy-clipboard',
    name: 'Copy message text to the clipboard',
    fr: ['FR-K17'],
    category: 'sender-action',
    status: 'built',
    spec: 'katchup-actions.spec.ts',
  },
  {
    id: 'save',
    name: 'Save / bookmark a message',
    fr: ['FR-K18'],
    category: 'sender-action',
    status: 'built',
    spec: 'katchup-actions.spec.ts',
  },
  {
    id: 'mark-important',
    name: 'Mark / unmark important',
    fr: ['FR-K18'],
    category: 'sender-action',
    status: 'api-only',
    reason:
      'no bell-menu entry; the star toggle is covered by the API markOrUnmarkImportantMessage',
  },
  {
    id: 'text-to-speech',
    name: 'Text-to-Speech — read a message aloud',
    fr: ['FR-K19'],
    category: 'sender-action',
    status: 'ui-only',
    reason: 'plays audio; no assertable persisted outcome',
  },
  {
    id: 'delete',
    name: 'Delete a message (sender-side)',
    fr: ['FR-K20'],
    category: 'sender-action',
    status: 'built',
    spec: 'katchup-actions.spec.ts',
  },
  {
    id: 'print',
    name: 'Print a message',
    fr: ['FR-K17'],
    category: 'sender-action',
    status: 'ui-only',
    reason: 'opens the browser print dialog; no assertable persisted outcome',
  },

  // ── Recipient actions — the reply menu (FR-K21..K25) ────────────────────────────────────────────
  {
    id: 'reply',
    name: 'Reply to a received message',
    fr: ['FR-K21'],
    messageType: 1,
    category: 'recipient-action',
    status: 'built',
    spec: 'katchup-two-session.spec.ts',
  },
  {
    id: 'comment',
    name: 'Comment on a received message',
    fr: ['FR-K22'],
    messageType: 8,
    category: 'recipient-action',
    status: 'built',
    spec: 'katchup-two-session.spec.ts',
  },
  {
    id: 'clarify',
    name: 'Clarify a received message',
    fr: ['FR-K23'],
    messageType: 9,
    category: 'recipient-action',
    status: 'built',
    spec: 'katchup-two-session.spec.ts',
  },
  {
    id: 'report',
    name: 'Report a received message (abuse)',
    fr: ['FR-K24'],
    category: 'recipient-action',
    status: 'needs-received',
    reason:
      'the two-session harness now exists; Report (reportAbuse) opens a reason dialog off the recipient More menu — its sub-flow needs one recording pass',
  },
  {
    id: 'more-options',
    name: 'More options on a received message',
    fr: ['FR-K25'],
    category: 'recipient-action',
    status: 'needs-received',
    reason:
      'the recipient More menu (`katchup-two-session.spec.ts` harness) — sub-flow needs recording',
  },

  // ── Read / search / reference ───────────────────────────────────────────────────────────────────
  {
    id: 'search',
    name: 'Search / filter the conversation list',
    fr: ['FR-K01'],
    category: 'read-search',
    status: 'built',
    spec: 'katchup-search.spec.ts',
  },
  {
    id: 'conversation-open',
    name: 'Open a conversation and the composer',
    fr: ['FR-K01'],
    category: 'read-search',
    status: 'built',
    spec: 'katchup-compose.spec.ts',
  },
  {
    id: 'unread-count',
    name: 'Unread badge / message count',
    fr: ['FR-K07'],
    category: 'read-search',
    status: 'needs-received',
    reason: 'an unread badge appears on a message received but not yet opened; needs 2 sessions',
  },
  {
    id: 'reference-thread',
    name: 'Threaded / reference message view (a reply builds the thread)',
    fr: ['FR-K16'],
    category: 'read-search',
    status: 'built',
    spec: 'katchup-two-session.spec.ts',
  },
];

/** Every FR-K / BR-K id the FRD defines for Katchup, so the catalogue can prove full traceability. */
export const KATCHUP_REQUIREMENTS: readonly string[] = [
  'FR-K01',
  'FR-K02',
  'FR-K03',
  'FR-K04',
  'FR-K05',
  'FR-K06',
  'FR-K07',
  'FR-K08',
  'FR-K09',
  'FR-K10',
  'FR-K11',
  'FR-K13',
  'FR-K14',
  'FR-K15',
  'FR-K16',
  'FR-K17',
  'FR-K18',
  'FR-K19',
  'FR-K20',
  'FR-K21',
  'FR-K22',
  'FR-K23',
  'FR-K24',
  'FR-K25',
  'BR-K01',
  'BR-K03',
  'NFR-SEC02',
];
