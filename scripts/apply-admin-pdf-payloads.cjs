#!/usr/bin/env node
/**
 * Rewrites the request bodies in `openapi/admin-api.openapi.json` to match the OWNER's authoritative
 * payload doc — `Admin_module - API Services.pdf` (2026-09-19). The live springdoc api-docs types every
 * admin request with a broad shared DTO (e.g. `getEmployeeByCompanyId` lists 13 fields); the reads only
 * use `{ companyId }`, so fuzzing the full DTO filed false "input validation" bugs. This makes the
 * contract reflect the real per-endpoint payload.
 *
 * Deterministic + idempotent: re-running produces the same file. Only the 38 endpoints the bench uses are
 * touched; the other ~74 springdoc paths are left as-is. Run: `node scripts/apply-admin-pdf-payloads.cjs`.
 *
 * Structural facts kept from live reality (measured, see CLAUDE.md): the tier/variable/location SAVES take
 * an ARRAY of the object; everything else is a single object. Fields carry no `required` (an example does
 * not prove a field mandatory — repo convention). Two documented-vs-live notes are preserved as-is on the
 * definitions, not here: `getWorkPlaceHierarchy` needs a runtime `parentAttributeId` the PDF omits, and
 * `getSuspendOrTerminateEmployee`'s real `requestType` enum is unconfirmed.
 */
const fs = require('fs');
const path = require('path');

const S = 'string';
const I = 'integer';

// path -> { array?: true, fields: { name: type } }  (empty fields = no request body)
const PDF = {
  // ---- reads (object) ----
  '/adminTierAttribute/getAttributeByCompanyId': { fields: { companyId: S } },
  '/adminTierVariable/getAdminTierVariable': { fields: { companyId: S, parentVariableId: I } },
  '/adminTierVariable/getAllReportingVariableHierarchy': { fields: { id: S } },
  '/location/getAllLocation': { fields: { companyId: S } },
  '/location/getLocation': { fields: { companyId: S, attributeId: S, variableId: S } },
  '/location/getLocationById': { fields: { id: S } },
  '/workplaceHierarchy/getWorkPlaceHierarchy': { fields: { companyId: S } },
  '/hrSetUpTierAttribute/getAttributeByCompanyId': { fields: { companyId: S } },
  '/hrSetUpTierVariable/getHrSetUpTierVariable': { fields: { companyId: S, parentVariableId: I } },
  '/hrSetUpTierVariable/getAllReportingHrTierVariableHierarchy': { fields: { id: S } },
  '/rolePosting/getRolePostingByCompanyId': { fields: { companyId: S } },
  '/rolePosting/getEmployeeByCompanyId': { fields: { companyId: S } },
  '/rolePosting/getSuspendOrTerminateEmployee': { fields: { companyId: S, requestType: S } },
  '/rolePosting/getRolePostingByCompanyIdAndEmployeeId': {
    fields: { companyId: S, employeeId: S },
  },
  '/employeeDetails/getEmployeeDetails': { fields: { companyId: S } },

  // ---- saves: tier/variable/location are ARRAYS of the object; employee/rolePosting are objects ----
  '/adminTierAttribute/save': {
    array: true,
    fields: { companyId: S, attributeName: S, createdBy: I },
  },
  '/adminTierVariable/save': {
    array: true,
    fields: { companyId: S, attributeId: S, variableName: S, parentVariableId: I },
  },
  '/hrSetUpTierAttribute/save': {
    array: true,
    fields: { companyId: S, attributeName: S, createdBy: I },
  },
  '/hrSetUpTierVariable/save': {
    array: true,
    fields: { companyId: S, attributeId: S, variableName: S, parentVariableId: I },
  },
  '/location/save': {
    array: true,
    fields: { companyId: S, locationName: S, addressLine1: S, pincode: S, country: S },
  },
  '/employeeDetails/save': {
    fields: { companyId: S, employeeName: S, mobileNo: S, emailId: S },
  },
  '/rolePosting/save': {
    fields: { companyId: S, employeeId: S, hrVariableId: S, locationId: S },
  },

  // ---- updates (object) ----
  '/adminTierAttribute/update': { fields: { id: S, companyId: S, attributeName: S } },
  '/adminTierVariable/update': {
    fields: { id: S, companyId: S, attributeId: S, variableName: S },
  },
  '/hrSetUpTierAttribute/update': { fields: { id: S, companyId: S, attributeName: S } },
  '/hrSetUpTierVariable/update': {
    fields: { id: S, companyId: S, attributeId: S, variableName: S },
  },
  '/location/update': { fields: { id: S, companyId: S, locationName: S } },
  '/employeeDetails/update': { fields: { id: S, companyId: S, employeeName: S } },
  '/rolePosting/update': { fields: { id: S, employeeId: S, rolePostingId: S } },

  // ---- deletes (object) ----
  '/adminTierAttribute/delete': { fields: { id: S } },
  '/adminTierVariable/delete': { fields: { id: S } },
  '/hrSetUpTierAttribute/delete': { fields: { id: S } },
  '/hrSetUpTierVariable/delete': { fields: { id: S } },
  '/location/delete': { fields: { id: S } },
  '/employeeDetails/delete': { fields: { id: S } },
  '/rolePosting/delete': { fields: { id: S } },

  // ---- suspend/terminate (object) ----
  '/rolePosting/suspendOrTerminateEmployee': {
    fields: { employeeId: S, companyId: S, requestType: S, reason: S },
  },

  // ---- GET reference read: no request body (path params only) ----
  '/country/getAddressUsingPincodeAndCountry/{pincode}/{country}': { fields: {} },
};

function objectSchema(fields) {
  const properties = {};
  for (const [name, type] of Object.entries(fields)) properties[name] = { type };
  return { type: 'object', properties };
}

function schemaFor(spec) {
  if (Object.keys(spec.fields).length === 0) return null; // no body (GET reference)
  const obj = objectSchema(spec.fields);
  return spec.array ? { type: 'array', items: obj } : obj;
}

function main() {
  const file = path.join(__dirname, '..', 'openapi', 'admin-api.openapi.json');
  const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
  const missing = [];
  let patched = 0;

  for (const [p, spec] of Object.entries(PDF)) {
    const item = doc.paths[p];
    if (!item) {
      missing.push(p);
      continue;
    }
    const op = item.post || item.get;
    if (!op) {
      missing.push(p + ' (no post/get)');
      continue;
    }
    const schema = schemaFor(spec);
    if (schema === null) {
      delete op.requestBody; // GET reference read — path params only
    } else {
      op.requestBody = {
        required: true,
        content: { 'application/json': { schema } },
      };
    }
    patched += 1;
  }

  if (missing.length) {
    console.error('Paths not found in the openapi (aborting):\n  ' + missing.join('\n  '));
    process.exit(1);
  }

  fs.writeFileSync(file, JSON.stringify(doc, null, 2) + '\n');
  console.log(`Patched ${patched} admin request bodies to the PDF payloads → ${file}`);
}

main();
