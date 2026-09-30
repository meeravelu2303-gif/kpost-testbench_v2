import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';

/**
 * Settings · Account Recovery panel (`AccountRecovery.js`) — confirmed from source: a pure static
 * info panel, no inputs, no `Services/*` call, only a back-arrow control. Reached via "General
 * Settings" → "Account Recovery Settings". Scope is necessarily a smoke/render check — there is no
 * other interactive surface to test.
 */
test.describe('KPost Settings · Account Recovery panel', { tag: '@ui' }, () => {
  test.skip(
    !testData.kpostId || testData.kpostId.includes('qa.bench'),
    'needs a real live account (QA_KPOST_ID)',
  );

  test('opening Account Recovery Settings renders its info text @ui', async ({
    page,
    settingsPage,
  }) => {
    await settingsPage.goto();
    await settingsPage.openPanel('General Settings', 'Account Recovery Settings');

    await expect(
      page.getByText(/Account recovery settings will enable you to recover your account/i).first(),
      'the Account Recovery panel renders its static explanation text',
    ).toBeVisible({ timeout: 15_000 });
  });
});
