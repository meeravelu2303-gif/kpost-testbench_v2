import type { EndpointExecutor } from '@engine/endpoint-executor';
import type { Page } from '@playwright/test';
import type { RequestSpec } from '@api/client/request-builder';

/**
 * Outcome evidence for a UI flow, taken from the server without disturbing the browser
 * (master plan §18).
 *
 * ## The problem this solves
 *
 * A UI write flow must not accept a click, a closed dialog or a changed URL as proof — all three are
 * produced by the same client that would be wrong if the feature were broken. The answer is to ask
 * the server. But the obvious way to do that breaks the test:
 *
 *     KPOST allows ONE active session per account, so an API login DISPLACES the browser's session.
 *
 * Measured on live during Phase 8. The page does not error and does not redirect to /login — it
 * renders its list as an empty skeleton forever, because its own reads are now unauthorised. That
 * reads exactly like a product defect and cost two debugging rounds. It is also why most UI write
 * flows in this bench still prove themselves through the UI: the safe alternative was not available.
 *
 * ## The way out: borrow the browser's OWN token
 *
 * `EndpointExecutor` already accepts `auth: { header }`, so a verification call can carry the token
 * the browser is already using instead of minting a second one. No login happens, so there is no
 * second session and nothing to displace — the API call is, from the server's point of view, the
 * same client asking a question.
 *
 * That makes the strongest kind of evidence available to any UI spec, for any account, in any order,
 * which the cross-channel workaround (never browse as the account the API authenticates as) cannot
 * do.
 *
 * ## What this does NOT change
 *
 * The call still goes through `EndpointExecutor.send`, so the production guard, the SMS/OTP
 * kill-switch, the QA-identifier guard and evidence capture all apply exactly as they do anywhere
 * else. Borrowing a token changes who the request is authenticated as, never what it is allowed
 * to do.
 */

/** The key the KPost app stores its bearer token under. Taken from the app's own `Callback.js`. */
const TOKEN_KEY = 'accessToken';

/**
 * The bearer token the browser is currently using, or `undefined` when it holds none.
 *
 * `undefined` rather than throwing: a signed-out page is a real state, and a caller that turns it
 * into an INDETERMINATE observation is more useful than one that fails with a storage error.
 */
export async function browserToken(page: Page): Promise<string | undefined> {
  const raw = await page.evaluate((key) => {
    try {
      return window.localStorage.getItem(key);
    } catch {
      // Private mode, blocked site data, or a page that is not on the app origin.
      return null;
    }
  }, TOKEN_KEY);
  const token = raw?.trim();
  return token ? token : undefined;
}

/**
 * Ask the server what actually happened, as the account the BROWSER is signed in as.
 *
 * Returns `undefined` when the page holds no token, so a caller can report "could not observe"
 * rather than "did not happen" — the same distinction the side-effect and confirmation layers keep,
 * and for the same reason: unmeasured is not unchanged.
 */
export async function observeAsBrowser(
  endpoints: EndpointExecutor,
  page: Page,
  endpointId: string,
  spec: RequestSpec,
  label: string,
): Promise<{ status: number; rows: Record<string, unknown>[] } | undefined> {
  const token = await browserToken(page);
  if (!token) return undefined;

  const exchange = await endpoints.sendTo(endpointId, spec, {
    label,
    // The browser's own token. No login, so no session is displaced.
    auth: { header: `Bearer ${token}` },
  });
  const parsed = exchange.json();
  const data = parsed.ok ? (parsed.value as { data?: unknown }).data : undefined;
  return {
    status: exchange.status,
    rows: Array.isArray(data) ? (data as Record<string, unknown>[]) : [],
  };
}

/**
 * Perform an application action as the account the BROWSER is signed in as.
 *
 * The write counterpart of `observeAsBrowser`, and it exists for one job: establishing a
 * PRECONDITION a UI flow cannot reach on its own.
 *
 * The concrete case is the Katchup composer. It is reached through a conversation row keyed
 * `[id=<kpostId>]`, and that row exists only once there is traffic between the two accounts — so on
 * accounts that are not saved contacts of each other, the composer is unreachable cold and every
 * write test in the file fails at its first step. Seeding one message makes the row appear.
 *
 * Seeding it through the browser's own token rather than a fresh login is what makes this usable at
 * all: a second login would displace the very session the test is about to drive.
 *
 * `allowLiveWrite` is passed because a seed is a real message. It is the same per-call authorisation
 * every gated flow uses, and the production guard, the kill-switch and the QA-identifier guard apply
 * to it unchanged — so the seed can only ever name accounts the bench owns.
 */
export async function actAsBrowser(
  endpoints: EndpointExecutor,
  page: Page,
  endpointId: string,
  spec: RequestSpec,
  label: string,
): Promise<{ status: number; rows: Record<string, unknown>[] } | undefined> {
  const token = await browserToken(page);
  if (!token) return undefined;

  const exchange = await endpoints.sendTo(endpointId, spec, {
    label,
    auth: { header: `Bearer ${token}` },
    allowLiveWrite: true,
  });
  const parsed = exchange.json();
  const data = parsed.ok ? (parsed.value as { data?: unknown }).data : undefined;
  return {
    status: exchange.status,
    rows: Array.isArray(data) ? (data as Record<string, unknown>[]) : [],
  };
}
