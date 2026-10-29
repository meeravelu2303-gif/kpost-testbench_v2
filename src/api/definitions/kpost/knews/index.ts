import type { EndpointDefinition } from '../../../registry/endpoint-definition';
import { knewsApis as all } from './knews.api';

/** KNews (`/v2/knews/*`, `/v1/news*`, `/admin/news/*`). */
export const knewsApis: EndpointDefinition[] = [...all];
