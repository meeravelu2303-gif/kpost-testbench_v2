import { testData } from '@config/test-data.config';
import { body } from '../kpost/kpost-endpoint';
import { defineKmailEndpoint } from './kmail-endpoint';

/**
 * KMail **manage** — delete, mark-important, clear status, convert-to-PDF, external-domain contacts,
 * OD attachment download, and mail credentials. All write / act on the caller's own mail; **none is
 * `productionSafe`**. The external-domain contact writes take a non-KPost email — the guard refuses a
 * stranger's, so those are exercised only with an owned address and stay off live otherwise.
 * `getMailCredentials` returns account credentials and takes a password, so it is registered but not
 * driven on live.
 */
const M = ['kmail-manage'] as const;

export const deleteKmailApi = defineKmailEndpoint({
  id: 'kmail-delete',
  requirements: ['FR-M07'],
  method: 'POST',
  path: '/common/deleteKmailWithDeletedBy/',
  summary: 'Delete a mail (by transaction ids)',
  tags: [...M, 'critical'],
  destructive: true,
  request: body(() => ({ groupFlag: false, transactionIDs: [] as number[] })),
  note: 'needs real transactionIDs from a sent mail; exercised by the lifecycle',
});

export const setImportantApi = defineKmailEndpoint({
  id: 'kmail-set-important',
  method: 'POST',
  path: '/common/setKmailAsImportant/',
  summary: 'Mark or unmark a mail as important',
  tags: [...M, 'important'],
  destructive: true,
  request: body(() => ({ kmailID: 0 })),
  note: 'needs a real kmailID; exercised by the lifecycle',
});

export const clearStatusApi = defineKmailEndpoint({
  id: 'kmail-clear-status',
  method: 'POST',
  path: '/common/clearStatusOfKmailsContacts/',
  summary: 'Clear the status of a contact’s mails',
  tags: [...M, 'status'],
  destructive: true,
  request: body(() => ({ selectedContact: testData.victimKpostId })),
  note: 'clears our own view of a contact’s mail status',
});

export const clearAllStatusApi = defineKmailEndpoint({
  id: 'kmail-clear-all-status',
  method: 'POST',
  path: '/common/clearStatusOfAllKmailsContacts',
  summary: 'Clear the status of all contacts’ mails',
  tags: [...M, 'status'],
  destructive: true,
  note: 'workbook documents no body; clears our own status view',
});

export const convertPdfApi = defineKmailEndpoint({
  id: 'kmail-convert-pdf',
  method: 'POST',
  path: '/common/convertMailAsPDF/',
  summary: 'Convert a mail to PDF',
  tags: [...M],
  destructive: true,
  request: body(() => ({ kmailID: 0 })),
  note: 'needs a real kmailID',
});

export const addOtherDomainContactApi = defineKmailEndpoint({
  id: 'kmail-add-od-contact',
  requirements: ['FR-KM-022'],
  method: 'POST',
  path: '/common/addOtherDomainContacts/',
  summary: 'Add a non-KPost (external) mail contact',
  tags: [...M, 'external'],
  destructive: true,
  request: body(() => ({
    contactEmailID: testData.kpostId,
    contactName: 'QA',
    referenceName: 'QA',
  })),
  note: 'external contact; guard refuses a stranger email, so an owned address is used',
});

export const deleteOtherDomainContactApi = defineKmailEndpoint({
  id: 'kmail-delete-od-contact',
  method: 'POST',
  path: '/common/deleteOtherDomainContact/',
  summary: 'Delete a non-KPost mail contact',
  tags: [...M, 'external'],
  destructive: true,
  request: body(() => ({ contactEmailID: testData.kpostId })),
});

export const editOtherDomainContactApi = defineKmailEndpoint({
  id: 'kmail-edit-od-contact',
  method: 'POST',
  path: '/common/editOtherDomainContactsDetails/',
  summary: 'Edit a non-KPost mail contact',
  tags: [...M, 'external'],
  destructive: true,
  request: body(() => ({ contactEmailID: testData.kpostId, contactName: 'QA Edited' })),
});

export const downloadOdAttachmentApi = defineKmailEndpoint({
  id: 'kmail-download-od-attachment',
  method: 'POST',
  path: '/readMail/downloadODAttachment',
  contractPath: '/v2/readMail/downloadODAttachment',
  summary: 'Download an other-domain mail attachment',
  tags: [...M, 'attachment', 'needs-id'],
  destructive: true,
  request: body(() => ({ kmailID: 0, kmailNumber: 0, kmailType: 'sent', groupFlag: false })),
  note: 'needs a real kmailID',
});

export const mailCredentialsApi = defineKmailEndpoint({
  id: 'kmail-credentials',
  method: 'POST',
  path: '/sentMail/getMailCredentials/',
  summary: 'Fetch the caller’s mail send credentials',
  tags: [...M, 'sensitive'],
  /*
   * Returns account mail credentials and takes a password. Registered for contract validation but
   * NOT driven on live — sending a real password and receiving credentials is a sensitive operation.
   */
  destructive: true,
  sideEffect: 'global',
  request: body(() => ({ kpostID: testData.kpostId, password: '' })),
  note: 'sensitive: returns credentials; not driven on live',
});

export const kmailManageApis = [
  deleteKmailApi,
  setImportantApi,
  clearStatusApi,
  clearAllStatusApi,
  convertPdfApi,
  addOtherDomainContactApi,
  deleteOtherDomainContactApi,
  editOtherDomainContactApi,
  downloadOdAttachmentApi,
  mailCredentialsApi,
];
