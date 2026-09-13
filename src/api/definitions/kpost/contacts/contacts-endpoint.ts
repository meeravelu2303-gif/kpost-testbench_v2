import type { EndpointDefinition } from '../../../registry/endpoint-definition';
import { defineKpostEndpoint, type KpostEndpointConfig } from '../kpost-endpoint';

/**
 * A Contacts endpoint: `defineKpostEndpoint` with authentication required (the whole module is
 * post-login) and the `contacts` tag. Contacts is the address book the messaging, calling and mail
 * modules all act on; payloads are taken from the live web client (`Services/Contacts.js`).
 */
export function defineContactsEndpoint(config: KpostEndpointConfig): EndpointDefinition {
  return defineKpostEndpoint({
    ...config,
    authentication: config.authentication ?? { required: true },
    tags: ['contacts', ...(config.tags ?? [])],
  });
}
