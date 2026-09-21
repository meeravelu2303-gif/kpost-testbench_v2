import { describeEndpointCases } from '@engine/endpoint-cases';
import { test } from '@fixtures';

/**
 * **Signup — the availability reads.** The engine owns HOW each is validated; this says WHICH.
 *
 * ## Why this file did not exist
 *
 * `signup.api.ts` was deleted when signup went out of scope, and restored on 2026-09-19 when the
 * owner confirmed testingapi's OTP subsystem is a test gateway. The definitions came back; no
 * contract spec did. `login.spec.ts` filters `tags: ['login']`, so the five `signup`-tagged
 * endpoints have had **no generated validator case at all** since — three of them cleared for live
 * (`productionSafe: true`) and simply never asked anything.
 *
 * ## Why registration is excluded rather than included
 *
 * `excludeTags: ['mints-account']` drops `signup` and `adminRegistration`. Both are `destructive`,
 * `sideEffect: 'global'` and `otpDependent: 'requires'`, and **an account cannot be deleted through
 * this API** — a fuzzed registration leaves a permanent row, and `adminRegistration` a permanent
 * company. The production guard and the `@destructive` filter already stop them on a default run,
 * but `kpost:deep` arms both, and turning a write nobody can undo into a fuzz target is not a
 * decision a coverage spec should make quietly. They are driven deliberately, once, end to end by
 * `otp-signup-lifecycle.spec.ts` on the gateway — the controlled-flow half of the architecture.
 *
 * That leaves the three availability READS, which create nothing and are already cleared for live:
 * the signup GET, `kpostIdExist` (asked with the configured ABSENT id, so the answer is
 * "available"), and `kpostIDsuggestionList`. This is the same shape as `otp.spec.ts`, which
 * excludes `otp-consume` for the same kind of reason.
 */
test.describe('KPost Signup · availability reads', { tag: '@kpost-api' }, () => {
  describeEndpointCases({ tags: ['signup'], excludeTags: ['mints-account'] });
});
