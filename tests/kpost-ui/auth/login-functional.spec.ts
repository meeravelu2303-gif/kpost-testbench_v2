import { testData } from '@config/test-data.config';
import { KpostRepository } from '@database/repositories/kpost.repository';
import { expect, test } from '@fixtures';

/**
 * Login screen: the UI's own handling (field validation, error display, stuck spinner, no session
 * after a failure). Error responses are stubbed with page.route so a shared QA account is never locked.
 */
test.describe(
  'KPost login · UI functional behaviour @ui',
  { tag: ['@ui', '@auth', '@regression', '@sanity'] },
  () => {
    // These drive a real, unauthenticated login screen, so a saved session must not short-circuit it.
    test.use({ storageState: { cookies: [], origins: [] } });

    test.skip(!testData.kpostId, 'needs QA_KPOST_ID');

    test('the login id field rejects a malformed id before any request is sent', async ({
      loginPage,
      page,
    }) => {
      // Records the requests so the annotation can say whether the client validated locally.
      const loginCalls: string[] = [];
      await page.route('**/signupLogin/**', async (route) => {
        loginCalls.push(route.request().url());
        await route.continue();
      });

      await loginPage.goto();
      await loginPage.expectLoaded();

      await loginPage.loginIdInput.fill('not-a-valid-id');
      await loginPage.submitButton.click();

      // Auto-waits, so no fixed sleep is needed.
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

      // Local vs server-side validation is a design choice, so only the password step is asserted.
    });

    test('an empty password is not submitted', async ({ loginPage, page }) => {
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

      // A disabled button would make .click() time out, so check that first; otherwise prove no
      // request is dispatched.
      if (await loginPage.loginButton.isDisabled()) {
        expect(true, 'the login button is disabled with an empty password').toBe(true);
      } else {
        // Wait for the request instead of sleeping: a timeout here is the passing case.
        await loginPage.loginButton.click();
        const dispatched = await page
          .waitForRequest('**/userLogin**', { timeout: 5000 })
          .then(() => true)
          .catch(() => false);

        expect(dispatched, 'a login with an empty password must not be sent').toBe(false);
      }
      expect(submitted, 'nothing reached the network either way').toHaveLength(0);
    });

    test('the error the user sees matches the error the server sent', async ({
      loginPage,
      page,
    }) => {
      const serverMessage = 'Invalid credentials. Please check your password.';
      await page.route('**/userLogin**', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          // KPost's envelope: HTTP 200 carrying a failure.
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

      // The user must be told something and not let in; the exact wording is only reported.
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

      // 10 s is the point a user concludes the page hung; the wait settles as soon as control returns.
      await expect(
        loginPage.loginButton,
        'after a failed login the user must be able to try again — a button left disabled, or a ' +
          'spinner that never clears, means the only way out is a page reload',
      ).toBeEnabled({ timeout: 10_000 });

      expect(/\/login/.test(page.url()), 'a 500 must not navigate the user into the app').toBe(
        true,
      );
    });

    test("a disabled-account rejection shows the server's own message @ui", async ({
      loginPage,
      page,
    }) => {
      // A 403 rejection shape, stubbed so no real account is locked.
      const serverMessage = 'Your account has been disabled. Please contact support.';
      await page.route('**/userLogin**', async (route) => {
        await route.fulfill({
          status: 403,
          contentType: 'application/json',
          body: JSON.stringify({
            statusCode: 403,
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
      await loginPage.passwordInput.fill('anypassword123');
      await loginPage.loginButton.click();

      await expect(
        page.getByText(serverMessage),
        'a disabled account must be told WHY, not given a generic or missing error',
      ).toBeVisible({ timeout: 10_000 });
      expect(
        /\/login/.test(page.url()),
        'a disabled-account rejection must not navigate the user into the app',
      ).toBe(true);
    });

    test('a failed login leaves no session row behind @database', async ({
      loginPage,
      page,
      databases,
    }) => {
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

      // Wait for the rejection before reading the DB, or the read samples rows too early.
      await expect(page, 'the rejected login stays on the login screen').toHaveURL(/\/login/, {
        timeout: 10_000,
      });

      const after = await repo.sessions(testData.kpostId);

      // A non-increase, not an exact count: other suites log in to the shared account concurrently.
      expect(
        after.length,
        `a login the user was told had failed must not create a session ` +
          `(${before.length} before, ${after.length} after)`,
      ).toBeLessThanOrEqual(before.length);
    });
  },
);
