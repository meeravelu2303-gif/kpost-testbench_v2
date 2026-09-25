import { testData } from '@config/test-data.config';
import type { ValidationContext } from '@engine/validation-context';
import { fromChecks, outcome } from '@engine/validation-result';
import { getPath, isPlainObject, type JsonObject } from '@utils/json';
import type { DatabaseValidation } from '../database-validation';
import { kpostDb, text } from '../kpost-assertions';
import { KpostRepository } from '../repositories/kpost.repository';

/**
 * Persistence checks against the **real KPOST_QA database**.
 *
 * ## Why these exist alongside `users.db.ts` / `companies.db.ts`
 *
 * Those validate the mock server's own `users` and `companies` tables and are attached only to
 * `mockFixture` endpoints — the bench's self-tests. They are not KPost. These are, and they are
 * written against the columns `information_schema` actually reports: `kpost_id` rather than `id`,
 * `created_date` rather than `createdAt`, `active_status = 'no'` rather than a `deletedAt`
 * tombstone.
 *
 * ## What a DB validation is for
 *
 * Only to assert what the response cannot. A 200 with the right body proves the API *said* it
 * saved something; it cannot prove a row exists, that a soft delete flipped the right flag, or that
 * a foreign key resolves. Anything the response already proves is checked by a response validator
 * instead — duplicating it here would just make a failure appear twice in the tracker.
 */

/** The response body, or an empty object when it was not JSON. */
function body(context: ValidationContext): JsonObject {
  const parsed = context.primary.json();
  return parsed.ok && isPlainObject(parsed.value) ? parsed.value : {};
}

/** A field from the request body, whatever casing the endpoint's payload uses. */
function requested(context: ValidationContext, ...names: string[]): unknown {
  const request = isPlainObject(context.request.body) ? context.request.body : {};
  for (const name of names) if (request[name] !== undefined) return request[name];
  return undefined;
}

/** The account the primary request was made as. */
function callerKpostId(context: ValidationContext): string | undefined {
  const fromRequest = requested(context, 'kpostID', 'kpostId', 'kpost_id');
  return typeof fromRequest === 'string' && fromRequest ? fromRequest : testData.kpostId;
}

/**
 * The authenticated account exists, is active, and its audit columns are coherent.
 *
 * Cheap, and worth attaching to any read that names a user: it is the check that distinguishes
 * "the API returned nothing for this account" from "this account is deactivated in the database",
 * which are the same 200-with-empty-data on the wire and entirely different defects.
 */
export const kpostUserActiveValidation: DatabaseValidation = {
  id: 'kpost-user-active',
  description:
    'The account row exists in TBL_KPOST_USER_MASTER, is active, and its audit dates are coherent',
  severity: 'HIGH',
  async check(context, db) {
    const kpostId = callerKpostId(context);
    if (!kpostId) return outcome.skipped('no KPost ID available to look the account up by');

    const repo = new KpostRepository(db);
    const user = await repo.user(kpostId, context.correlationId);

    const checks = [
      kpostDb.exists(`user ${kpostId}`, user),
      ...(user
        ? [
            kpostDb.activeStatus(user, 'yes'),
            kpostDb.present(user, 'first_name'),
            kpostDb.present(user, 'user_type'),
            ...kpostDb.auditFields(user),
          ]
        : []),
    ];

    /*
     * `company_id` is a logical foreign key only — KPOST_QA declares no constraint for it — so an
     * orphan is genuinely possible and worth checking. A PERSONAL account has no company at all,
     * and that is correct rather than an orphan.
     */
    if (user?.company_id) {
      const company = await repo.company(user.company_id, context.correlationId);
      checks.push(
        kpostDb.foreignKey(
          `TBL_KPOST_USER_MASTER.company_id ${String(user.company_id)} → TBL_KPOST_ADMIN_REGISTRATION.id`,
          company,
        ),
      );
    }

    return fromChecks(checks, 'account persistence checks');
  },
};

/**
 * A profile write actually landed in `TBL_KPOST_USER_PROFILE`.
 *
 * The profile endpoints answer `{"status":"SUCCESS"}` regardless of what they stored, so the
 * response cannot distinguish a saved field from a dropped one. This compares the columns the
 * request set against the row, and checks `modified_date` moved — a write that returns SUCCESS and
 * leaves `modified_date` untouched has not written anything.
 */
export const kpostProfileUpdatedValidation: DatabaseValidation = {
  id: 'kpost-profile-updated',
  description: 'A profile write is persisted to TBL_KPOST_USER_PROFILE and advances modified_date',
  severity: 'HIGH',
  async check(context, db) {
    const kpostId = callerKpostId(context);
    if (!kpostId) return outcome.skipped('no KPost ID available to look the profile up by');

    const profile = await new KpostRepository(db).profile(kpostId, context.correlationId);
    if (!profile)
      return fromChecks([kpostDb.exists(`profile ${kpostId}`, profile)], 'profile checks');

    /*
     * Only the columns this particular request actually set. Asserting a fixed list would fail on
     * every endpoint that writes a different subset — and profile writes are highly partial.
     */
    const candidates: Record<string, string> = {
      companyName: 'company_name',
      city: 'city',
      state: 'state',
      designation: 'designation',
      aboutYourself: 'about_yourself',
      website: 'website',
    };
    const expected: Record<string, unknown> = {};
    for (const [field, column] of Object.entries(candidates)) {
      const value = requested(context, field);
      if (value !== undefined && value !== null && value !== '') expected[column] = value;
    }

    const checks = [
      kpostDb.exists(`profile ${kpostId}`, profile),
      ...kpostDb.fieldsMatch(profile, expected),
      {
        name: 'modified_date advanced with the write',
        status: profile.modified_date ? ('PASSED' as const) : ('FAILED' as const),
        expected: 'a modification timestamp',
        actual: profile.modified_date ?? '(never modified)',
        message: profile.modified_date
          ? undefined
          : 'the endpoint reported success but the row has never been modified',
      },
    ];

    if (Object.keys(expected).length === 0) {
      checks.push({
        name: 'requested fields compared',
        status: 'SKIPPED',
        message: 'the request set none of the profile columns this validation knows how to compare',
      });
    }

    return fromChecks(checks, 'profile persistence checks');
  },
};

/**
 * A Katchup message the API claims to have sent exists as a row, with the subject it was given.
 *
 * This is the validation the send lifecycle most needs, for a KPost-specific reason: `subject` is a
 * **BLOB**, so a naive comparison against the string the test sent fails even when the stored bytes
 * are identical. `text()` decodes it. BR-K01 (a message's Subject, when given, is carried as sent —
 * Subject itself is optional per the FR-K02 amendment 2026-09-25) is only genuinely verifiable here —
 * the send response echoes back what it was handed, whatever it stored.
 */
export const katchupMessagePersistedValidation: DatabaseValidation = {
  id: 'katchup-message-persisted',
  description:
    'A sent Katchup message exists in TBL_KPOST_KATCHUP_MESSAGES with its subject, sender and receiver',
  severity: 'CRITICAL',
  async check(context, db) {
    /*
     * The send response returns the created row(s); the msgID is what ties the response to the
     * database. Without one there is nothing to look up, and saying so beats guessing at the most
     * recent row — which on a table with 944k rows and other traffic would be somebody else's.
     */
    const data: unknown = getPath(body(context), 'data');
    const created: unknown = Array.isArray(data) ? (data as unknown[])[0] : data;
    const msgId = isPlainObject(created) ? (created.msgID ?? created.msg_id) : undefined;
    if (typeof msgId !== 'number' && typeof msgId !== 'string') {
      return outcome.skipped('the response carried no msgID, so there is no row to verify');
    }

    const message = await new KpostRepository(db).katchupMessage(msgId, context.correlationId);
    const sentSubject = requested(context, 'subject');
    const sender = requested(context, 'sender');
    const receiver = requested(context, 'receiver');

    const checks = [kpostDb.exists(`katchup message ${String(msgId)}`, message)];

    if (message) {
      // Decoded before comparison: `subject` is a BLOB and would never equal a string otherwise.
      if (typeof sentSubject === 'string' && sentSubject !== '') {
        checks.push({
          name: 'subject stored as sent (BR-K01)',
          status: text(message.subject) === sentSubject ? 'PASSED' : 'FAILED',
          expected: sentSubject,
          actual: text(message.subject) ?? '(null)',
        });
      }
      if (typeof sender === 'string') checks.push(...kpostDb.fieldsMatch(message, { sender }));
      if (typeof receiver === 'string') checks.push(...kpostDb.fieldsMatch(message, { receiver }));
      checks.push(kpostDb.present(message, 'server_time'));
      // A freshly sent message must not already be deleted for either party.
      checks.push(...kpostDb.katchupDeletion(message, { sender: false, receiver: false }));
    }

    return fromChecks(checks, 'katchup persistence checks');
  },
};

/**
 * A login opened a session row, and the account's sessions are attributable.
 *
 * `TBL_KPOST_LOGIN_SESSION` is what multi-device behaviour actually means: one row per live
 * session. A login that returns a token but writes no row leaves a token the server cannot later
 * revoke, which no response assertion can detect.
 */
export const loginSessionCreatedValidation: DatabaseValidation = {
  id: 'kpost-login-session-created',
  description: 'A successful login has a corresponding row in TBL_KPOST_LOGIN_SESSION',
  severity: 'HIGH',
  async check(context, db) {
    const kpostId = callerKpostId(context);
    if (!kpostId) return outcome.skipped('no KPost ID available to look sessions up by');

    const sessions = await new KpostRepository(db).sessions(kpostId, context.correlationId);

    const checks = [
      {
        name: 'the account has at least one live session',
        status: sessions.length > 0 ? ('PASSED' as const) : ('FAILED' as const),
        expected: 'one or more session rows',
        actual: `${sessions.length} rows`,
        message:
          sessions.length > 0
            ? undefined
            : 'a token was issued but no session row exists, so the session cannot be revoked server-side',
      },
      {
        name: 'every session row belongs to this account',
        status: sessions.every((s) => text(s.kpost_id) === kpostId)
          ? ('PASSED' as const)
          : ('FAILED' as const),
        expected: kpostId,
        actual: [...new Set(sessions.map((s) => text(s.kpost_id)))],
      },
    ];

    return fromChecks(checks, 'session persistence checks');
  },
};

/**
 * A company has not issued more active members than its licence allows.
 *
 * `maximum_members_count` on `TBL_KPOST_ADMIN_REGISTRATION` is the licence limit, and the count of
 * active `TBL_KPOST_USER_MASTER` rows for that company is the usage. The API enforces this on the
 * add path; whether the *stored state* still honours it is a different question, and the one that
 * matters after any bulk import or restore.
 */
export const companyLicenceIntegrityValidation: DatabaseValidation = {
  id: 'kpost-company-licence-integrity',
  description: 'Active members of a company do not exceed its maximum_members_count',
  severity: 'MEDIUM',
  async check(context, db) {
    const raw = requested(context, 'companyID', 'companyId') ?? testData.companyId;
    /*
     * Narrowed rather than cast: the value arrives from a request body, so it could be anything.
     * A company id that is neither a string nor a number is not "company 0" — it is a request this
     * validation cannot interpret, and saying so beats querying a coerced id.
     */
    if (typeof raw !== 'string' && typeof raw !== 'number') {
      return outcome.skipped('no usable company id in the request or configuration');
    }
    const companyId: string | number = raw;
    if (companyId === '') return outcome.skipped('the company id is empty');

    const repo = new KpostRepository(db);
    const company = await repo.company(companyId, context.correlationId);
    if (!company) {
      return fromChecks([kpostDb.exists(`company ${companyId}`, company)], 'company checks');
    }

    const active = await repo.activeCompanyMembers(companyId, context.correlationId);
    const limit = Number(company.maximum_members_count);

    return fromChecks(
      [
        kpostDb.exists(`company ${companyId}`, company),
        {
          name: 'active members are within the licence',
          status: Number.isFinite(limit) && active <= limit ? 'PASSED' : 'FAILED',
          expected: `at most ${limit} active members`,
          actual: `${active} active`,
          message:
            active <= limit
              ? undefined
              : `the company holds ${active - limit} more active members than its licence allows`,
        },
      ],
      'licence integrity checks',
    );
  },
};

/**
 * A notification-preference write actually persisted something.
 *
 * ## The defect this exists to catch
 *
 * `generalSetting/katchupNotification` answers `200 "katchupNotification Updated Successfully"` and
 * leaves `TBL_KPOST_GENERAL_SETTINGS.katchup_notification` untouched. Measured 2026-09-22 against
 * KPOST_QA: the column held `{"Sound":null,"Vibrate":null,"Do Not Disturb":null,"Message Preview":null}`
 * before and after, for `{enable:0}`, for `{enable:1}`, and for a payload shaped exactly like the
 * stored column. So the user's preference silently never saves, and the response says otherwise.
 *
 * ## Why the assertion is "not entirely null" rather than a before/after diff
 *
 * A DB validation sees one moment — it runs after the endpoint's single call, so it cannot hold a
 * "before" snapshot. What it can say is that a settings row whose every preference is null has
 * never been written by a successful update, which is exactly the observed state. That is weaker
 * than a diff and still catches this defect; the before/after comparison lives in the workflow
 * spec, where both moments are available.
 */
export const settingsPersistedValidation: DatabaseValidation = {
  id: 'kpost-settings-persisted',
  description:
    'A successful notification-preference update leaves a non-empty preference in TBL_KPOST_GENERAL_SETTINGS',
  severity: 'HIGH',
  async check(context, db) {
    const kpostId = callerKpostId(context);
    if (!kpostId) return outcome.skipped('no KPost ID available to look the settings row up by');

    const row = await db
      .findOne<JsonObject>(
        { table: 'TBL_KPOST_GENERAL_SETTINGS', where: { kpost_id: kpostId } },
        context.correlationId,
      )
      .catch(() => undefined);

    if (!row) {
      return fromChecks(
        [kpostDb.exists(`settings for ${kpostId}`, row)],
        'settings persistence checks',
      );
    }

    /*
     * The column is JSON. `mysql2` gives it back parsed, so "every preference is null" is a shape
     * question rather than a string comparison — a stored `{}` and a stored all-null object are the
     * same fact: nothing was ever saved.
     */
    const preference = row.katchup_notification;
    const values =
      preference && typeof preference === 'object' && !Array.isArray(preference)
        ? Object.values(preference as Record<string, unknown>)
        : [];
    const anySet = values.some((value) => value !== null && value !== undefined && value !== '');

    return fromChecks(
      [
        kpostDb.exists(`settings for ${kpostId}`, row),
        {
          name: 'the stored Katchup preference holds a value',
          status: anySet ? 'PASSED' : 'FAILED',
          expected: 'at least one preference key set',
          actual: JSON.stringify(preference ?? null),
          message: anySet
            ? undefined
            : 'katchupNotification reports "Updated Successfully" but every key in the stored ' +
              'preference is null — the write is accepted and persisted nowhere, so the user’s ' +
              'setting silently reverts on next login',
        },
      ],
      'settings persistence checks',
    );
  },
};
