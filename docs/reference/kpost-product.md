# KPOST — the product the bench tests

What KPOST is, the application flow the bench exercises, and the architecture risk that shapes how
failures are filed. The bench itself is described in `CLAUDE.md` and `docs/guides/`.

## 1. What KPOST is

KPOST is a **unified communications platform** — messaging, calling and email under one account,
built by KPOST India Pvt. Ltd. Source of truth for this section: `D:\Kpost Documents` (BRD, PRD,
SRS, FSD, Full Suite FRD v2.0).

The business case: organisations stitch together separate chat, calling and email vendors, each with
its own login, data silo and support contract. KPOST replaces that with one suite, one login and
built-in traceability.

### The differentiators (the product's reason to exist)

| Differentiator                               | Module          | Why it matters                                                                                                                                               |
| -------------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Subject line on every chat message**       | Katchup         | Slack, Teams, Zoom Team Chat and Google Chat have no subject on an individual message. A thread can be found, filtered and handed off without re-reading it. |
| **Read receipts with exact open date/time**  | Katchup + KMail | One accountability model across chat and mail.                                                                                                               |
| **Rich post-send control**                   | Katchup         | Edit, Recall, Recall & Repost, Note, Reminder, Transfer, Forward (with/without thread), Copy, Save, Text-to-Speech, Delete.                                  |
| **Scheduled + ad hoc calling in one module** | Kall            | One call log for both, rather than two tools.                                                                                                                |
| **External mail interoperability**           | KMail           | Open-with, external recipients, transfer/share to Gmail, Outlook, Yahoo.                                                                                     |

### Modules

| Module         | Role                                                                           | Bench suite              |
| -------------- | ------------------------------------------------------------------------------ | ------------------------ |
| Signup & Login | Registration, activation, authenticated access — the gate to everything else   | `kpost-api`              |
| Katchup        | Instant messaging: subject, attachments, group, message actions, read receipts | `kpost-api`              |
| Kall           | Voice/video: scheduling, rescheduling, direct calls, call log                  | `kpost-api`              |
| KMail          | Email: compose, read receipts, external interoperability                       | `kmail-api` (own repo)   |
| KDirectory     | Organisation directory: listing, search, profile, launch Katchup/Kall          | `kpost-api` + `kpost-ui` |
| Admin module   | Organisation / HR / product administration                                     | `admin-api` (own repo)   |
| KPost UI       | React front end over all of the above                                          | `kpost-ui`               |
| KDOC           | **Out of scope** per BRD §4.2 (no per-module FRD supplied)                     | —                        |

KDirectory moved **into scope** on 2026-09-16 when it gained its own FRD (`FR-KD-001..006`); it overlaps
the existing contacts/company reads + the verticals directory screen. KDOC remains out of scope.

## 2. Application flow (what the bench must exercise)

```
REGISTER ──► ACTIVATE ──► LOGIN (JWT) ──┬──► KATCHUP  (message lifecycle)
  FR-S01..05   FR-S06..08   FR-S09..12  ├──► KALL     (schedule / call / log)
  unique id    activation    session     └──► KMAIL    (compose / receipts / external)
  password     required      logout
  strength     before login
```

**Signup & Login.** A registration form validates every required field before submission and
rejects an identifier that already exists (BR-S02: enforced at submission, not deferred to
activation). Activation is a **separate mandatory step** — login before activation must fail
(BR-S01). Login issues a JWT; a failure message must not reveal whether the id or the password was
wrong (account-enumeration precaution). Logout terminates the session.

**Katchup message lifecycle.** Compose carries a **Subject** (for 1:1 and group alike, BR-K01),
optional attachments, Copy (visible) and Confidential Copy (hidden from other recipients,
NFR-SEC02). Every message records per-recipient open date/time. The action set then **splits by
role** (BR-K02): the sender gets Edit / Recall / Recall&Repost / Note / Reminder / Transfer /
Forward / Forward-with-thread / Copy / Save / TTS / Delete; the recipient gets Reply / Comment /
Clarify / Report Message / More Options. An edited message keeps a visible `Edited:` marker; a
recalled message disappears from the recipient's view entirely (BR-K03).

**Kall.** A scheduled call has title, date, start/end time and participants. Rescheduling updates
the status tag `Scheduled → Rescheduled` while keeping the original entry's identity (BR-C01).
Direct calling reaches the device's native contacts as well as KPOST contacts. The call log records
participants, role/team, duration and exact start/end timestamps.

**KMail.** Compose with recipients and attachments; per-mail read receipt (BR-M01, matching
Katchup); open-with another mail app, external non-KPOST recipients, and transfer/share to Gmail,
Outlook or Yahoo Mail.

**Cross-module rules.** Read receipts behave identically in Katchup and KMail (BR-X01). Account,
password and acceptable-use rules are platform-wide, not per module (BR-X02).

## 3. Platform architecture (and the risk it creates for testing)

Microservices — API Gateway, Eureka registry, JWT auth, per-domain services — **evolving out of a
legacy monolith (KpostV5)**. Three documented weaknesses shape how we read failures:

1. **Shared monolithic database** across services → a defect in one module can surface in another.
2. **Circular KMail ↔ Katchup dependency** → an outage in one has an elevated chance of breaking the
   other (SRS §4.2, BRD §8).
3. **Auth Service outside the service registry** → every module depends on it (NFR-R01).

**Consequence for this bench:** a cascading failure is plausible and expected. That is exactly why
bug filing has a validity gate (`docs/guides/bug-filing.md`) — an infrastructure cascade must not become 50 tickets blaming
the API.
