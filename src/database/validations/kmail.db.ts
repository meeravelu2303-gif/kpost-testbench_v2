import type { ValidationContext } from '@engine/validation-context';
import { fromChecks, outcome, type CheckDetail } from '@engine/validation-result';
import { getPath, isPlainObject, type JsonObject } from '@utils/json';
import type { DatabaseValidation } from '../database-validation';
import { kmailDb } from '../kmail-assertions';
import { KmailRepository } from '../repositories/kmail.repository';

/**
 * Persistence checks against the real KMail tables (`TBL_KPOST_KMAIL_MASTER` /
 * `TBL_KPOST_KMAIL_TRANSACTION`), confirmed live 2026-10-02 (both from direct DB sampling and
 * independently from the KMail backend source audit — entity fields match exactly).
 *
 * **Not yet executable**: `KPOST_QA` requires TLS and the bench correctly refuses to disable
 * certificate verification without `DB_SSL_CA` (see `docs/archive/TEST-BENCH-PLAN-2026-10-02.md` §16 P0 item 2)
 * — every DB validation currently reports SKIPPED, this one included. Written now so it is ready to
 * run the instant that's resolved, per the same "write now, verify later" discipline this plan
 * already applies to concurrency.
 *
 * The assertion logic itself (`kmailDb.addressedTo`/`subjectEncrypted`) was NOT written for this
 * file — it already existed, fully correct, built from the KMAIL-SCHEMA investigation. This file is
 * only the wiring: connect `kmail-post-mail`'s response to that existing, trusted assertion layer.
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

/** `kmail-post-mail`'s created-row payload, whether the API wraps it in an array or returns it flat. */
function createdRow(context: ValidationContext): JsonObject | undefined {
  const data: unknown = getPath(body(context), 'data');
  const row: unknown = Array.isArray(data) ? data[0] : data;
  return isPlainObject(row) ? row : undefined;
}

export const kmailMailPersistedValidation: DatabaseValidation = {
  id: 'kmail-mail-persisted',
  description:
    'A sent mail exists in TBL_KPOST_KMAIL_MASTER with its subject encrypted at rest, and a ' +
    'matching TBL_KPOST_KMAIL_TRANSACTION row addressed to the real recipient',
  severity: 'CRITICAL',
  async check(context, db) {
    const row = createdRow(context);
    const kmailId = row?.kmailID ?? row?.kmail_id;
    if (typeof kmailId !== 'number' && typeof kmailId !== 'string') {
      return outcome.skipped('the response carried no kmailID, so there is no row to verify');
    }

    const toAddress = requested(context, 'toAddress');
    const subjectSent = requested(context, 'kmailSubject');
    const repo = new KmailRepository(db);

    const mail = await repo.mail(kmailId, context.correlationId);
    const checks: CheckDetail[] = [
      {
        name: 'mail row exists',
        status: mail ? ('PASSED' as const) : ('FAILED' as const),
        expected: 'one row in TBL_KPOST_KMAIL_MASTER',
        actual: mail ? 'found' : 'none',
      },
    ];
    if (mail && typeof subjectSent === 'string' && subjectSent !== '') {
      checks.push(...kmailDb.subjectEncrypted(mail, subjectSent));
    }

    if (typeof toAddress === 'string' && toAddress) {
      const recipient = await repo.recipient(kmailId, toAddress, context.correlationId);
      checks.push(
        ...kmailDb.addressedTo(recipient, { kmailId, receiver: toAddress }),
        kmailDb.flag(recipient, 'delivery_status', 'set'),
      );
    }

    return fromChecks(checks, 'KMail persistence checks');
  },
};
