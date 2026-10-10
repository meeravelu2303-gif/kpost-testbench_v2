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
 * Points an endpoint's requests at a throwaway account instead of the shared counterparty.
 *
 * The generic sweep sends an endpoint's valid ("primary") request for real, then derives every probe
 * from it. For writes that act on another person (add / block / delete a contact, call, schedule,
 * add to a group) the shared `victimKpostId` would be blocked, deleted or called for real, and every
 * lifecycle flow that uses it as the counterparty would then start failing for a reason that has
 * nothing to do with the product. The throwaway account is used by no flow as a counterparty, so
 * acting on it contaminates nothing.
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
 * Marks a write as one whose valid request needs data the sweep cannot supply (an existing group,
 * call, event, contact or image) or depends on state an earlier run left behind. The sweep's primary
 * request then legitimately gets a client rejection: "groupID not found", "Kall not found",
 * "ContactID is already in your contact list". See `EndpointDefinition.precondition`.
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
