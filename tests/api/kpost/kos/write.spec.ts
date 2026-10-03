import { describeEndpointCases } from '@engine/endpoint-cases';
import { test } from '@fixtures';

/**
 * WHAT is tested: the KOS (KWord) writes — create/save/update/delete, sharing, AI generation, and the
 * two undocumented-but-real `/kword/changeDocumentAccess` and `/kword/updateJobId` endpoints. HOW is
 * owned by the central validation engine (auth/negative-input/security/performance per endpoint).
 *
 * Every write here is `destructive`, none `productionSafe` — the engine's own production guard skips
 * the live-executing cases exactly as it already does for KOS's needs-doc-id reads, so wiring this in
 * costs nothing in risk and gives every write its missing-token/auth checks it previously had none of.
 */
test.describe('KPost KOS · write', () => {
  describeEndpointCases({ tags: ['kos-write'] });
});
