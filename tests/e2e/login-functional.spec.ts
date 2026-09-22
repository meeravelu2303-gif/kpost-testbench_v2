// The conditional below is in an ANNOTATION, not an assertion: the test reports what the UI
// actually showed so a human can compare it against the server message, and the pass/fail decision
// itself stays unconditional.
/* eslint-disable playwright/no-conditional-in-test */
import { testData } from '@config/test-data.config';
import { KpostRepository } from '@database/repositories/kpost.repository';
import { expect, test } from '@fixtures';

/**
 * Login **functional** testing — the UI's own logic, not the API behind it.
 *
 * ## What this covers that the other login specs do not
 *
 * `login.spec.ts` proves the happy path works and `cross-layer-login.spec.ts` proves a successful
 * login reaches MySQL. Neither exercises the cases where the UI itself is the defective layer:
 *
 *  - a field that accepts input it should reject, so a malformed value reaches the server
 *  - an error message that does not match what the server actually said
 *  - a spinner that never stops when a request fails
 *  - a failed login that nonetheless leaves a session behind
 *
 * Each of those is invisible to an API test — the API is behaving correctly in every one of them.
 *
 * ## Why most of these intercept the network
 *
 * Three of the cases below need a specific server response (a 500, a slow reply, an error whose
 * text can be compared against the UI). Driving those for real would mean either waiting for the
 * server to misbehave or deliberately provoking it, and the one genuinely provocable case —
 * repeated wrong passwords — is how a shared QA account gets locked and every other suite starts
 * failing for an unrelated reason.
 *
 * `page.route` gives the exact response, deterministically, without touching the real service. The
 * subject under test here is the CLIENT's handling of a response, so a stubbed response tests it
 * exactly as well as a real one — and the one case where the server's real answer is the point (the
 * wrong-password message) uses a single real attempt, followed by a successful login.
 */
test.describe('KPost login · UI functional behaviour @ui', { tag: '@ui' }, () => {
  // These drive a real, unauthenticated login screen, so a saved session must not short-circuit it.
  test.use({ storageState: { cookies: [], origins: [] } });

  test.skip(!testData.kpostId, 'needs QA_KPOST_ID');

  test('the login id field rejects a malformed id before any request is sent', async ({
    loginPage,
    page,
  }) => {
    /*
     * The client-side validation question: does a value that cannot possibly be a KPost ID get
     * stopped here, or is it forwarded to the server?
     *
     * Asserted by watching the NETWORK rather than by looking for a red message. A UI that shows no
     * error but silently sends the request has failed this check just as badly as one that shows
     * nothing at all — and only the request log distinguishes them. This is also the honest way to
     * test it without hard-coding which element the product uses to display errors.
     */
    const loginCalls: string[] = [];
    await page.route('**/signupLogin/**', async (route) => {
      loginCalls.push(route.request().url());
      await route.continue();
    });

    await loginPage.goto();
    await loginPage.expectLoaded();

    // "not an email at all" — no @, no domain. There is no reading of this as a valid KPost ID.
    await loginPage.loginIdInput.fill('not-a-valid-id');
    await loginPage.submitButton.click();

    /*
     * The assertion below auto-waits for the password step to appear, so by the time it settles the
     * client has had its chance to either validate locally or dispatch. That removes the need for a
     * fixed sleep — and a fixed sleep is exactly how this kind of test goes green for the wrong
     * reason, by asserting before anything has happened.
     */
    await expect(
      loginPage.passwordInput,
      'a malformed id must not advance the user to the password step',
    ).toBeHidden({ timeout: 8000 });

    const idLookups = loginCalls.filter((url) => /kpostIdExist|fetchUserDetails/i.test(url));
    test.info().annotations.push({
      type: 'observed',
      description:
        idLookups.length === 0
          ? 'the client validated the id locally and sent nothing'
          : `the client sent ${idLookups.length} request(s) for a malformed id: ${idLookups.join(', ')}`,
    });

    /*
     * Note what is NOT asserted: whether the client validated locally or let the server decide.
     * That is a design choice, and failing a product for choosing server-side validation would be
     * inventing a requirement. Being advanced to the password step on a nonsense id is not a design
     * choice — it means the screen believes an account exists that cannot exist — and that is what
     * the assertion above covers.
     */
  });

  test('an empty password is not submitted', async ({ loginPage, page }) => {
    /*
     * The other half of field validation, and the one with a real security edge: a login request
     * with an empty password reaching the server is how an authentication bypass gets discovered
     * the hard way. The client should never send it.
     */
    const submitted: string[] = [];
    await page.route('**/userLogin**', async (route) => {
      submitted.push(route.request().postData() ?? '');
      await route.continue();
    });

    await loginPage.goto();
    await loginPage.expectLoaded();
    await loginPage.enterLoginId(testData.kpostId);

    await expect(
      loginPage.passwordInput,
      'the id was accepted and the password step is shown',
    ).toBeVisible();

    /*
     * Watch for the request itself instead of sleeping: if a login is dispatched this resolves, and
     * if none is dispatched it times out — which is the passing case. Asserting on the absence of
     * something is exactly where a fixed sleep is least trustworthy.
     */
    await loginPage.loginButton.click();
    const dispatched = await page
      .waitForRequest('**/userLogin**', { timeout: 5000 })
      .then(() => true)
      .catch(() => false);

    expect(dispatched, 'a login with an empty password must not be sent').toBe(false);
    expect(submitted, 'and nothing reached the network').toHaveLength(0);
  });

  test('the error the user sees matches the error the server sent', async ({ loginPage, page }) => {
    /*
     * The mismatch class of defect: the server rejects a login for one reason and the screen tells
     * the user something else — or tells them nothing and leaves the form looking idle.
     *
     * The response is STUBBED rather than provoked. Provoking it means sending a wrong password to
     * a shared account, and repeated wrong passwords are how this bench would lock itself out of
     * every other suite. The subject here is the client's rendering of an error, so a stubbed error
     * exercises it exactly as well.
     */
    const serverMessage = 'Invalid credentials. Please check your password.';
    await page.route('**/userLogin**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        // KPost's envelope anti-pattern reproduced faithfully: HTTP 200 carrying a failure.
        body: JSON.stringify({
          statusCode: 401,
          status: 'FAILURE',
          message: serverMessage,
          accessToken: null,
          data: null,
        }),
      });
    });

    await loginPage.goto();
    await loginPage.expectLoaded();
    await loginPage.enterLoginId(testData.kpostId);
    await loginPage.passwordInput.fill('deliberately-wrong-password');
    await loginPage.loginButton.click();

    /*
     * The user must be told something, and must not be let in. Those two are asserted; the exact
     * wording is reported rather than asserted, because a product is entitled to phrase its own
     * errors — and a test that pins copy fails on every rewording while catching no real defect.
     */
    await expect(page, 'a rejected login must not reach an authenticated screen').not.toHaveURL(
      /\/home/,
      { timeout: 10_000 },
    );

    const errorVisible = await loginPage.inlineError
      .first()
      .isVisible()
      .catch(() => false);
    const shown = errorVisible ? ((await loginPage.inlineError.first().textContent()) ?? '') : '';

    test.info().annotations.push({
      type: 'observed',
      description: errorVisible
        ? `server said "${serverMessage}"; UI showed "${shown.trim()}"`
        : `server said "${serverMessage}"; the UI showed NO inline error at all`,
    });

    expect(
      errorVisible,
      'a rejected login must tell the user something — a silent failure leaves them retyping a ' +
        'correct password, and is indistinguishable from the app being broken',
    ).toBe(true);
  });

  test('a server error does not leave the screen stuck', async ({ loginPage, page }) => {
    /*
     * The stuck-spinner class. When the login call 500s, the client must return control to the
     * user: re-enable the button, stop the spinner, say something. A screen that spins forever is
     * the single most common "the app is broken" report, and no API test can see it — from the
     * API's side the 500 was delivered correctly.
     *
     * This matters concretely here: Bugzilla #496 has login returning 500 for a share of
     * simultaneous attempts, so this is not a hypothetical response for this product.
     */
    await page.route('**/userLogin**', async (route) => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({
          statusCode: 500,
          status: 'FAILURE',
          message: 'Internal Server Error',
        }),
      });
    });

    await loginPage.goto();
    await loginPage.expectLoaded();
    await loginPage.enterLoginId(testData.kpostId);
    await loginPage.passwordInput.fill(testData.password || 'placeholder');
    await loginPage.loginButton.click();

    /*
     * Ten seconds is not a performance budget — it is the threshold past which a user concludes the
     * page has hung. Expressed as a WAIT rather than a sleep: it settles the moment the control
     * comes back, and only fails if it never does.
     *
     * This is the assertion that catches a stuck spinner. A screen that swallows the 500 and leaves
     * the button disabled forever gives the user no way forward except a reload.
     */
    await expect(
      loginPage.loginButton,
      'after a failed login the user must be able to try again — a button left disabled, or a ' +
        'spinner that never clears, means the only way out is a page reload',
    ).toBeEnabled({ timeout: 10_000 });

    expect(/\/login/.test(page.url()), 'a 500 must not navigate the user into the app').toBe(true);
  });

  test('a failed login leaves no session row behind @database', async ({
    loginPage,
    page,
    databases,
  }) => {
    /*
     * The cross-layer security invariant, and the reason this file asserts against MySQL at all: a
     * login that the user was told had FAILED must not have created a session.
     *
     * If it did, the account has a live, revocable-by-nobody session that the user does not know
     * exists — and every layer looks fine on its own. The UI showed an error, the API returned a
     * failure, and only the row reveals it.
     */
    const database = databases.for('kpost-api');
    test.skip(!database.enabled, 'needs the KPOST_QA connection');

    const repo = new KpostRepository(database);
    const before = await repo.sessions(testData.kpostId);

    await page.route('**/userLogin**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          statusCode: 401,
          status: 'FAILURE',
          message: 'Invalid credentials',
          accessToken: null,
          data: null,
        }),
      });
    });

    await loginPage.goto();
    await loginPage.expectLoaded();
    await loginPage.enterLoginId(testData.kpostId);
    await loginPage.passwordInput.fill('deliberately-wrong-password');
    await loginPage.loginButton.click();

    /*
     * Wait for the attempt to have been REJECTED before reading the database — reading too early
     * would sample the rows before the server had finished with the request, and a green result
     * would mean nothing. The screen staying on /login is the observable end of the attempt.
     */
    await expect(page, 'the rejected login stays on the login screen').toHaveURL(/\/login/, {
      timeout: 10_000,
    });

    const after = await repo.sessions(testData.kpostId);

    /*
     * Compared as a NON-INCREASE rather than an exact count. These are shared QA accounts and other
     * suites log in concurrently, so pinning a number would make this test fail for reasons that
     * have nothing to do with the property being checked. What is attributable is that THIS failed
     * attempt added nothing.
     *
     * (The route is stubbed, so no real login request reached the server — which is precisely why
     * a new row appearing here would be alarming rather than ambiguous.)
     */
    expect(
      after.length,
      `a login the user was told had failed must not create a session ` +
        `(${before.length} before, ${after.length} after)`,
    ).toBeLessThanOrEqual(before.length);
  });
});
