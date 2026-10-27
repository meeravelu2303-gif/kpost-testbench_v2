import { testData } from '@config/test-data.config';
import type { ValidationContext } from '@engine/validation-context';
import { fromChecks, outcome } from '@engine/validation-result';
import { getPath, isPlainObject, type JsonObject } from '@utils/json';
import type { DatabaseValidation } from '../database-validation';
import { kpostDb, text } from '../kpost-assertions';
import { KpostRepository } from '../repositories/kpost.repository';

/**
 * Persistence checks against the KPOST_QA database. They assert only what a response cannot prove
 * (a row exists, a flag flipped, a foreign key resolves), so no failure is reported twice.
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
 * The account exists, is active and has coherent audit columns. Tells "the API returned nothing"
 * apart from "the account is deactivated", which look the same on the wire.
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

    // `company_id` has no FK constraint, so an orphan is possible; PERSONAL has no company.
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
 * A profile write landed in `TBL_KPOST_USER_PROFILE`: the requested columns match and
 * `modified_date` is set. The endpoints answer SUCCESS regardless of what they stored.
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

    // Only the columns this request set, since profile writes are partial.
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
 * A sent Katchup message exists as a row with the subject it was given (BR-K01, only verifiable
 * here). `subject` is a BLOB, so it is decoded with `text()` before comparing.
 */
export const katchupMessagePersistedValidation: DatabaseValidation = {
  id: 'katchup-message-persisted',
  description:
    'A sent Katchup message exists in TBL_KPOST_KATCHUP_MESSAGES with its subject, sender and receiver',
  severity: 'CRITICAL',
  async check(context, db) {
    // The msgID ties the response to the row; without it, skip rather than guess at the latest row.
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

/** A login opened a session row; a token with no row could never be revoked server-side. */
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

/** Active members (TBL_KPOST_USER_MASTER) do not exceed the `maximum_members_count` licence. */
export const companyLicenceIntegrityValidation: DatabaseValidation = {
  id: 'kpost-company-licence-integrity',
  description: 'Active members of a company do not exceed its maximum_members_count',
  severity: 'MEDIUM',
  async check(context, db) {
    const raw = requested(context, 'companyID', 'companyId') ?? testData.companyId;
    // Narrowed, not cast: a non-string, non-number id is skipped rather than coerced.
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
 * A notification-preference write persisted something: known defect, katchupNotification answers
 * success and stores nothing. Checks "not all null" because a DB validation has no before snapshot.
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

    // The JSON column comes back parsed; `{}` and all-null both mean nothing was saved.
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
