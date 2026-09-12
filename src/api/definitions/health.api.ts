import type { EndpointDefinition } from '../registry/endpoint-definition';
import { healthSchema } from '../schemas/auth.schema';

/** Per-endpoint override example: only authentication and authorization are switched off. */
export const healthCheckApi: EndpointDefinition = {
  id: 'health-check',
  method: 'GET',
  path: '/health',
  tags: ['platform', 'critical'],
  responseSchema: healthSchema,
  validations: { authentication: false, authorization: false },
};
