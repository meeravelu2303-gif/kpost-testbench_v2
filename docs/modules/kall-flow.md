# Kall flow — the calling module, analysed

The KPost **Kall** module: voice/video calling, `/v2/kall/*`. FR-C01..C09 and BR-C01. This is the
analysis the owner asked for before the module was built — the codes, the two flows, the payloads
(read from the live web client, not guessed), and the discrepancies found on the way.

Source of truth for the payloads: `D:\KPOST_PROJECTS\KPOST_REACTJS_2023_V1\src\Services\Kall.js`
(the service layer) and the component modals. Codes: the workbook's Types tab, exposed as
`KALL_STATUS` / `KALL_TYPE` / `KALL_MODE` / `KALL_REPEAT_TYPE` in `@api/schemas/kpost-types`.

## 1. The codes (owner-supplied; already in the workbook, verified to match)

All four enum groups the owner gave match the workbook's Types tab exactly — nothing to add, only to
pin (`tests/api/kpost/kall/coverage.spec.ts`).

**`kallStatus`** (sender & receiver)

    0 new           1 connected     2 cancelled     3 noresponse    4 declined     5 busy
    6 Scheduled     7 ReScheduled   8 closed        9 removed      10 KoolKall Accepted   11 Not Joined

**`kallType`** — `0 normal` (ad-hoc), `1 kool/scheduled`.

**`kallMode`** — `0 audio`, `1 video`, `2 audio→video converted`, `3 video→audio converted`,
`4 primary audio`, `5 primary video`.

**`kallRepeatType`** — `0 none`, `1 daily`, `2 weekly`, `3 monthly`.

## 2. The two flows

### Direct (normal) call — `kallType: 0`

    initiateKall {receiver, kallMode, kallType:0, kallStatus:0(new), kallSession, kallStartTime}
        └─► updateKallStatus / updateSenderAndReceiverKallStatus  {id, kallStatus, kallID}
                (0 new → 1 connected → 8 closed, or → 2 cancelled / 3 noresponse / 4 declined / 5 busy)
        └─► endIndividualKall {kallID}
    reads: kallDashboard (recent), kallInfo (history with a contact), getKallStatus[UsingKallID]
    clear: clearKallBykallIds {kallIds:[…]} · clearKallHistory (all)

### Scheduled (Kool) call — `kallType: 1`

    scheduledKall {kallSession, kallMode, subject, scheduledStartTime, scheduledEndTime,
                   meetingLink, repeatType, repeatedDate, kallDetails:[{receiver}, …]}
        └─► reScheduleKall {kallID, …same shape…}   (BR-C01: status 6 Scheduled → 7 ReScheduled,
                                                      the entry keeps its kallID)
        └─► joinScheduleKall {id, kallID}  ·  endKoolKall {id, kallID}
        └─► modifyKallMembers {kallID, addingUserIds:[…], removingUserIds:[…]}
    reads: todayKoolKall · fetchScheduledRepeatKall {scheduledStartTime} · scheduledRepeatKall

## 3. Payload shapes worth writing down (from the live client)

- **`repeatedDate` is a _stringified_ JSON object**, not a nested object:
  `"repeatedDate": "{\"start_date\":\"2023-11-08\",\"end_date\":\"2023-11-20\"}"`. A nested object
  would be the natural guess and would be wrong.
- **`kallDetails`** is the participant list — `[{ "receiver": "<kpostID>" }, …]`. The guard checks
  each `receiver`, so on live they must be our own accounts.
- **`initiateKall` rings the receiver's device in real time.** It is the calling analogue of a
  Katchup send reaching a real inbox — a real-time side effect on a real recipient. `kallSession` is
  a value the client mints per call (`www.jitsi.com` is the meeting host).
- **`kallSession`, `kallMode`, `kallStatus`, `kallType`, `kallStartTime`, `kallID`** all contain
  "kall" and so trip the QA-identifier guard's `IDENTIFIER_KEY` by default. They are exempt in
  `qa-identifier-guard.ts`: the first five are an enum/session/timestamp (not a resource), and
  `kallID`/`kallIds` are runtime-created, kall-scoped ids (handled like `msgID` — a call we placed,
  not a tenant record; no `productionSafe` endpoint accepts one).

## 4. What the contract converter got right (20 usable, 16 retired)

The `/v2/kall/*` space has 36 rows; 16 are `superseded` duplicates the converter correctly retired
(most are the old `katchupKall`/`addMembersToKall`/`cancelScheduleKall` names, and duplicate rows the
KatchupAPI tab carries the live version of). The 20 usable endpoints are the ones defined here. One
worth noting: **`/v2/dashboard/kallDashboard/` is a retired (superseded) form of `/v2/kall/kallDashboard`**
— the live one is in this module, so the dashboard module correctly left it alone.

## 5. Live scope — reads run, writes are gated

Two PERSONAL accounts, so of 20 endpoints:

- **6 reads run on live** — `kallDashboard`, `todayKoolKall`, `frequentKallContacts`, `kallInfo`,
  `contactInfo`, `fetchScheduledRepeatKall` — each asked with our own account. First live run:
  **36 pass, 44 findings** (the same systemic classes as every module — auth failures answer 400/403
  not 401, missing CSP/referrer headers, error envelope).
- **2 reads blocked** (`needs-kall-id`) — `getKallStatus`, `getKallStatusUsingKallID` need a real
  `kallID`; the lifecycle creates one.
- **12 writes gated** — every one is destructive and **none is `productionSafe`**. A call rings a
  device / notifies participants, and the clear endpoints delete the log. They are exercised only
  through `tests/api/kpost/kall/feature.spec.ts`, gated behind **`KALL_LIFECYCLE=true`**, each write
  carrying `allowLiveWrite: true` (the authorized-write control Katchup and Profile use), self-cleaning
  (a `finally` that calls `clearKallHistory` for both parties, so no failed step leaves an orphan).

**The full lifecycle ran on live (owner-authorized)** — three flows exercise all 12 writes and both
`kallID`-keyed reads, so every Kall endpoint has been hit on live. Results:

- **Direct-call flow fully passes** — `initiateKall` → `getKallStatus` → `getKallStatusUsingKallID`
  → `updateKallStatus` → `updateSenderAndReceiverKallStatus` → `endIndividualKall` →
  `clearKallBykallIds`, every step 200, cleaned up.
- **BR-C01 confirmed** — `scheduledKall` → `reScheduleKall` keeps the `kallID`; sender status moves
  `6 Scheduled → 7 ReScheduled`. `modifyKallMembers` also accepted.
- **Finding cluster — `joinScheduleKall`, `endKoolKall`, `scheduledRepeatKall` all → HTTP 500.**
  Server errors on client-reachable paths (a 4xx belongs). `scheduledKall`/`reScheduleKall`/
  `modifyKallMembers` on the same call succeed, so it is those three operations specifically.
- **Cleanup verified** — 0 active (not-deleted) calls on all three accounts afterward.

A call cannot connect headlessly (there is no second WebRTC peer), so the lifecycle asserts the API
contract of the flow — a call is placed and issues an id, its status transitions, it ends, the log
clears — not that audio flows. TTS-style client behaviours (the in-call window, the Jitsi iframe) are
UI-only and live in the screen test.

**A guard note from the live run:** the end/join/status payloads echo the kall's row id as a bare
`{id: <kallID>}`. A bare `id` matches the identifier guard and is not a `QA_*` value, so the exact
key `id` is exempt in `qa-identifier-guard.ts` — a runtime row id, and this API names every
cross-tenant target with a qualified key (`kpostID`/`companyID`/…), never a bare `id`.

## 6. The screen

`/kall` → `<Kall />` (`MenuRoutes.js`). `tests/e2e/kall.spec.ts` checks the workspace shell
(`.kall-layout-shell`), the call tabs (`.tabs-wrapper`) and the contact search ("Search Contacts")
render for a logged-in user, across Chromium / Firefox / WebKit. Placing/scheduling a real call from
the UI is not automated (it rings a device); that behaviour is the API lifecycle's job.

## 7. Open questions for the owner

1. ~~Sign-off to run the write lifecycle on live.~~ **Done** — authorized and run; results in §5.
2. **`joinScheduleKall`, `endKoolKall` and `scheduledRepeatKall` all return HTTP 500** (§5) — the
   Kool-call subsystem, where `scheduledKall`/`reScheduleKall`/`modifyKallMembers` on the same call
   succeed. Are these real defects (a 4xx belongs), or do they need a precondition the flow skips
   (e.g. a real Jitsi session for join)? One ticket once confirmed.
3. **Does `clearKallBykallIds` verify caller ownership** of each `kallID`, or delete by id globally?
   Cleanup uses `clearKallHistory` (token-scoped) instead, so this is no longer on the critical path,
   but it matters for how strongly the by-id clear is scoped.
