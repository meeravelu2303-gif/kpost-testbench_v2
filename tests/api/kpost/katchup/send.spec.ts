import { describeEndpointCases } from '@engine/endpoint-cases';
import { test } from '@fixtures';

/**
 * WHAT is tested: the Katchup send endpoints — the create-a-message routes.
 * HOW is owned by the central validation engine.
 *
 * Every send is a write that reaches a real inbox, so on the live application these are blocked
 * (no send is `productionSafe` yet — owner sign-off pending, `docs/katchup-flow.md` §6). Off-live,
 * against the mock, they run in full — including the injection, null-value and type probes that a
 * write endpoint most needs and that must never be aimed at a live conversation.
 */
test.describe('KPost Katchup · sends', () => {
  describeEndpointCases({ tags: ['katchup-send'] });
});
