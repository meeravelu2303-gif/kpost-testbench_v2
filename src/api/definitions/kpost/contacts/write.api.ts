import { testData } from '@config/test-data.config';
import { typesOnlySchema } from '@api/schema/sample-schema';
import { body } from '../kpost-endpoint';
import { defineContactsEndpoint } from './contacts-endpoint';

/**
 * Contacts writes on the caller's own address book, targeting our second account or our own number.
 * None is `productionSafe`; the self-restoring CONTACTS_LIFECYCLE flow drives them.
 */
const WRITE_TAGS = ['contacts-write'] as const;

/** The add-contact payload, shared so a workflow spec can target another counterparty. */
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
  // The controller takes a JSON array; a single object is "Malformed or missing request body".
  request: body(() => [contactShape()]),
  note: 'backend takes a JSON array of contacts (ContactsDirectoryControllerV2.addMultipleContact)',
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
  // Blocks our second account (BlockContact.js shape); the lifecycle unblocks it afterwards.
  destructive: true,
  request: body(() => ({ contactID: testData.victimKpostId, isBlocked: true })),
  requestSchema: typesOnlySchema({ contactID: testData.victimKpostId, isBlocked: true }),
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
