import { KMAIL_TYPE } from '@api/schemas/kpost-types';
import { body } from '../kpost/kpost-endpoint';
import { defineKmailEndpoint } from './kmail-endpoint';
import { mailShape } from './send.api';

/**
 * KMail **drafts** — save a draft (`kmailType: 4`), multipart draft, and delete a draft. Each writes
 * to the caller's own drafts; **none is `productionSafe`** (gated `KMAIL_LIFECYCLE`, self-cleaning).
 */
const DRAFT_TAGS = ['kmail-draft', 'draft'] as const;

export const draftMailApi = defineKmailEndpoint({
  id: 'kmail-draft-save',
  requirements: ['FR-M02'],
  method: 'POST',
  path: '/draft/draftMail/',
  summary: 'Save a mail as a draft',
  tags: [...DRAFT_TAGS],
  destructive: true,
  request: body(() => mailShape({ kmailType: KMAIL_TYPE.draft })),
  note: 'workbook documents no body; reuses the compose shape with kmailType Draft',
});

export const draftMailMultipartApi = defineKmailEndpoint({
  id: 'kmail-draft-multipart',
  method: 'POST',
  path: '/draft/draftMailMultiPart',
  summary: 'Save a draft with attachments (multipart)',
  tags: [...DRAFT_TAGS, 'attachment'],
  destructive: true,
  request: () => ({
    multipart: {
      text: JSON.stringify(mailShape({ kmailType: KMAIL_TYPE.draft })),
      file: {
        name: 'qa-bench.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('QA bench draft attachment', 'utf8'),
      },
    },
  }),
});

export const deleteDraftApi = defineKmailEndpoint({
  id: 'kmail-draft-delete',
  method: 'POST',
  path: '/draft/deleteDraftMail/',
  summary: 'Delete a draft',
  tags: [...DRAFT_TAGS, 'critical'],
  destructive: true,
  request: body(() => ({ kmailID: '0', draftMailID: '' })),
  note: 'needs a real draftMailID from draftMail; exercised by the lifecycle',
});

export const kmailDraftApis = [draftMailApi, draftMailMultipartApi, deleteDraftApi];
