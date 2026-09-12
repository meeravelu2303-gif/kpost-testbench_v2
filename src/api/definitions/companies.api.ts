import { buildCompanyPayload } from '@data/factories';
import type { EndpointDefinition } from '../registry/endpoint-definition';
import { companySchema, createCompanyRequestSchema } from '../schemas/company.schema';

/**
 * Added after the Users API: this definition plus its business rule is ALL that was needed.
 * No validator, engine or spec-file changes.
 */
export const createCompanyApi: EndpointDefinition = {
  id: 'create-company',
  mockFixture: true,
  method: 'POST',
  path: '/companies',
  summary: 'Create a company',
  tags: ['companies', 'critical'],
  authorization: { roles: ['SUPER_ADMIN', 'ADMIN'] },
  request: () => ({ body: buildCompanyPayload() }),
  requestSchema: createCompanyRequestSchema,
  responseSchema: companySchema,
  businessRules: ['duplicate-company-name'],
  database: { validations: ['company-created'] },
};

export const companyApis = [createCompanyApi];
