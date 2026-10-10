# Katchup UI coverage — every feature, measured

**GENERATED — do not edit.** Written by `tests/framework/katchup-ui-coverage.spec.ts`.
Reconciles `src/ui/katchup-features.ts` (enumerated from the FRD, the `katchupMessageType` enum,
and the frontend action menus) so a Katchup feature cannot be silently missed.

**35** features · **23 built** · 5 needs-received · 3 api-only · 4 ui-only

| Feature | FR | msgType | Category | Status | Spec / reason |
| ------- | -- | ------: | -------- | ------ | ------------- |
| Subject on every message (the differentiator) | BR-K01, FR-K02 |  | compose | built | `katchup-compose.spec.ts` |
| Message body (Quill editor) | FR-K01 | 0 | compose | built | `katchup-compose.spec.ts` |
| Send a 1:1 message, verify it appears | FR-K01 | 0 | compose | built | `katchup-compose.spec.ts` |
| Attach a file → send → thumbnail → delete | FR-K03 |  | compose | built | `katchup-attach-send-e2e.spec.ts` |
| Copy / Cc — a visible additional recipient (revealContactList) | FR-K04 | 14 | compose | built | `katchup-copies.spec.ts` |
| Confidential Copy — hidden from other recipients (NFR-SEC02) | FR-K05, NFR-SEC02 | 14 | compose | built | `katchup-copies.spec.ts` |
| Group send + per-recipient read receipts | FR-K06, FR-K07 | 0 | compose | needs-received | the 3-account harness exists (create is `group.spec.ts`); group SEND + per-recipient receipts is the remaining multi-account flow to record |
| Read receipt — cross-account delivery + open state | FR-K07, BR-X01 |  | compose | built | `katchup-two-session.spec.ts` |
| Secret / vanishing message (expiry) | FR-K11 | 18 | compose | needs-received | a self-destructing message is proven by the recipient view; needs 2 sessions |
| Bulk / broadcast to many recipients | FR-K06 | 19 | compose | built | `katchup-copies.spec.ts` |
| Schedule a call from the composer | FR-C01 | 17 | compose | api-only | a Kall-module feature reached from Katchup; covered by the Kall UI + API |
| Share digital card | FR-K17 | 22 | compose | needs-received | the shared card is verified in the recipient conversation; needs 2 sessions |
| Share location | FR-K17 | 23 | compose | ui-only | Corrected 2026-10-03: confirmed non-functional stub, not a 2-session gap. bubble/WriteMessage/WriteMessage.js:1966-2006 — handleSendLocation(lat, lng) is a bare console.log; sendLocationMessage() builds a local object, logs it, and resets state behind a literally commented-out `// socket.emit("sendMessage", message);` line. navigator.geolocation.getCurrentPosition is called (so a permission prompt and UI state exist), but no request of any kind ever reaches the backend. No UI test is possible until a developer wires it up. |
| Edit a sent message (visible Edited marker) | FR-K08, FR-K09, BR-K03 | 6 | sender-action | built | `katchup-actions.spec.ts` |
| Recall — the message disappears from the recipient view | FR-K10, BR-K03 | 7 | sender-action | built | `katchup-compose.spec.ts` |
| Recall & Repost — recall then re-send | FR-K10 |  | sender-action | api-only | not a distinct bell-menu entry; it is Recall (green in katchup-compose) + a re-send (green), so it is covered by the composition of two tested flows, not a dedicated UI test |
| Note — attach a private note to a message | FR-K13 | 5 | sender-action | built | `katchup-note-subflow-e2e.spec.ts` |
| Reminder — set a reminder on a message | FR-K13 | 3 | sender-action | built | `katchup-actions-more.spec.ts` |
| Transfer a message to another contact | FR-K14 |  | sender-action | built | `katchup-transfer-subflow-e2e.spec.ts` |
| Forward a message (with / without thread) | FR-K15, FR-K16 | 15 | sender-action | built | `katchup-forward-subflow-e2e.spec.ts` |
| Copy message text to the clipboard | FR-K17 |  | sender-action | built | `katchup-actions.spec.ts` |
| Save / bookmark a message | FR-K18 |  | sender-action | built | `katchup-actions.spec.ts` |
| Mark / unmark important | FR-K18 |  | sender-action | api-only | no bell-menu entry; the star toggle is covered by the API markOrUnmarkImportantMessage |
| Text-to-Speech — read a message aloud | FR-K19 |  | sender-action | ui-only | plays audio; no assertable persisted outcome |
| Delete a message (sender-side) | FR-K20 |  | sender-action | built | `katchup-actions.spec.ts` |
| Print a message | FR-K17 |  | sender-action | ui-only | opens the browser print dialog; no assertable persisted outcome |
| Reply to a received message | FR-K21 | 1 | recipient-action | built | `katchup-two-session.spec.ts` |
| Comment on a received message | FR-K22 | 8 | recipient-action | built | `katchup-two-session.spec.ts` |
| Clarify a received message | FR-K23 | 9 | recipient-action | built | `katchup-two-session.spec.ts` |
| Report a received message (abuse) | FR-K24 |  | recipient-action | ui-only | Corrected 2026-10-03: there is no message-level Report entry on the recipient ReplyIcon menu at all — the only "Report" in the whole Katchup UI is ReportContact.js, reached from the Digital Card, which is a confirmed non-functional stub (zero fetch/axios/service calls in the component, across all 3 bubble/classic/components copies). The `reportAbuse` backend endpoint is registered and API-tested but has no frontend caller anywhere in the app. No UI test is possible until a developer wires it up. |
| More options on a received message | FR-K25 |  | recipient-action | needs-received | the recipient More menu (`katchup-two-session.spec.ts` harness) — sub-flow needs recording |
| Search / filter the conversation list | FR-K01 |  | read-search | built | `katchup-search.spec.ts` |
| Open a conversation and the composer | FR-K01 |  | read-search | built | `katchup-compose.spec.ts` |
| Unread badge / message count | FR-K07 |  | read-search | needs-received | an unread badge appears on a message received but not yet opened; needs 2 sessions |
| Threaded / reference message view (a reply builds the thread) | FR-K16 |  | read-search | built | `katchup-two-session.spec.ts` |

## Requirement traceability

Every Katchup FR/BR/NFR the FRD defines maps to ≥1 feature. Requirements: **27**, uncovered: **0**.

