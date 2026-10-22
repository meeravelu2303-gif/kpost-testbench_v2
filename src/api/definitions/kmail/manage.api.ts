import { testData } from '@config/test-data.config';
import { body } from '../kpost/kpost-endpoint';
import { defineKmailEndpoint, defineUndocumentedKmailEndpoint } from './kmail-endpoint';

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

/*
 * Dev-confirmed 2026-09-26: the previous 500 crash "was fixed by using some custom annotations" —
 * partly true. `kmailStatusFlag`'s mere PRESENCE (any int 0-4) avoids the crash, turning it into a
 * clean 400 `{"valueFor":"REPLY_NOT_SENT","message":"Parameter Invalid"}`; its ABSENCE still crashes
 * with a 500 `{"errorCode":"clear mails exception occured",...}` (see manage-workflow.spec.ts). No
 * value tried (0-4) ever clears "REPLY_NOT_SENT", even live-verified across a real reply exchange
 * between the two accounts — the exact contract remains Unknown/Requires Clarification.
 */
export const clearStatusApi = defineKmailEndpoint({
  id: 'kmail-clear-status',
  method: 'POST',
  path: '/common/clearStatusOfKmailsContacts/',
  summary: 'Clear the status of a contact’s mails',
  tags: [...M, 'status'],
  destructive: true,
  request: body(() => ({ selectedContact: testData.victimKpostId, kmailStatusFlag: 0 })),
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

/*
 * The e-mail-footer unsubscribe. The KPost workbook documents it under /v2/common (a KPost path the KPost
 * host does not serve: #725, closed WORKSFORME), but it is KMail's (CommonMailController
 * `@PostMapping("/saveUnsubscriberDetails")`, public in SecurityConfiguration, body = KmailUnsubscriber).
 * Defined here at its real home and mapped to the documented row via `contractPath`. A public write
 * with no delete/undo path, so it is never written on live: contract-validated off live, like the
 * enquiry capture (CLAUDE.md §5 rule 8).
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
    request: body(() => ({
      sender: testData.kpostId,
      receiver: testData.victimKpostId,
      reason: 'QA bench — safe to ignore',
      createdBy: testData.kpostId,
    })),
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
