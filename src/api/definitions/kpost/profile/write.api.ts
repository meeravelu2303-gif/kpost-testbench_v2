import { testData } from '@config/test-data.config';
import { z } from 'zod';
import { body } from '../kpost-endpoint';
import { defineProfileEndpoint, defineUndocumentedProfileEndpoint } from './profile-endpoint';

/**
 * Profile writes on our own profile (`data`). None is `productionSafe`; the feature flow restores
 * what it changes.
 */
const WRITE_TAGS = ['profile-write'] as const;

export const updateAboutApi = defineProfileEndpoint({
  id: 'profile-update-about',
  method: 'POST',
  path: '/v2/profile/updateAboutYourself/',
  summary: "Update the caller's 'about' text",
  tags: [...WRITE_TAGS],
  destructive: true,
  sideEffect: 'data',
  request: body(() => ({ aboutYourself: 'QA bench about' })),
});

export const updateDesignationApi = defineProfileEndpoint({
  id: 'profile-update-designation',
  method: 'POST',
  path: '/v2/profile/updateDesignation',
  summary: "Update the caller's designation",
  tags: [...WRITE_TAGS],
  destructive: true,
  sideEffect: 'data',
  request: body(() => ({ designation: 'QA Bench Tester' })),
});

export const updateBasicApi = defineProfileEndpoint({
  id: 'profile-update-basic',
  method: 'POST',
  path: '/v2/profile/updateBasicInformation/',
  summary: "Update the caller's basic information",
  tags: [...WRITE_TAGS],
  destructive: true,
  sideEffect: 'data',
  request: body(() => ({
    knownLanguages: ['English'],
    designation: 'QA Bench Tester',
    gender: 'Female',
    // dateOfBirth is required — the API 500s without it (found on the live lifecycle run).
    dateOfBirth: '1995-01-01',
    otherEmail: testData.otpEmail,
  })),
});

export const updateContactApi = defineProfileEndpoint({
  id: 'profile-update-contact',
  method: 'POST',
  path: '/v2/profile/updateContactInformation/',
  summary: "Update the caller's contact information",
  tags: [...WRITE_TAGS],
  destructive: true,
  sideEffect: 'data',
  request: body(() => ({
    country: 'INDIA',
    pinCode: testData.pinCode,
    city: 'Chennai',
    areaName: 'QA Bench',
    addressLine1: 'QA Bench Address',
  })),
});

export const updatePrivacyApi = defineProfileEndpoint({
  id: 'profile-update-privacy',
  method: 'POST',
  path: '/v2/profile/updatePrivacySettingDetails/',
  summary: "Update the caller's privacy settings",
  tags: [...WRITE_TAGS, 'security'],
  destructive: true,
  sideEffect: 'data',
  request: body(() => ({
    privacyDetails: JSON.stringify({
      about: 'false',
      experience: 'false',
      school: 'true',
      college: 'true',
    }),
  })),
});

export const shareUserDetailsApi = defineProfileEndpoint({
  id: 'profile-share-user-details',
  method: 'POST',
  path: '/v2/profile/shareUserDetails',
  summary: "Share the caller's details with a contact",
  tags: [...WRITE_TAGS, 'needs-recipients'],
  destructive: true,
  sideEffect: 'data',
  request: body(() => ({ kpostID: testData.victimKpostId })),
});

// Education / experience records. Deletes are `needs-record-id`: the lifecycle creates a record
// first.
const saveEducation = (path: string, id: string, payload: Record<string, unknown>) =>
  defineProfileEndpoint({
    id,
    method: 'POST',
    path,
    summary: `Save or update ${id.replace('profile-save-', '')} details`,
    tags: [...WRITE_TAGS, 'education'],
    destructive: true,
    sideEffect: 'data',
    request: body(() => payload),
  });

export const saveCollegeApi = saveEducation(
  '/v2/profile/saveOrUpdateCollegeDetails/',
  'profile-save-college',
  {
    collegeDetails: [
      {
        collegeID: '',
        collegeName: 'QA Bench College',
        degree: 'QA',
        fromYear: '2010',
        toYear: '2014',
      },
    ],
  },
);

export const saveSchoolApi = saveEducation(
  '/v2/profile/saveOrUpdateSchoolDetails/',
  'profile-save-school',
  { schoolDetails: [{ schoolID: '', schoolName: 'QA Bench School', standard: '10' }] },
);

export const saveUniversityApi = saveEducation(
  '/v2/profile/saveOrUpdateUniversityDetails/',
  'profile-save-university',
  {
    universityDetails: [
      { universityID: '', universityName: 'QA Bench University', degree: 'Masters' },
    ],
  },
);

export const saveOtherActivityApi = saveEducation(
  '/v2/profile/saveOrUpdateOtherActivity/',
  'profile-save-other-activity',
  { otherActivities: [{ activityID: '', title: 'QA', achievements: 'QA bench activity' }] },
);

export const saveExperienceApi = saveEducation(
  '/v2/profile/saveOrUpdateExperienceDetails/',
  'profile-save-experience',
  {
    experienceDetails: [
      { experienceID: '', companyName: 'QA Bench Pvt Ltd', designation: 'QA', fromYear: '2020' },
    ],
  },
);

const deleteRecord = (path: string, id: string, field: string) =>
  defineProfileEndpoint({
    id,
    method: 'POST',
    path,
    summary: `Delete a ${field.replace('ID', '')} record`,
    tags: [...WRITE_TAGS, 'education', 'needs-record-id'],
    destructive: true,
    sideEffect: 'data',
    request: body(() => ({ [field]: '00000000-0000-4000-8000-000000000000' })),
    note: `needs a real ${field}`,
  });

export const deleteCollegeApi = deleteRecord(
  '/v2/profile/deleteCollegeDetail',
  'profile-delete-college',
  'collegeID',
);
export const deleteSchoolApi = deleteRecord(
  '/v2/profile/deleteSchoolDetail',
  'profile-delete-school',
  'schoolID',
);
export const deleteUniversityApi = deleteRecord(
  '/v2/profile/deleteUniversityDetail',
  'profile-delete-university',
  'universityID',
);
export const deleteExperienceApi = deleteRecord(
  '/v2/profile/deleteExperienceDetail',
  'profile-delete-experience',
  'experienceID',
);

/** Not in the workbook: deletes an "other activity" record (OtherActivities.js:74-79). */
export const deleteOtherActivityApi = defineUndocumentedProfileEndpoint({
  id: 'profile-delete-other-activity',
  method: 'POST',
  path: '/v2/profile/deleteOtherActivity',
  summary: 'Delete an other-activity record',
  tags: [...WRITE_TAGS, 'education', 'needs-record-id'],
  evidence: 'Setting.js:490-516 (OtherActivityList), caller OtherActivities.js:74-79',
  destructive: true,
  sideEffect: 'data',
  requestSchema: z.object({ activityID: z.string() }),
  request: body(() => ({ activityID: '00000000-0000-4000-8000-000000000000' })),
  note: 'needs a real activityID',
});

export const profileWriteApis = [
  updateAboutApi,
  updateDesignationApi,
  updateBasicApi,
  updateContactApi,
  updatePrivacyApi,
  shareUserDetailsApi,
  saveCollegeApi,
  saveSchoolApi,
  saveUniversityApi,
  saveOtherActivityApi,
  saveExperienceApi,
  deleteCollegeApi,
  deleteSchoolApi,
  deleteUniversityApi,
  deleteExperienceApi,
  deleteOtherActivityApi,
];
