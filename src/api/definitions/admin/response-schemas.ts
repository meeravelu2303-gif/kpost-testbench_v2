import { z } from 'zod';

/**
 * Admin API response schemas, typed from the backend's Java classes. Types only: record fields are
 * optional and nullable, except the envelope and a record's `id`. Unknown keys are allowed.
 */
const s = z.string().nullable().optional();
const n = z.number().nullable().optional();
const b = z.boolean().nullable().optional();
const strings = z.array(z.string()).nullable().optional();

/** ApiResponseEnvelope: { value?, urlPath, status, statusCode, error? }. */
const envelope = <T extends z.ZodType>(value: T) =>
  z.object({
    value,
    urlPath: z.string(),
    status: z.enum(['SUCCESS', 'FAILURE']),
    statusCode: z.number(),
    error: s,
  });
const noValue = z.object({
  urlPath: z.string(),
  status: z.enum(['SUCCESS', 'FAILURE']),
  statusCode: z.number(),
});

// ---- entities (Admin_Module/src/main/java/com/kpost/admin/entity) -----------------------------------
const tier = z.object({ id: z.string(), companyId: s, attributeName: s, abbreviation: s, code: s });
const variable = z.object({
  id: z.string(),
  attributeId: s,
  companyId: s,
  variableName: s,
  parentVariableId: s,
  parentAttributeId: s,
  reportingJson: s,
  reportingAttributeId: s,
  reportingVariableId: s,
  abbreviation: s,
  code: s,
});
const location = z.object({
  id: z.string(),
  attributeId: s,
  variableId: s,
  workPlaceLocation: s,
  reportingWorkplaceLocation: s,
  reportingWorkplaceLocationId: s,
  locationName: s,
  pincode: s,
  state: s,
  city: s,
  area: s,
  addressLine1: s,
  addressLine2: s,
  abbreviation: s,
  code: s,
  companyId: s,
  countryId: n,
  countryName: s,
});
const hierarchy = z.object({
  id: z.string(),
  attributeId: s,
  variableId: s,
  parentAttributeId: s,
  parentVariableId: s,
  reportingAttributeId: s,
  reportingVariableId: s,
  reportingParentAttributeId: s,
  reportingParentVariableId: s,
  workplaceJson: s,
  reportingJson: s,
  abbreviation: s,
  code: s,
});
const employee = z.object({
  id: z.string(),
  companyId: s,
  personalInformationObj: z
    .object({
      firstName: s,
      lastName: s,
      dob: s,
      gender: s,
      maritalStatus: s,
      landline: s,
      mobile: s,
      alternativeMobileNo: s,
      emailAddress: s,
      alternativeEmailAddress: s,
      nationality: s,
      disability: b,
      typeOfDisability: s,
      attachment: strings,
    })
    .nullable()
    .optional(),
  residentialObj: z
    .object({
      residentialCountry: s,
      residentialZipCode: s,
      residentialState: s,
      residentialCity: s,
      residentialArea: s,
      residentialAddressLine1: s,
      residentialAddressLine2: s,
    })
    .nullable()
    .optional(),
  mailingObj: z
    .object({
      mailingCountry: s,
      mailingZipCode: s,
      mailingState: s,
      mailingCity: s,
      mailingArea: s,
      mailingAddressLine1: s,
      mailingAddressLine2: s,
    })
    .nullable()
    .optional(),
  employmentObj: z
    .object({
      employeeId: s,
      hrJson: s,
      reportingHrJson: s,
      designatedReportingPerson: s,
      employmentStatus: s,
      dateOfJoining: s,
    })
    .nullable()
    .optional(),
  educationObj: z
    .array(
      z.object({
        qualification: s,
        instituteName: s,
        percentage: s,
        yearOfGraduation: s,
        attachment: strings,
      }),
    )
    .nullable()
    .optional(),
  workExpObj: z
    .object({
      isExperienced: s,
      totalExp: s,
      experienceDetails: z
        .array(z.object({ company: s, jobTitle: s, fromDate: s, toDate: s, employmentStatus: s }))
        .nullable()
        .optional(),
    })
    .nullable()
    .optional(),
  additionalObj: z
    .object({ nationality: s, citizenship: s, panCard: s, aadharcard: s, locationName: s })
    .nullable()
    .optional(),
  promotionDetails: s,
  transferDetails: s,
});
const rolePosting = z.object({
  id: z.string(),
  lastWorkplaceTierId: s,
  lastWorkplaceVariableId: s,
  companyId: s,
  employeeId: s,
  workplaceJson: s,
  workplaceLocationId: s,
  lastHrTierId: s,
  lastHrVariableId: s,
  hrJson: s,
  reportingWorkplaceJson: s,
  reportingHrJson: s,
  countryCode: n,
  countryId: n,
  kpostID: s,
  displayName: s,
  activeStatus: b,
  reason: s,
  remarks: s,
  duration: s,
  // java.util.Date: Jackson writes an epoch number or an ISO string depending on configuration.
  rejoiningDate: z.union([z.number(), z.string()]).nullable().optional(),
  ksmaccID: s,
  ksmaccCompanyID: n,
  ksmaccDisplayName: s,
  locationName: s,
  workplaceLocationJson: s,
  companyName: s,
  userType: s,
  employeeDetails: employee.nullable().optional(),
  promotionDetails: s,
  transferDetails: s,
});
// responseObject/SuspendOrTerminateResponseObject.java
const suspendRow = z.object({
  id: s,
  companyId: s,
  employeeId: s,
  hrJson: s,
  kpostID: s,
  ksmaccID: s,
  activeStatus: b,
  reason: s,
  remarks: s,
  duration: s,
  rejoiningDate: s,
  locationName: s,
  firstName: s,
  lastName: s,
  dob: s,
  gender: s,
  mobile: s,
  emailAddress: s,
  panCard: s,
});

/** Response schema per Admin endpoint id (controller return types, Admin_Module controller/*). */
export const ADMIN_RESPONSE_SCHEMAS: Record<string, z.ZodType> = {
  // Work Place / HR tiers: save → List, update → one, delete → "SUCCESS", list → List.
  'admin-workplace-tier-attribute-by-company': envelope(z.array(tier)),
  'admin-workplace-tier-attribute-save': envelope(z.array(tier)),
  'admin-workplace-tier-attribute-update': envelope(tier),
  'admin-workplace-tier-attribute-delete': envelope(z.string()),
  'admin-hr-tier-attribute-by-company': envelope(z.array(tier)),
  'admin-hr-tier-attribute-save': envelope(z.array(tier)),
  'admin-hr-tier-attribute-update': envelope(tier),
  'admin-hr-tier-attribute-delete': envelope(z.string()),
  // Variables: save → List, update → one, delete → no value, lists/hierarchies → List.
  'admin-workplace-tier-variable-list': envelope(z.array(variable)),
  'admin-workplace-tier-variable-save': envelope(z.array(variable)),
  'admin-workplace-tier-variable-update': envelope(variable),
  'admin-workplace-tier-variable-delete': noValue,
  'admin-workplace-tier-variable-reporting-hierarchy': envelope(z.array(variable)),
  'admin-hr-tier-variable-list': envelope(z.array(variable)),
  'admin-hr-tier-variable-save': envelope(z.array(variable)),
  'admin-hr-tier-variable-update': envelope(variable),
  'admin-hr-tier-variable-delete': noValue,
  // One record, unlike its workplace twin's list.
  'admin-hr-tier-variable-reporting-hierarchy': envelope(variable),
  // Locations: save/getLocation/getAllLocation → List, update/getLocationById → one, delete → no value.
  'admin-workplace-location-all': envelope(z.array(location)),
  'admin-workplace-location-get': envelope(z.array(location)),
  'admin-workplace-location-by-id': envelope(location),
  'admin-workplace-location-save': envelope(z.array(location)),
  'admin-workplace-location-update': envelope(location),
  'admin-workplace-location-delete': noValue,
  'admin-workplace-hierarchy': envelope(z.array(hierarchy)),
  // Employees: save/update → one, delete → message, list → List.
  'admin-employee-details': envelope(z.array(employee)),
  'admin-employee-save': envelope(employee),
  'admin-employee-update': envelope(employee),
  'admin-employee-delete': envelope(z.string()),
  // Country lookup: Map<String, Object>.
  'admin-country-address-by-pincode': envelope(z.record(z.string(), z.unknown())),
  // Role postings.
  'admin-role-posting-by-company': envelope(z.array(rolePosting)),
  'admin-role-posting-by-company-and-employee': envelope(z.array(rolePosting)),
  'admin-role-posting-employees': envelope(z.array(suspendRow)),
  'admin-role-posting-suspended-list': envelope(z.array(suspendRow)),
  'admin-role-posting-save': envelope(
    z.array(
      z.object({ savedEntities: z.array(rolePosting).nullable().optional(), statusMessage: s }),
    ),
  ),
  'admin-role-posting-update': envelope(rolePosting),
  'admin-role-posting-delete': envelope(z.string()),
  'admin-role-posting-suspend-terminate': envelope(z.string()),
};
