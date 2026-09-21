# KMail schema on KPOST_QA

Read off `information_schema` and sampled rows on the live KPOST_QA database (MySQL 8.0.46).
Written down because three of its properties contradict what a reader would reasonably assume, and
each one would produce a test that fails against a healthy API.

## The shape: one mail, many recipient rows

```
TBL_KPOST_KMAIL_MASTER          the mail itself — one row per mail
  kmail_id        bigint  PK
  kmail_subject   longtext      ← ENCRYPTED AT REST (see below)
  send_date       timestamp
  kmail_type      int
  priority        int
  note            blob
  attachment_flag tinyint
  attachment_path json
        │
        │ kmail_id  (logical FK — not declared as a constraint)
        ▼
TBL_KPOST_KMAIL_TRANSACTION     one row PER RECIPIENT — all per-person state lives here
  id                  bigint PK
  kmail_id            bigint      → MASTER
  receiver            varchar     the recipient's KPost ID
  sender              varchar
  receiver_type       int         1 / 2 / 3  (To / Cc / confidential-copy)
  read_status         char        'Y' | 'N'
  read_time           timestamp
  delivery_status     char        'Y' | 'N'
  reply_status        char        'Y' | 'N'
  reply_time          timestamp
  marked_by_sender    char        'Y' | 'N'   ← the "star" / flag, sender's side
  marked_by_receiver  char        'Y' | 'N'   ← the "star" / flag, recipient's side
  deleted_by_sender   char        'Y' | 'N'   ← soft delete, sender's side
  deleted_by_receiver char        'Y' | 'N'   ← soft delete, recipient's side
  recall              char        'Y' | 'N'
  receiver_name       blob        ← Buffer, needs decoding
  group_flag          tinyint
  ...

TBL_KPOST_KMAIL_DRAFTS          unsent drafts, keyed by kmail_id; NOT part of the sent lifecycle
TBL_KPOST_KMAIL_ATTACHMENT      per-file rows keyed by uuid, soft-deleted via tinyint delete_status
```

**The important structural fact:** per-recipient state is _not_ on the mail. Read, star, delete and
recall are columns on `TBL_KPOST_KMAIL_TRANSACTION`, one row per recipient, so "is this mail read?"
has as many answers as there are recipients. A test asserting a single read flag on the mail would
be asking a question the schema cannot answer.

## Three things that contradict the obvious assumption

### 1. The subject is ENCRYPTED at rest — it cannot be compared to what was sent

Sampled `kmail_subject` values from the most recent mails:

```
FZOnbK4boH4nugSVOMpmjgq8d6kI67E8
+LMUetiEmDS4kcVNVvmrtt1GyjdEWPL7kyzC5+F+0vO5o3iQszuZ8tdu1C/E
pL0yhPnbTLQEjzSdenFdTJRdO07+C5tlU+CX0SAAI8Y=
```

Base64 ciphertext with padding and varying length. Compare with Katchup's `subject`, which is
plaintext on the same database (`"General"`).

So `expect(subject).toBe('QA Bench 123')` **fails on a correct API**, and no amount of BLOB decoding
changes that — the bench does not hold the key. What a workflow spec can assert instead:

- the ciphertext is present and non-empty (something was stored),
- it does **not** equal the plaintext that was sent — which is a real security assertion: it proves
  encryption-at-rest is actually being applied rather than assumed.

Note also that the subject is `longtext`, not a BLOB, and `mysql2` returns it as a **string**. The
only BLOB in `KMAIL_TRANSACTION` is `receiver_name`, which does come back as a `Buffer` and does
need `text()`.

### 2. The flags are `'Y'` / `'N'` characters, not booleans or tinyints

Unlike Katchup, whose `deleted_by_sender` is a tinyint `0`/`1`, every KMail state flag is a `char`.
`Number(row.read_status)` is `NaN`, and `if (row.deleted_by_sender)` is **true for `'N'`** — a
non-empty string is truthy, so the naive check reports every mail as deleted.

There is also a third value in the data: **`'\u0000'`** (a NUL byte) on 107 rows of ~90,000. It is
neither `'Y'` nor `'N'`, so a comparison against `'N'` treats those rows as "set" and a comparison
against `'Y'` treats them as "clear". `kmailFlag()` in `src/database/kmail-assertions.ts` maps it to
`unknown` rather than guessing.

Observed distributions (≈90k rows):

| Column                |  `'N'` |  `'Y'` | `'\u0000'` |
| --------------------- | -----: | -----: | ---------: |
| `read_status`         | 63,518 | 26,384 |        107 |
| `delivery_status`     |  7,232 | 82,777 |          — |
| `deleted_by_sender`   | 89,741 |    161 |        107 |
| `deleted_by_receiver` | 89,766 |    136 |        107 |
| `marked_by_sender`    | 89,754 |    148 |        107 |
| `marked_by_receiver`  | 89,876 |     26 |        107 |
| `recall`              | 89,902 |      0 |        107 |

`recall` is `'Y'` on **zero** rows. Either the recall path is unused on this environment or it does
not write the column — worth knowing before a test asserts it flips.

### 3. There is no "archive" column

Searched every `%KMAIL%` table for `archiv`, `star`, `favou` and `flag`. The only matches are
`group_flag`, `attachment_flag` and `blocked_contact_flag`. **No archive state exists in the
schema.**

So an archive workflow cannot be asserted at the database layer here. Either the product implements
archive somewhere this search did not reach (a different table, or a client-side view), or it is not
persisted at all. This needs an answer from the owner before an archive assertion is written —
inventing a column would produce a test that passes because it checks nothing.

The nearest real equivalent is the **marked/starred** pair (`marked_by_sender` /
`marked_by_receiver`), which is what the workflow spec asserts instead.

## How to query it

`kmail_id` is the join key and is **not** a declared foreign key — KPOST_QA declares almost none —
so an orphaned transaction row is possible and worth checking rather than assuming away.

```sql
SELECT t.* FROM TBL_KPOST_KMAIL_TRANSACTION t
WHERE t.kmail_id = ? AND t.receiver = ?;      -- per-recipient state
```

Both are exposed through `KmailRepository` (`src/database/repositories/kmail.repository.ts`), which
is the only place these column names appear outside this document.
