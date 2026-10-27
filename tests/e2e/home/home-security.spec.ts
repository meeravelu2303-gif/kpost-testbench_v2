import { testData } from '@config/test-data.config';
import { watchUiHealth } from '@ui/ui-health';
import { expect, test } from '@fixtures';
import { settleFrames, settleNetwork } from '../support/settle';

/**
 * XSS fuzzing of Home's Recents search box and Advanced Search "Enter Word" field. Detects execution
 * with a `dialog` listener, since these fields legitimately echo what was typed.
 */
test.describe(
  'KPost Home · search box security fuzzing',
  {
    tag: ['@ui', '@home', '@regression'],
    annotation: [{ type: 'non-functional', description: 'security' }],
  },
  () => {
    test.skip(
      !testData.kpostId || testData.kpostId.includes('qa.bench'),
      'needs a real live account (QA_KPOST_ID)',
    );

    const PAYLOADS: Array<{ name: string; value: string }> = [
      { name: 'script tag', value: '<script>alert(1)</script>' },
      { name: 'img onerror breakout', value: '"><img src=x onerror=alert(1)>' },
      { name: 'SQL-style OR-true', value: "' OR '1'='1" },
    ];

    for (const payload of PAYLOADS) {
      test(`the Recents search box survives a ${payload.name} payload without crashing or executing it @ui`, async ({
        homePage,
        page,
      }) => {
        const stop = watchUiHealth(page);
        let dialogFired = false;
        page.on('dialog', (dialog) => {
          dialogFired = true;
          void dialog.dismiss();
        });

        await homePage.goto();
        await homePage.switchToRecentsTab();
        await homePage.searchRecents(payload.value);
        await settleFrames(page);

        const health = stop();

        test.info().annotations.push({
          type: 'observed',
          description: `page errors: ${JSON.stringify(health.pageErrors)}; dialog fired: ${dialogFired}`,
        });

        expect(
          health.pageErrors,
          `no uncaught JS error while filtering by: ${payload.value}`,
        ).toEqual([]);
        expect(
          dialogFired,
          `the payload must never execute (no alert/confirm/prompt fired): ${payload.value}`,
        ).toBe(false);
      });
    }
  },
);

test.describe(
  'KPost Home · Advanced Search "Enter Word" field security fuzzing',
  {
    tag: ['@ui', '@home', '@regression'],
    annotation: [{ type: 'non-functional', description: 'security' }],
  },
  () => {
    test.skip(
      !testData.kpostId || testData.kpostId.includes('qa.bench'),
      'needs a real live account (QA_KPOST_ID)',
    );

    const PAYLOADS: Array<{ name: string; value: string }> = [
      { name: 'script tag', value: '<script>alert(1)</script>' },
      { name: 'img onerror breakout', value: '"><img src=x onerror=alert(1)>' },
      { name: 'SQL-style OR-true', value: "' OR '1'='1" },
    ];

    for (const payload of PAYLOADS) {
      test(`Advanced Search's Enter Word field survives a ${payload.name} payload and its submitted search does not execute it @ui`, async ({
        homePage,
        page,
      }) => {
        const stop = watchUiHealth(page);
        let dialogFired = false;
        page.on('dialog', (dialog) => {
          dialogFired = true;
          void dialog.dismiss();
        });

        await homePage.goto();
        await homePage.switchToRecentsTab();
        await homePage.openAdvancedSearch();
        // Search needs a date range to enable, so the payload reaches a real submitted search.
        await homePage.fillAdvancedSearch({
          word: payload.value,
          fromDate: '2026-01-01',
          toDate: '2026-09-30',
        });
        await expect(homePage.advancedSearchSubmitButton, 'Search becomes enabled').toBeEnabled({
          timeout: 10_000,
        });
        // The submitted search is a backend round-trip: wait for its answer, then a frame.
        const answered = settleNetwork(
          page,
          (url, method) => method === 'POST' && /search/i.test(url),
          15_000,
        );
        await homePage.advancedSearchSubmitButton.click();
        await answered;
        await settleFrames(page);

        const health = stop();

        test.info().annotations.push({
          type: 'observed',
          description: `page errors: ${JSON.stringify(health.pageErrors)}; dialog fired: ${dialogFired}`,
        });

        expect(health.pageErrors, `no uncaught JS error searching by: ${payload.value}`).toEqual(
          [],
        );
        expect(
          dialogFired,
          `the payload must never execute (no alert/confirm/prompt fired): ${payload.value}`,
        ).toBe(false);
      });
    }
  },
);
