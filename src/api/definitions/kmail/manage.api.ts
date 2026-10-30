import { typesOnlySchema } from '@api/schema/sample-schema';
import { testData } from '@config/test-data.config';
import { body } from '../kpost/kpost-endpoint';
import { defineKmailEndpoint, defineUndocumentedKmailEndpoint } from './kmail-endpoint';

/**
 * KMail manage actions on the caller's own mail (delete, mark, clear status, PDF, external
 * contacts, credentials). None is `productionSafe`.
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

// Without `kmailStatusFlag` this 500s; its valid values are unclear (see manage-workflow.spec.ts).
export const clearStatusApi = defineKmailEndpoint({
  id: 'kmail-clear-status',
  method: 'POST',
  path: '/common/clearStatusOfKmailsContacts/',
  summary: 'Clear the status of a contact’s mails',
  tags: [...M, 'status'],
  destructive: true,
  request: body(() => ({ selectedContact: testData.victimKpostId, kmailStatusFlag: 0 })),
  requestSchema: typesOnlySchema({ selectedContact: testData.victimKpostId, kmailStatusFlag: 0 }),
  note: 'kmailStatusFlag required to avoid a 500 crash, but no value satisfies REPLY_NOT_SENT — contract still Unknown/Requires Clarification',
});

export const clearAllStatusApi = defineKmailEndpoint({
  id: 'kmail-clear-all-status',
  method: 'POST',
  path: '/common/clearStatusOfAllKmailsContacts',
  summary: 'Clear the status of all contacts’ mails',
  tags: [...M, 'status'],
  destructive: true,
  request: body(() => ({ kmailStatusFlag: 0 })),
  requestSchema: typesOnlySchema({ kmailStatusFlag: 0 }),
  note: 'same Unknown/Requires Clarification contract as kmail-clear-status',
});

export const convertPdfApi = defineKmailEndpoint({
  id: 'kmail-convert-pdf',
  method: 'POST',
  path: '/common/convertMailAsPDF/',
  summary: 'Convert a mail to PDF',
  tags: [...M],
  destructive: true,
  request: body(() => ({ kmailID: 0 })),
  requestSchema: typesOnlySchema({ kmailID: 0 }),
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
  // Takes a password and returns credentials, so it is contract-validated but never driven on live.
  destructive: true,
  sideEffect: 'global',
  request: body(() => ({ kpostID: testData.kpostId, password: '' })),
  note: 'sensitive: returns credentials; not driven on live',
});

/** The unsubscribe body (sender, receiver, reason, createdBy). */
const unsubscriberBody = () => ({
  sender: testData.kpostId,
  receiver: testData.victimKpostId,
  reason: 'QA bench — safe to ignore',
  createdBy: testData.kpostId,
});

/*
 * The e-mail-footer unsubscribe: documented under KPost's /v2/common but served by KMail, so it
 * maps to that row via `contractPath`. A public write with no undo, so it is never written on live.
 */
export const saveUnsubscriberApi = {
  ...defineUndocumentedKmailEndpoint({
    id: 'kmail-save-unsubscriber',
    method: 'POST',
    path: '/common/saveUnsubscriberDetails',
    summary: 'Record an e-mail unsubscribe (public footer link)',
    evidence:
      'not called by the web app; KMail backend CommonMailController /saveUnsubscriberDetails, public per SecurityConfiguration',
    tags: ['public-write'],
    authentication: { required: false },
    destructive: true,
    sideEffect: 'data',
    note: 'public write with no delete path; never written on live',
    request: body(() => unsubscriberBody()),
    requestSchema: typesOnlySchema(unsubscriberBody()),
  }),
  contractPath: '/v2/common/saveUnsubscriberDetails',
};

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
  saveUnsubscriberApi,
];
