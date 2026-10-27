import { testData } from '@config/test-data.config';

/**
 * The Admin screens' own complete save payloads, shared by every Admin spec so a server rule change
 * is one edit. Every value is a QA value (the employee uses QA_ROLE_EMPLOYEE_MOBILE/EMAIL).
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

/** A workplace location: level, name, country, pincode with state/city/area, both address lines. */
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
 * An employee, all six Employee Data steps. `lastName` identifies the test's record (the leftovers
 * tool matches stamped QA names). Saves take the object itself, not an array.
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
