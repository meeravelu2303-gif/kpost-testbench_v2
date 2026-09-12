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
  ? loadModuleEndpoints(suiteFor('kmail-api'), {
      // KMail's payload sits under `value`, with no `statusCode` - a different envelope from
      // KPost core, measured across its 26 documented responses.
      responseContract: 'kmail',
      /*
       * KMail enforces authentication: `GET /common/getSaluations/` answers 403 with an empty body
       * on the live host. Nothing in the workbook says so - the bench found it. Tagged so the spec
       * can leave these out until the Signup & Login module can issue a token, rather than
       * reporting 15 endpoints as broken when the only thing missing is a credential.
       */
      authentication: { required: true },
      tags: ['needs-login'],
    })
  : [];
