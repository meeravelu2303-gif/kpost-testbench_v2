/**
 * Reading the Contacts address-book response.
 *
 * Pure functions over an already-parsed body, so the matcher that decides "is this contact in the
 * address book?" can be proved meaningful by an offline framework test instead of only inside a
 * gated live run. That is the whole point: the assertion this replaces
 * (`expect.soft(true, 'the contact appears in myContacts').toBe(true)`) was a tautology, and a
 * tautology is only discoverable if the real matcher is reachable on its own.
 *
 * ## Field names come from the documented response, not from guesswork
 *
 * `POST /v2/contacts/myContacts/` answers `{ lastFetchDate, contacts_added: [...] }`, and each row
 * carries `contactID`, `kpostID`, `firstName`, `lastName`, `isBlocked`, `deleteStatus` …
 * (`contracts/kpost-api.contract.json`, myContacts response example). Only `contacts_added` and
 * `contactID` are relied on here; the rest are left alone.
 */

/** One address-book row. Only the fields this module reads are named; the row carries more. */
export interface ContactRow {
  readonly contactID?: unknown;
  readonly kpostID?: unknown;
  readonly isBlocked?: unknown;
  readonly deleteStatus?: unknown;
  readonly [key: string]: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The address-book rows in a `myContacts` body.
 *
 * Returns `[]` for anything that is not the documented shape — an unparsed body, an error envelope,
 * a missing key. An empty list is then indistinguishable from "no contacts", which is correct: in
 * both cases the caller has NOT observed the contact, and the assertion should fail rather than
 * quietly pass.
 */
export function contactRows(body: unknown): ContactRow[] {
  if (!isRecord(body)) return [];
  const rows = body.contacts_added;
  return Array.isArray(rows) ? rows.filter(isRecord) : [];
}

/**
 * The row for one contact id, or `undefined`.
 *
 * Compared case-insensitively on `contactID`, because a KPost id is an e-mail-shaped string and the
 * application echoes it back in its own casing.
 */
export function findContact(body: unknown, contactId: string): ContactRow | undefined {
  const wanted = contactId.trim().toLowerCase();
  if (!wanted) return undefined;
  return contactRows(body).find(
    (row) => typeof row.contactID === 'string' && row.contactID.trim().toLowerCase() === wanted,
  );
}

/** Whether a contact is present in the address book. */
export function hasContact(body: unknown, contactId: string): boolean {
  return findContact(body, contactId) !== undefined;
}
