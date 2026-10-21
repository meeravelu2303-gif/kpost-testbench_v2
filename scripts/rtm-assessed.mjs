// Analyst-assigned requirements for the areas the per-module FRD is silent on (see docs/COVERAGE-GAPS.md).
// Consumed by scripts/rtm-lib.mjs. `files` are in-scope spec path fragments that cover the requirement
// (used to resolve a verified link); empty `files` => Not covered / blocked.
export const ASSESSED = [
  {
    id: 'RTM-KALL-A01',
    module: 'Kall',
    summary: 'Connected A→B call: ring → accept → hang-up on both sides',
    status: 'Covered',
    files: ['journeys/voice-call', 'kall/call-states'],
    notes:
      'Full flow asserted by journeys/voice-call (ring -> Accept -> both timers tick -> mute -> hang-up) — red live on #1680 (the callee is never rung). The server half (accept stamps the start on both rows, end stamps end + duration) is kall/call-states, green 2/2 2026-10-20.',
  },
  {
    id: 'RTM-KALL-A02',
    module: 'Kall',
    summary: 'Reject an incoming call',
    status: 'Covered',
    files: ['kall/call-states'],
    notes:
      "kall/call-states sends the web Reject body ({id, kallStatus:4, kallID, reason:''}) and asserts the log shows declined and never started — red 2/2 on #13206 (404 Kall not found; the call stays ringing).",
  },
  {
    id: 'RTM-KALL-A03',
    module: 'Kall',
    summary: 'Missed call recorded in the log',
    status: 'Covered',
    files: ['kall/call-states'],
    notes:
      'kall/call-states sends the 30-s no-answer body (kallStatus 3) and asserts both logs show it missed — red 2/2 on #13206.',
  },
  {
    id: 'RTM-KALL-A04',
    module: 'Kall',
    summary: 'Mute / camera toggle during a call',
    status: 'Partial',
    files: ['journeys/voice-call'],
    notes:
      'Mic mute/unmute asserted in journeys/voice-call (red on #1680). The camera toggle exists only on a video call — not driven yet.',
  },
  {
    id: 'RTM-KALL-A05',
    module: 'Kall',
    summary: 'Call history / log entry with participant+timestamp fields',
    status: 'Covered',
    files: ['kall/call-states', 'kall/kall-reads-workflow', 'kall/read'],
    notes:
      'kall/call-states: an answered call shows in BOTH logs with start, end (after start) and a non-zero hh:mm:ss duration — green 2/2 2026-10-20. (The old null-timestamps note came from calls that were never accepted.)',
  },
  {
    id: 'RTM-KALL-A06',
    module: 'Kall',
    summary: 'Kool Kall join flow',
    status: 'Covered',
    files: ['kall/call-states', 'kall-features'],
    notes:
      'kall/call-states: host and guest joinScheduleKall -> both recorded as joined with their join times, guest connected — green 2/2 2026-10-20.',
  },
  {
    id: 'RTM-KALL-SEC01',
    module: 'Security',
    summary: 'IDOR on Kall resources (read another user’s call / kallInfo)',
    status: 'Covered',
    files: ['security/kall-object-authorization'],
    notes:
      'Outsider status-change / accept / reschedule / status-read + contactInfo PII probes, judged by the DB row (KALL_LIFECYCLE).',
  },
  {
    id: 'RTM-KMAIL-F01',
    module: 'KMail',
    summary: 'Reply / Reply-all / Forward a received mail',
    status: 'Covered',
    files: ['kmail/reply-forward-workflow'],
    notes:
      'API reply/forward (kmailType 1/2) + UI reply and forward between two sessions (UI forward red on #1351).',
  },
  {
    id: 'RTM-KMAIL-F02',
    module: 'KMail',
    summary: 'Attachments: upload, download, size limit',
    status: 'Partial',
    files: ['kmail-attach-send-e2e'],
    notes:
      'Receive + download through the UI covered; UI upload red on #1347; size limit not driven; byte integrity is RTM-CON04.',
  },
  {
    id: 'RTM-KMAIL-F03',
    module: 'KMail',
    summary: 'Folders: Sent / Trash / Spam',
    status: 'Not covered',
    files: [],
    notes:
      'Blocked: the web KMail has no Sent/Trash/Spam folders and no folder endpoint (Status of Mails lists only).',
  },
  {
    id: 'RTM-KMAIL-F04',
    module: 'KMail',
    summary: 'Mail search',
    status: 'Covered',
    files: ['kmail-browse-e2e'],
    notes:
      'Search is client-side only (no server mail-search endpoint): the Recents box filters by subject; the UI test seeds a mail, finds it by subject and shows nothing for a non-matching text.',
  },
  {
    id: 'RTM-KMAIL-F05',
    module: 'KMail',
    summary: 'Delete + restore a mail',
    status: 'Partial',
    files: ['kmail/feature'],
    notes: 'Per-side delete covered (API + UI greyed-out); no restore / trash endpoint exists.',
  },
  {
    id: 'RTM-KMAIL-F06',
    module: 'KMail',
    summary: 'CC / BCC semantics',
    status: 'Covered',
    files: [],
    notes:
      'BCC delivered + hidden from To (API); CC + Confidential Copy picked in the UI go out as cc/bcc and the CC receives.',
  },
  {
    id: 'RTM-KMAIL-F07',
    module: 'KMail',
    summary: 'Delivery to recipient inbox (plain mail arrival)',
    status: 'Covered',
    files: [],
    notes: 'A sends from the UI, B receives it in KMail and reads the exact body (two sessions).',
  },
  {
    id: 'RTM-KMAIL-F08',
    module: 'KMail',
    summary: 'Drafts: save / list / read / delete',
    status: 'Covered',
    files: ['kmail/feature', 'kmail/reads-workflow'],
    notes: 'API save/list/read/delete + UI Save Draft listed under Status of Mails > Draft Mails.',
  },
  {
    id: 'RTM-KU-M01',
    module: 'Katchup',
    summary: 'Real-time receive without refresh',
    status: 'Covered',
    files: [],
    notes:
      "Account 2's already-open Katchup shows the new message with no reload (katchup-two-session).",
  },
  {
    id: 'RTM-KU-M02',
    module: 'Katchup',
    summary: 'Read receipts per recipient',
    status: 'Covered',
    files: ['katchup-group-receipts-e2e', 'katchup-two-session', 'katchup/feature'],
    notes: 'Per-member read tracking asserted.',
  },
  {
    id: 'RTM-KU-M03',
    module: 'Katchup',
    summary: 'Unread / unopened counts',
    status: 'Covered',
    files: ['katchup/reads-workflow'],
    notes: 'getUnopenedMessagesCount + home badges.',
  },
  {
    id: 'RTM-KU-M04',
    module: 'Katchup',
    summary: 'Group message delivery to members',
    status: 'Covered',
    files: ['katchup/feature', 'katchup-group-receipts-e2e'],
    notes: 'Group send + per-member receipts.',
  },
  {
    id: 'RTM-KU-M05',
    module: 'Katchup',
    summary: 'Offline user receives message on next login',
    status: 'Covered',
    files: ['katchup/offline-delivery'],
    notes:
      'katchup/offline-delivery: B signs out of its own device, A writes, B signs in again on that device and finds the message in the thread; the DB row is unread (read_time empty) until then — green 2/2 2026-10-20.',
  },
  {
    id: 'RTM-KU-M06',
    module: 'Katchup',
    summary: 'Message translation (if live)',
    status: 'Covered',
    files: ['katchup-menus-transfer-translate', 'i18n-switch'],
    notes:
      "Katchup message translate (the per-message Translate icon → language → '<from> ▶ <to>' + translated text) asserted in katchup-menus-transfer-translate — red 4/4: the KMail translator now requires langFrom and the web app never sends it (#13209 KMail API, #13210 KPost UI; also breaks compose-assist and voice-message translate).",
  },
  {
    id: 'RTM-SEC01',
    module: 'Security',
    summary: 'Logout invalidates the session token',
    status: 'Covered',
    files: ['login-flow', 'cross-account-security'],
    notes: 'BR-SL-LOGOUT verified live.',
  },
  {
    id: 'RTM-SEC02',
    module: 'Security',
    summary: 'Session / token expiry enforced',
    status: 'Partial',
    files: ['login-token-security', 'signup-login/session-expiry'],
    notes:
      "JWT bounded (24 h) + logout revokes server-side + edited exp (extended / back-dated) refused 401 (session-expiry, 2/2). The genuinely-expired-token refusal could never run: the token history kept only the newest 20 and a busy day pushed every aged token out. Fixed 2026-10-20 (each account keeps its first-to-expire token, tests/framework/token-history.spec.ts); the check runs once today's oldest qatest token expires (2026-10-21).",
  },
  {
    id: 'RTM-SEC03',
    module: 'Security',
    summary: 'Password-reset link cannot be reused',
    status: 'Covered',
    files: ['login-forgot-password-lifecycle'],
    notes:
      "login-forgot-password-lifecycle (one real SMS per run, qatest6): after a successful reset it replays the same code — validateOTP is refused (400 Invalid OTP), but forgotPasswordUpdate with no code succeeds until the code's 10-minute expiry (3/3 live 2026-10-20, refused after expiry) — red on #13207.",
  },
  {
    id: 'RTM-SEC04',
    module: 'Security',
    summary: 'IDOR on KMail resources',
    status: 'Covered',
    files: [
      'kmail/attachment-idor',
      'kmail/content-idor',
      'kmail/mutation-idor',
      'kmail/credential-disclosure',
    ],
    notes: 'Attachment/content/mutation/credential IDOR asserted.',
  },
  {
    id: 'RTM-E2E01',
    module: 'Journeys',
    summary: 'Full journey: signup → first login → profile → first message/mail/call',
    status: 'Partial',
    files: ['journeys/first-use', 'journeys/voice-call'],
    notes:
      "Three legs, all built and run live 2026-10-20. 1a sign up (throwaway sanitykpostN, removed after) -> first login -> own name on Profile -> logout: green 2/2. 1b Home -> Profile -> first Katchup (B receives it: green) -> first KMail: red 2/2 at 'B reads it', because opening a received mail returns an empty record (#1359, reopened today; #1348). First call = journey 10 (voice-call): red on #1680 (B never rings). Partial until #1359 and #1680 are fixed (or the owner's counting rule says a working test failing on a filed bug counts).",
  },
  {
    id: 'RTM-CON01',
    module: 'Content',
    summary: 'Tamil / Hindi message content send + receive',
    status: 'Covered',
    files: ['katchup-content-correctness'],
    notes:
      "Tamil + Hindi typed in the composer render unchanged for the sender AND arrive unchanged in the recipient's server copy (katchup-content-correctness, 2/2 2026-10-15).",
  },
  {
    id: 'RTM-CON02',
    module: 'Content',
    summary: 'Emoji content integrity',
    status: 'Covered',
    files: ['katchup-content-correctness'],
    notes:
      "Emoji render unchanged for the sender AND arrive with the same code points in the recipient's server copy (katchup-content-correctness, 2/2 2026-10-15).",
  },
  {
    id: 'RTM-CON03',
    module: 'Content',
    summary: 'Long-content handling (UI render + persist)',
    status: 'Covered',
    files: ['katchup-content-correctness'],
    notes:
      "A ~520-char body keeps its tail for the sender and in the recipient's server copy, no shorter than typed (katchup-content-correctness, 2/2 2026-10-15).",
  },
  {
    id: 'RTM-CON04',
    module: 'Content',
    summary: 'Attachment byte integrity (download matches upload)',
    status: 'Covered',
    files: ['katchup/attachment-integrity', 'kmail/attachment-integrity'],
    notes:
      'A binary file (every byte 0x00-0xFF) is downloaded by sender AND recipient byte-identical (SHA-256 + length), Katchup and KMail (2/2+ 2026-10-15). Katchup reads take 10-12 s: #1364.',
  },
  {
    id: 'RTM-PERF01',
    module: 'Performance',
    summary: 'Single-user page-load / layout budgets per screen',
    status: 'Covered',
    files: ['screens-dynamic'],
    notes: '*-screens-dynamic health/performance/layout (~46 tests).',
  },
];
