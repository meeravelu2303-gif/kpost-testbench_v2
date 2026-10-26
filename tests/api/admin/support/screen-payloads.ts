import { testData } from '@config/test-data.config';

/**
 * The Admin screens' own, complete save payloads (ADMIN_HR_MODULES_25), in one place for every Admin spec.
 *
 * Why one place: on 2026-10-26 the server started enforcing the fields the screens require (#13245, #13246,
 * #13252, #13253 fixed). Specs that each built a minimal record of their own (no date of birth, no state …)
 * all broke at once; with this module a future rule change is a single edit. Every value is a QA value: the
 * employee's mobile and e-mail are the reserved QA test-employee identity (QA_ROLE_EMPLOYEE_MOBILE/EMAIL).
 */
type Json = Record<string, unknown>;

/** Work Place / HR Breakdown tier (WPSetupTier / HRSetupTier). Saves take `[tier]`. */
export const tierPayload = (attributeName: string): Json => ({ attributeName });

/** A top-level variable under `attributeId` (WPSetupVariable / HRSetupVariable). Saves take `[variable]`. */
export const variablePayload = (attributeId: string, variableName: string): Json => ({
  variableName,
  attributeId,
  parentVariableId: 0,
  parentAttributeId: 0,
  reportingJson: '[]',
});

/**
 * A workplace location (WorkPlaceLocationSetup.js:98-120, required :1228-1236): the level, name, country,
 * 6-digit pincode with its state/city/area, and both address lines.
 */
export const locationPayload = (
  attributeId: string,
  variableId: string,
  locationName: string,
): Json => ({
  attributeId,
  variableId,
  workPlaceLocation: JSON.stringify([{ attributeId, variableId, variableName: locationName }]),
  reportingWorkplaceLocation: '[{"variableId":"0","workplaceLocationId":"0"}]',
  reportingWorkplaceLocationId: '0',
  locationName,
  pincode: testData.pinCode,
  state: 'Tamil Nadu',
  city: 'Chennai',
  area: 'Chennai',
  addressLine1: 'QA bench street',
  addressLine2: 'QA bench area',
  countryId: 1,
  countryName: 'India',
});

/**
 * An employee, all six Employee Data steps (ManualEntry.js:261-420). `lastName` identifies the test's record
 * (the leftovers tool matches the stamped QA patterns). Saves take the object itself, not an array.
 */
export const employeePayload = (lastName: string, firstName = 'QA'): Json => ({
  personalInformationObj: {
    firstName,
    lastName,
    dob: '1990-01-15',
    gender: 'Male',
    maritalStatus: 'Single',
    landline: '0442345678',
    mobile: testData.roleEmployeeMobile,
    alternativeMobileNo: testData.roleEmployeeMobile,
    emailAddress: testData.roleEmployeeEmail,
    alternativeEmailAddress: testData.roleEmployeeEmail,
    nationality: 'India',
    disability: false,
  },
  residentialObj: {
    residentialCountry: 'India',
    residentialZipCode: testData.pinCode,
    residentialState: 'Tamil Nadu',
    residentialCity: 'Chennai',
    residentialArea: 'Chennai',
    residentialAddressLine1: 'QA bench street',
    residentialAddressLine2: 'QA bench area',
  },
  mailingObj: {
    mailingCountry: 'India',
    mailingZipCode: testData.pinCode,
    mailingState: 'Tamil Nadu',
    mailingCity: 'Chennai',
    mailingArea: 'Chennai',
    mailingAddressLine1: 'QA bench street',
    mailingAddressLine2: 'QA bench area',
  },
  employmentObj: {
    hrJson: '[]',
    reportingHrJson: '[]',
    employmentStatus: 'Self-employed',
    dateOfJoining: '2026-10-26',
  },
  educationObj: [
    {
      qualification: "Master's Degree (Postgraduate)",
      instituteName: 'QA Institute',
      percentage: '75',
      yearOfGraduation: '2012-05-31',
    },
  ],
  workExpObj: { isExperienced: 'No' },
  additionalObj: {
    nationality: 'India',
    citizenship: 'India',
    panCard: 'ABCPE1234F',
    aadharcard: '234123412346',
  },
});
