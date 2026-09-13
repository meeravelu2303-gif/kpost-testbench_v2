import { testData } from '@config/test-data.config';
import { body } from '../kpost-endpoint';
import { defineContactsEndpoint } from './contacts-endpoint';

/**
 * Contacts **writes** — add / delete a contact, add a reference, block / unblock, import phone
 * contacts, and update an invite status.
 *
 * Every one modifies the caller's own address book and **none is `productionSafe`**. The
 * account-targeting writes (add/delete/block, single and bulk, and the reference) target our own
 * second account, so the identifier guard permits them; they run through the gated feature flow
 * (`KALL`-style, `CONTACTS_LIFECYCLE=true`) with `allowLiveWrite`, self-restoring. `importPhoneContacts`
 * and `updateInviteStatus` carry phone numbers / an invite action, so they stay contract-validated
 * off-live and are not driven on the live application. Payloads mirror the live client
 * (`Services/Contacts.js`, `BlockContact.js`).
 */
const WRITE_TAGS = ['contacts-write'] as const;

const contactShape = (): Record<string, unknown> => ({
  contactID: testData.victimKpostId,
  firstName: 'Qa',
  lastName: 'Tester',
  userType: 'PERSONAL',
});

export const addContactApi = defineContactsEndpoint({
  id: 'contacts-add',
  method: 'POST',
  path: '/v2/contacts/addContact',
  summary: 'Add a contact to the address book',
  tags: [...WRITE_TAGS, 'critical'],
  // Adds our own second account to our contacts. Cleaned up by the lifecycle (delete).
  destructive: true,
  request: body(() => contactShape()),
});

export const addMultipleContactApi = defineContactsEndpoint({
  id: 'contacts-add-multiple',
  method: 'POST',
  path: '/v2/contacts/addMultipleContact',
  summary: 'Add several contacts at once',
  tags: [...WRITE_TAGS, 'bulk'],
  destructive: true,
  request: body(() => contactShape()),
  note: 'workbook example is a single contact; bulk shape confirmed on the first authorized write',
});

export const addContactReferenceApi = defineContactsEndpoint({
  id: 'contacts-add-reference',
  method: 'POST',
  path: '/v2/contacts/addContactReference/',
  summary: 'Attach a reference note to a contact',
  tags: [...WRITE_TAGS, 'reference'],
  destructive: true,
  request: body(() => ({ contactID: testData.victimKpostId, referenceName: 'QA reference' })),
});

export const deleteContactApi = defineContactsEndpoint({
  id: 'contacts-delete',
  method: 'POST',
  path: '/v2/contacts/deleteContact/',
  summary: 'Delete a contact from the address book',
  tags: [...WRITE_TAGS, 'critical'],
  destructive: true,
  request: body(() => ({ contactID: testData.victimKpostId })),
});

export const blockContactApi = defineContactsEndpoint({
  id: 'contacts-block',
  method: 'POST',
  path: '/v2/contacts/blockOrUnBlockContact/',
  summary: 'Block or unblock a contact',
  tags: [...WRITE_TAGS, 'block'],
  /*
   * `{contactID, isBlocked}` from the live client (BlockContact.js). Blocks our own second account;
   * the lifecycle unblocks it afterward, so the accounts are left as they were.
   */
  destructive: true,
  request: body(() => ({ contactID: testData.victimKpostId, isBlocked: true })),
  note: 'workbook documents no body; shape from the live client',
});

export const blockMultipleContactApi = defineContactsEndpoint({
  id: 'contacts-block-multiple',
  method: 'POST',
  path: '/v2/contacts/blockOrUnBlockMultipleContact',
  summary: 'Block or unblock several contacts at once',
  tags: [...WRITE_TAGS, 'block', 'bulk'],
  destructive: true,
  request: body(() => ({ contactIDs: [testData.victimKpostId], isBlocked: true })),
});

export const importPhoneContactsApi = defineContactsEndpoint({
  id: 'contacts-import-phone',
  method: 'POST',
  path: '/v2/contacts/importPhoneContacts/',
  summary: "Import the device's phone contacts",
  tags: [...WRITE_TAGS, 'import'],
  /*
   * Carries phone numbers and can match/notify them, so it stays off-live (contract-validated only).
   * The payload uses our own number to keep the guard satisfied when it does run off-live.
   */
  destructive: true,
  request: body(() => ({
    deviceID: 'qa-bench-device',
    mobileNumber: testData.mobileExists,
    countryCode: '91',
    phoneContacts: [{ name: 'QA', mobileNumber: testData.mobileExists }],
  })),
  note: 'carries phone numbers; not driven on live',
});

export const updateInviteStatusApi = defineContactsEndpoint({
  id: 'contacts-update-invite',
  method: 'POST',
  path: '/v2/contacts/updateInviteStatus/',
  summary: 'Update the status of a contact invite',
  tags: [...WRITE_TAGS, 'invite'],
  destructive: true,
  request: body(() => ({ mobileNumber: testData.mobileExists })),
  note: 'invite action; not driven on live',
});

export const contactsWriteApis = [
  addContactApi,
  addMultipleContactApi,
  addContactReferenceApi,
  deleteContactApi,
  blockContactApi,
  blockMultipleContactApi,
  importPhoneContactsApi,
  updateInviteStatusApi,
];
