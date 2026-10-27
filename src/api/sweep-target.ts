import { testData } from '@config/test-data.config';
import { requireAccount } from '@fixtures/test-accounts';
import type { EndpointDefinition } from './registry/endpoint-definition';

/**
 * The throwaway account the sweep acts on: `qatest5` when it is provisioned, otherwise personal
 * account 6 (declared as a login identity, used by no flow as a counterparty).
 */
function sacrificialKpostId(): string {
  const qatest5 = requireAccount('qatest5');
  return qatest5.ok ? qatest5.account.kpostId : testData.personal6KpostId;
}

/**
 * Points an endpoint's requests at the throwaway account, so sweep writes never block or delete the
 * shared counterparty.
 */
export function withSacrificialTarget(definition: EndpointDefinition): EndpointDefinition {
  const factory = definition.request;
  if (!factory) return definition;
  const from = testData.victimKpostId;
  const to = sacrificialKpostId();
  return {
    ...definition,
    request: async (helpers) => retarget(await factory(helpers), from, to),
  };
}

/**
 * Writes whose valid request is meant to SUCCEED on its own, so a client rejection is a real finding:
 * the group name is made unique per call and the caller owns everything it creates.
 */
const EXPECTS_SUCCESS: ReadonlySet<string> = new Set(['group-create']);

/**
 * Marks a write whose valid request needs data the sweep cannot supply, so a client rejection is
 * accepted.
 */
export function withPlaceholderPrimary(definition: EndpointDefinition): EndpointDefinition {
  if (definition.precondition || definition.expectedStatus || EXPECTS_SUCCESS.has(definition.id)) {
    return definition;
  }
  return {
    ...definition,
    precondition:
      'the sweep has no real record to act on, so a client rejection of the placeholder is the correct answer',
  };
}

/** What every write sweep wrapper applies: act on the throwaway account, accept a client rejection. */
export function forWriteSweep(definition: EndpointDefinition): EndpointDefinition {
  return withSacrificialTarget(withPlaceholderPrimary(definition));
}

/** Replaces `from` with `to` inside every string of plain objects/arrays; leaves buffers and the like alone. */
export function retarget<T>(value: T, from: string, to: string): T {
  if (typeof value === 'string') return value.split(from).join(to) as T;
  if (Array.isArray(value)) {
    return (value as unknown[]).map((item) => retarget(item, from, to)) as T;
  }
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        retarget(item, from, to),
      ]),
    ) as T;
  }
  return value;
}
