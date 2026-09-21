import type { JsonObject } from '@utils/json';
import type { DatabaseClient } from '../database-client';

/**
 * Repository over the KMail tables on KPOST_QA. Full mapping and its surprises: `docs/KMAIL-SCHEMA.md`.
 *
 * The one structural fact worth repeating here, because it shapes every method below: **per-recipient
 * state is not on the mail.** `TBL_KPOST_KMAIL_MASTER` holds the mail once; read, star, delete and
 * recall are columns on `TBL_KPOST_KMAIL_TRANSACTION`, one row per recipient. "Is this mail read?"
 * therefore has as many answers as there are recipients, and a method that returned one boolean for
 * a mail would be answering a question the schema cannot answer.
 */

/** `TBL_KPOST_KMAIL_MASTER` — the mail. `kmail_subject` is ENCRYPTED at rest (longtext, not BLOB). */
export interface KmailMasterRecord extends JsonObject {
  kmail_id: number | string;
  /** Ciphertext. Never equal to the plaintext that was sent — see `docs/KMAIL-SCHEMA.md`. */
  kmail_subject: string | null;
  kmail_type: number | null;
  priority: number | null;
  send_date: Date | string;
  attachment_flag: number | null;
  note: Buffer | string | null;
}

/**
 * `TBL_KPOST_KMAIL_TRANSACTION` — one row per recipient.
 *
 * Every state column is a `char` holding `'Y'`, `'N'` or (on 107 legacy rows) a NUL byte — never a
 * boolean and never a tinyint. Read them through `kmailFlag()`, never with a truthiness test:
 * `'N'` is a non-empty string and is therefore truthy.
 */
export interface KmailTransactionRecord extends JsonObject {
  id: number | string;
  kmail_id: number | string;
  sender: string | null;
  receiver: string;
  /** 1 / 2 / 3 — To, Cc, confidential copy. */
  receiver_type: number;
  delivery_status: string;
  read_status: string;
  read_time: Date | string | null;
  reply_status: string;
  /** The "star" / flag, recorded separately for each side of the conversation. */
  marked_by_sender: string;
  marked_by_receiver: string;
  /** Soft delete, per side. A delete by one party must not remove the other's row. */
  deleted_by_sender: string;
  deleted_by_receiver: string;
  recall: string;
  /** A BLOB — comes back as a Buffer and needs `text()`. */
  receiver_name: Buffer | string | null;
  group_flag: number | null;
}

export class KmailRepository {
  constructor(private readonly db: DatabaseClient) {}

  mail(kmailId: number | string, correlationId?: string): Promise<KmailMasterRecord | undefined> {
    return this.db.findOne<KmailMasterRecord>(
      { table: 'TBL_KPOST_KMAIL_MASTER', where: { kmail_id: kmailId } },
      correlationId,
    );
  }

  /** Every recipient row for one mail — the fan-out a single send produced. */
  recipients(kmailId: number | string, correlationId?: string): Promise<KmailTransactionRecord[]> {
    return this.db.findMany<KmailTransactionRecord>(
      { table: 'TBL_KPOST_KMAIL_TRANSACTION', where: { kmail_id: kmailId } },
      correlationId,
    );
  }

  /** One recipient's state for one mail: the row every read/star/delete assertion is made against. */
  recipient(
    kmailId: number | string,
    receiver: string,
    correlationId?: string,
  ): Promise<KmailTransactionRecord | undefined> {
    return this.db.findOne<KmailTransactionRecord>(
      { table: 'TBL_KPOST_KMAIL_TRANSACTION', where: { kmail_id: kmailId, receiver } },
      correlationId,
    );
  }

  /** Transaction rows addressed to an account, newest first by id. */
  inbox(receiver: string, correlationId?: string): Promise<KmailTransactionRecord[]> {
    return this.db.findMany<KmailTransactionRecord>(
      { table: 'TBL_KPOST_KMAIL_TRANSACTION', where: { receiver } },
      correlationId,
    );
  }
}
