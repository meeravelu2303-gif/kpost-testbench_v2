import type { JsonObject } from '@utils/json';
import type { DatabaseClient } from '../database-client';

/**
 * Repositories over the **real KPOST_QA tables**.
 *
 * Table and column names are taken from `information_schema` on the live QA database rather than
 * from the workbook or from the API's field names, which differ from both: the API returns
 * `kpostID`, the column is `kpost_id`, and the workbook sometimes calls it `kpostId`. A repository
 * is the one place that translation is allowed to happen, so a validation never has to know it.
 *
 * Every table here is read-only in practice — the bench asserts what the API wrote, it does not
 * write rows itself — and the client refuses non-`SELECT` statements anyway unless the target
 * permits them.
 */

/** `TBL_KPOST_USER_MASTER` — the account. Keyed by `kpost_id`, a varchar, not a synthetic id. */
export interface KpostUserRecord extends JsonObject {
  kpost_id: string;
  first_name: string;
  last_name: string;
  user_type: string;
  country_id: number | null;
  mobile_number: string | number;
  email: string | null;
  /** `'yes'` / `'no'` — KPost's soft delete. There is no `deleted_at`. */
  active_status: string;
  company_id: number | null;
  created_by: string;
  created_date: Date | string;
  modified_by: string | null;
  modified_date: Date | string | null;
}

/** `TBL_KPOST_USER_PROFILE` — the profile, one row per account, same natural key. */
export interface KpostUserProfileRecord extends JsonObject {
  kpost_id: string;
  company_name: string | null;
  city: string | null;
  state: string | null;
  designation: string | null;
  about_yourself: string | null;
  website: string | null;
  created_date: Date | string;
  modified_date: Date | string | null;
}

/** `TBL_KPOST_ADMIN_REGISTRATION` — the company. `maximum_members_count` is the licence limit. */
export interface KpostCompanyRecord extends JsonObject {
  id: number;
  kpost_id: string;
  company_name: string | null;
  current_plan: string;
  maximum_members_count: number;
  expire_date: Date | string | null;
  licenses: number | null;
}

/** `TBL_KPOST_KATCHUP_MESSAGES`. `subject` and `actual_message` are BLOBs — decode with `text()`. */
export interface KatchupMessageRecord extends JsonObject {
  msg_id: number;
  sender: string;
  receiver: string;
  subject: Buffer | string | null;
  actual_message: Buffer | string | null;
  message_type: number | null;
  message_status: number | null;
  group_flag: number | null;
  deleted_by_sender: number | null;
  deleted_by_receiver: number | null;
  message_time: Date | string | null;
  server_time: Date | string | null;
}

/** `TBL_KPOST_LOGIN_SESSION` — one row per live session; the logout path removes it. */
export interface LoginSessionRecord extends JsonObject {
  session_id: string;
  kpost_id: string;
  device_type: string;
  device_identity_primary: string;
  login_time: Date | string;
}

/** `TBL_KPOST_USER_CONTACTS` — soft-deleted through the tinyint `delete_status`. */
export interface UserContactRecord extends JsonObject {
  id: number;
  kpost_id: string;
  contact_id: string;
  first_name: string | null;
  is_blocked: number | null;
  delete_status: number | null;
  created_date: Date | string;
  modified_date: Date | string | null;
}

/** `TBL_KPOST_USERGROUP_MASTER` — `group_name` is a BLOB; `active_status` is `'yes'`/`'no'`. */
export interface UserGroupRecord extends JsonObject {
  group_id: number;
  group_kpost_id: string;
  group_name: Buffer | string | null;
  admin_kpost_id: string;
  active_status: string;
  created_date: Date | string;
}

export class KpostRepository {
  constructor(private readonly db: DatabaseClient) {}

  user(kpostId: string, correlationId?: string): Promise<KpostUserRecord | undefined> {
    return this.db.findOne<KpostUserRecord>(
      { table: 'TBL_KPOST_USER_MASTER', where: { kpost_id: kpostId } },
      correlationId,
    );
  }

  profile(kpostId: string, correlationId?: string): Promise<KpostUserProfileRecord | undefined> {
    return this.db.findOne<KpostUserProfileRecord>(
      { table: 'TBL_KPOST_USER_PROFILE', where: { kpost_id: kpostId } },
      correlationId,
    );
  }

  company(
    companyId: number | string,
    correlationId?: string,
  ): Promise<KpostCompanyRecord | undefined> {
    return this.db.findOne<KpostCompanyRecord>(
      { table: 'TBL_KPOST_ADMIN_REGISTRATION', where: { id: companyId } },
      correlationId,
    );
  }

  katchupMessage(
    msgId: number | string,
    correlationId?: string,
  ): Promise<KatchupMessageRecord | undefined> {
    return this.db.findOne<KatchupMessageRecord>(
      { table: 'TBL_KPOST_KATCHUP_MESSAGES', where: { msg_id: msgId } },
      correlationId,
    );
  }

  /** Live sessions for an account. Multi-device handling is exactly "how many rows are here". */
  sessions(kpostId: string, correlationId?: string): Promise<LoginSessionRecord[]> {
    return this.db.findMany<LoginSessionRecord>(
      { table: 'TBL_KPOST_LOGIN_SESSION', where: { kpost_id: kpostId } },
      correlationId,
    );
  }

  contact(
    ownerKpostId: string,
    contactId: string,
    correlationId?: string,
  ): Promise<UserContactRecord | undefined> {
    return this.db.findOne<UserContactRecord>(
      {
        table: 'TBL_KPOST_USER_CONTACTS',
        where: { kpost_id: ownerKpostId, contact_id: contactId },
      },
      correlationId,
    );
  }

  group(groupId: number | string, correlationId?: string): Promise<UserGroupRecord | undefined> {
    return this.db.findOne<UserGroupRecord>(
      { table: 'TBL_KPOST_USERGROUP_MASTER', where: { group_id: groupId } },
      correlationId,
    );
  }

  /** Members counted against `TBL_KPOST_ADMIN_REGISTRATION.maximum_members_count`. */
  activeCompanyMembers(companyId: number | string, correlationId?: string): Promise<number> {
    return this.db.count(
      { table: 'TBL_KPOST_USER_MASTER', where: { company_id: companyId, active_status: 'yes' } },
      correlationId,
    );
  }
}
