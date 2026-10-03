import { AUTH_PROFILES } from '@config/auth-profile';
import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';

/**
 * Katchup **needs-id reads** — closed, not a recorded gap anymore.
 *
 * Most of this file's original 12 gaps were closed 2026-09-25 once `katchup-send-message`'s
 * `groupFlag` bug was fixed (see `send-regression.spec.ts`) — that single fix unblocked sending a
 * real message at all, which turned out to be everything the shared/reference reads needed (see
 * `shared-reference-workflow.spec.ts`). The six attachment download/streaming reads were closed
 * 2026-09-26 via `presigned-attachment-workflow.spec.ts` (two real defects found and filed: #617,
 * #618).
 *
 * The last one, `katchup-messages-subject`, closed 2026-10-03: the recorded 404 was never an
 * undeployed route — this bench's own definition sent no id at all, while the live client
 * (`Katchup.js:1703` `GetSubjectSuggestion(id)`) always appends one as a path param. Fixed in
 * `read.api.ts` (added the path param + a `contractPath` for the workbook's bare-path form);
 * confirmed live, 200, real data.
 */
const A = AUTH_PROFILES.kpost.principals.find((p) => p.key === 'personal')!;

test.describe('KPost Katchup · needs-id reads', () => {
  test('katchup-messages-subject returns the subject lines used with a real contact @api', async ({
    endpoints,
  }) => {
    const ex = await endpoints.sendTo(
      'katchup-messages-subject',
      { pathParams: { id: testData.victimKpostId } },
      { label: 'needs-id:messages-subject', auth: { principal: A }, allowLiveRead: true },
    );
    expect(ex.status, 'getKatchupMessagesSubject succeeds with a real contact id').toBe(200);
    const body = JSON.parse(ex.bodyText || '{}') as { data?: unknown };
    expect(Array.isArray(body.data), 'the response carries a list of subject strings').toBe(true);

    /*
     * Found 2026-10-03: this account's real subject history already contains dozens of raw
     * XSS/SQLi fuzzer payloads from past negative-input runs (`<script>alert(1)</script>`,
     * `' OR '1'='1' --`, `1; DROP TABLE users; --`, `admin'--`, …), stored verbatim and never
     * cleaned up. That the backend accepts and persists them without rejecting is a separate,
     * pre-existing finding from whatever test originally sent them — not re-asserted here, since
     * this test only confirms the READ itself works. Worth a dedicated cleanup pass and a decision
     * on whether storing (vs rendering) such a string unescaped is itself the product's concern.
     */
  });
});
