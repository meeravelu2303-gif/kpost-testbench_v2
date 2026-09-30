import { watchUiHealth } from '@ui/ui-health';
import { expect, test } from '@fixtures';

/**
 * `/child-safety-standards-policy` — a PUBLIC route (explicitly excluded from the auth-redirect check
 * in `MenuRoutes.js`, alongside `/login`/`/signup`/`/kall-window`), so any visitor can reach it with no
 * session at all.
 *
 * **Confirmed from source**: `ChildSafetyPolicy.jsx` (155 lines) is ENTIRELY commented out, including
 * its own `export default ChildSafetyPolicy;` statement (the last line is itself a comment). The
 * module therefore has NO live default export — `MenuRoutes.js` imports it as `undefined` and renders
 * `<ChildSafetyPolicy />`, which React cannot mount ("Element type is invalid: expected a string...
 * but got: undefined"). This is about as high-confidence a source-level finding as exists: it isn't a
 * maybe, an absent default export feeding a JSX element is a guaranteed runtime crash, not a
 * possibility to probe for — this test exists to confirm it fires exactly as predicted on the live
 * deployed build (source and deployment can drift) before it's filed as a bug.
 */
test.describe('KPost Child Safety Policy — public route', { tag: '@ui' }, () => {
  // No storage state / auth needed — this route is explicitly public.
  test.use({ storageState: { cookies: [], origins: [] } });

  test('visiting /child-safety-standards-policy renders its policy heading without crashing @ui', async ({
    page,
  }) => {
    const stop = watchUiHealth(page);

    await page.goto('/child-safety-standards-policy', {
      waitUntil: 'domcontentloaded',
      timeout: 45_000,
    });
    await page.waitForTimeout(2_000);

    const health = stop();

    test.info().annotations.push({
      type: 'observed',
      description: `page errors: ${JSON.stringify(health.pageErrors)}`,
    });

    // Predicted from source to fail: ChildSafetyPolicy.jsx's entire file, including its own
    // `export default` statement, is commented out, so this component has no live default export.
    // If this assertion fails with a React "Element type is invalid" uncaught error, that confirms
    // the prediction on the live build — the evidence needed before filing, not an assumption.
    expect(health.pageErrors, 'no uncaught JS error while rendering the policy page').toEqual([]);
    await expect(
      page.getByRole('heading', { name: /Child Safety Standards Policy/i }).first(),
      'the policy page renders its heading',
    ).toBeVisible({ timeout: 10_000 });
  });
});
