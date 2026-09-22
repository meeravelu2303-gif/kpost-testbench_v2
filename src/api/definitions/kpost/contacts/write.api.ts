import { testData } from '@config/test-data.config';
import { body } from '../kpost-endpoint';
import { defineContactsEndpoint } from './contacts-endpoint';

/**
 * Contacts **writes** — add / delete a contact, add a reference, block / unblock, import phone
 * contacts, and update an invite status.
 *
 * Every one modifies the caller's own address book and **none is `productionSafe`**. The
 * account-targeting writes target our own second account, so the identifier guard permits them; all
 * run through the gated feature flow (`CONTACTS_LIFECYCLE=true`) with `allowLiveWrite`, self-restoring.
 * `importPhoneContacts` and `updateInviteStatus` carry phone numbers / an invite action, so the flow
 * drives them with **only our own number** — no other user's data is touched. Payloads mirror the
 * live client (`Services/Contacts.js`, `BlockContact.js`).
 */
const WRITE_TAGS = ['contacts-write'] as const;

/**
 * The add-contact payload. Exported so a workflow spec can target a specific counterparty without
 * hand-copying the field list — which is how a payload drifts out of sync with the endpoint.
 */
export const contactShape = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  contactID: testData.victimKpostId,
  firstName: 'Qa',
  lastName: 'Tester',
  userType: 'PERSONAL',
  ...overrides,
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
  // Carries phone numbers, so the flow imports ONLY our own number — no stranger is matched/notified.
  destructive: true,
  request: body(() => ({
    deviceID: 'qa-bench-device',
    mobileNumber: testData.mobileExists,
    countryCode: '91',
    phoneContacts: [{ name: 'QA', mobileNumber: testData.mobileExists }],
  })),
  note: 'carries phone numbers; driven live with our own number only',
});

export const updateInviteStatusApi = defineContactsEndpoint({
  id: 'contacts-update-invite',
  method: 'POST',
  path: '/v2/contacts/updateInviteStatus/',
  summary: 'Update the status of a contact invite',
  tags: [...WRITE_TAGS, 'invite'],
  destructive: true,
  request: body(() => ({ mobileNumber: testData.mobileExists })),
  note: 'invite action; driven live with our own number only',
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
