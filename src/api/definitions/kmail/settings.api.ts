import { body } from '../kpost/kpost-endpoint';
import { defineKmailEndpoint } from './kmail-endpoint';

/**
 * KMail **settings** writes — signature (personal/company/graphics/style/social/template/full),
 * instant reply, customized saluations, letterhead, and the mail-count days limit. All change the
 * caller's own KMail preferences; **none is `productionSafe`** (gated `KMAIL_LIFECYCLE`,
 * self-restoring where a create/delete pair exists).
 */
const S = ['kmail-settings', 'settings'] as const;

const w = (
  id: string,
  path: string,
  summary: string,
  bodyObj: Record<string, unknown>,
  note?: string,
) =>
  defineKmailEndpoint({
    id,
    method: 'POST',
    path,
    summary,
    tags: [...S],
    destructive: true,
    request: body(() => bodyObj),
    ...(note ? { note } : {}),
  });

export const saveInstantReplyApi = w(
  'kmail-set-instant-reply',
  '/kmailSetting/saveOrUpdateCustomizedInstantReply',
  'Save/update instant reply',
  { id: '', instantReply: 'QA bench auto-reply' },
);
export const deleteInstantReplyApi = w(
  'kmail-delete-instant-reply',
  '/kmailSetting/deleteCustomizedInstantReply',
  'Delete instant reply',
  { id: '' },
  'needs a real id',
);
export const saveSaluationApi = w(
  'kmail-save-saluation',
  '/kmailSetting/saveOrUpdateCustomizedSaluations',
  'Save/update a saluation',
  { saluationID: '', saluation: 'QA Dr' },
);
export const deleteSaluationApi = w(
  'kmail-delete-saluation',
  '/kmailSetting/deleteCustomizedSaluation',
  'Delete a saluation',
  { saluationID: '' },
  'needs a real saluationID',
);
export const setLetterHeadApi = w(
  'kmail-set-letterhead',
  '/kmailSetting/setLetterHead',
  'Set the active letterhead',
  { id: '' },
  'needs a real letterhead id',
);
export const deleteLetterHeadApi = w(
  'kmail-delete-letterhead',
  '/kmailSetting/deleteLetterHead',
  'Delete a letterhead',
  { id: '' },
  'needs a real letterhead id',
);
export const sigPersonalApi = w(
  'kmail-sig-personal',
  '/kmailSetting/saveOrUpdateMailSignaturePersonalData',
  'Signature — personal data',
  { firstName: 'QA', lastName: 'Tester', designation: 'QA' },
);
export const sigCompanyApi = w(
  'kmail-sig-company',
  '/kmailSetting/saveOrUpdateMailSignatureCompanyData',
  'Signature — company data',
  { companyName: 'QA Co', website: 'https://kpostindia.com' },
);
export const sigGraphicsApi = w(
  'kmail-sig-graphics',
  '/kmailSetting/saveOrUpdateMailSignatureGraphics',
  'Signature — graphics',
  { photoUrl: '' },
);
export const sigStyleApi = w(
  'kmail-sig-style',
  '/kmailSetting/saveOrUpdateMailSignatureStyle',
  'Signature — style',
  { color: '#1A73E8', fontStyle: 'Arial, sans-serif' },
);
export const sigSocialApi = w(
  'kmail-sig-social',
  '/kmailSetting/saveOrUpdateMailSignatureSocialMediaLink',
  'Signature — social links',
  { twitter: '', facebook: '' },
);
export const sigTemplateApi = w(
  'kmail-sig-template',
  '/kmailSetting/saveOrUpdateMailSignatureTemplateId',
  'Signature — template id',
  { templateID: 1 },
);
export const sigFullApi = w(
  'kmail-sig-full',
  '/kmailSetting/saveOrUpdateMailSignature',
  'Signature — full',
  { personalData: { firstName: 'QA', lastName: 'Tester', designation: 'QA' } },
);
export const countDaysLimitApi = w(
  'kmail-count-days-limit-update',
  '/kmailSetting/updateMailCountDaysLimit',
  'Update the mail-count days limit',
  { countDaysLimit: 60 },
);

export const kmailSettingsApis = [
  saveInstantReplyApi,
  deleteInstantReplyApi,
  saveSaluationApi,
  deleteSaluationApi,
  setLetterHeadApi,
  deleteLetterHeadApi,
  sigPersonalApi,
  sigCompanyApi,
  sigGraphicsApi,
  sigStyleApi,
  sigSocialApi,
  sigTemplateApi,
  sigFullApi,
  countDaysLimitApi,
];
