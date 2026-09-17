import { testData } from '@config/test-data.config';
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
/*
 * The COMPLETE documented payloads (KMAILAPI tab / openapi/kmail-api.openapi.json), reused by the
 * "full" signature below. Missing fields here previously caused false bugs — the API validated the
 * absent `emailId`/`mobileNumber` (etc.) and answered an error. Values are QA-safe and allowlisted:
 * `mobileNumber` uses our QA mobile, `emailId` our QA e-mail — never a real person's contact.
 */
const SIG_PERSONAL = {
  firstName: 'QA',
  lastName: 'Tester',
  designation: 'QA Engineer',
  emailId: testData.otpEmail,
  mobileNumber: testData.mobileExists,
  alternateMobile: '',
};
const SIG_COMPANY = {
  companyName: 'QA Co',
  website: 'https://kpostindia.com',
  addressLine1: 'QA Bench Address Line 1',
  addressLine2: 'QA Bench Address Line 2',
};
const SIG_GRAPHICS = { photoUrl: '', bannerUrl: '', bannerLinkingTo: '' };
const SIG_STYLE = { color: '#1A73E8', fontStyle: 'Arial, sans-serif' };
const SIG_SOCIAL = { twitter: '', facebook: '', instagram: '', linkedIn: '', youTube: '' };

export const sigPersonalApi = w(
  'kmail-sig-personal',
  '/kmailSetting/saveOrUpdateMailSignaturePersonalData',
  'Signature — personal data',
  { ...SIG_PERSONAL },
);
export const sigCompanyApi = w(
  'kmail-sig-company',
  '/kmailSetting/saveOrUpdateMailSignatureCompanyData',
  'Signature — company data',
  { ...SIG_COMPANY },
);
export const sigGraphicsApi = w(
  'kmail-sig-graphics',
  '/kmailSetting/saveOrUpdateMailSignatureGraphics',
  'Signature — graphics',
  { ...SIG_GRAPHICS },
);
export const sigStyleApi = w(
  'kmail-sig-style',
  '/kmailSetting/saveOrUpdateMailSignatureStyle',
  'Signature — style',
  { ...SIG_STYLE },
);
export const sigSocialApi = w(
  'kmail-sig-social',
  '/kmailSetting/saveOrUpdateMailSignatureSocialMediaLink',
  'Signature — social links',
  { ...SIG_SOCIAL },
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
  {
    personalData: { ...SIG_PERSONAL },
    companyData: { ...SIG_COMPANY },
    graphics: { ...SIG_GRAPHICS },
    style: { ...SIG_STYLE },
    socialMedialink: { ...SIG_SOCIAL },
  },
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
