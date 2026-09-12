import { env } from '@config/env';
import { suiteFor } from '@config/ownership.config';
import type { EndpointDefinition } from '../registry/endpoint-definition';
import { loadModuleEndpoints } from './module-endpoints';

/**
 * KMail module — a separate repository and a separate service, maintained by Jitendra Kumar.
 * Its defects file into the `KMail API` Bugzilla product and are assigned to him automatically.
 *
 * Endpoints load from openapi/kmail-api.openapi.json, and only when KMAIL_API_BASE_URL is
 * configured: without a host to call, registering them would produce failures about the bench
 * rather than about KMail.
 */
export const kmailApis: EndpointDefinition[] = env.KMAIL_API_BASE_URL
  ? loadModuleEndpoints(suiteFor('kmail-api'))
  : [];
