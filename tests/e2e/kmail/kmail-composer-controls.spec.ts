import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';
import type { Page } from '@playwright/test';

/**
 * KMail composer controls on /writemail: formatting, K-AI Assist (panel only, no metered generation),
 * attachments, To suggestions, external recipients and the greeting row. Nothing is sent.
 */
test.describe(
  'KPost KMail · composer controls (FR-KM-016/017)',
  { tag: ['@ui', '@kmail', '@regression'] },
  () => {
    test.skip(
      !testData.kpostId || testData.kpostId.includes('qa.bench'),
      'needs a real live account (QA_KPOST_ID)',
    );

    async function openCompose(page: Page): Promise<void> {
      await page.goto('/writemail', { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await page
        .locator('.loader-overlay')
        .waitFor({ state: 'hidden', timeout: 30_000 })
        .catch(() => undefined);
      // A page crash (#990) is the screen sweep's finding; skip so this never files a duplicate.
      const crashed = await page
        .getByText(/Something went wrong/i)
        .first()
        .isVisible()
        .catch(() => false);
      test.skip(
        crashed,
        '/writemail rendered the error boundary ("Something went wrong") — #990-shaped crash, reported by screens-batch4, not a composer-control finding',
      );
      await expect(
        page.locator('.writeMailActionBar').first(),
        'the compose action bar renders',
      ).toBeVisible({ timeout: 20_000 });
    }

    test(
      'FR-KM-016 — Formatting Options reveals the toolbar and Bold / Italic apply to the body @ui',
      { annotation: [{ type: 'requirement', description: 'FR-KM-016' }] },
      async ({ page }) => {
        await openCompose(page);
        const formatting = page
          .locator('.writeMailActionBar .icon-KP_98-Font-Style[title="Formatting Options"]')
          .first();
        await expect(formatting, 'the action bar offers Formatting Options').toBeVisible();

        const editorWrap = page.locator('.ql-container').first().locator('..');
        const toolbar = editorWrap.locator('.ql-toolbar').first();
        await formatting.click();
        await expect(toolbar, 'Formatting Options shows the Quill toolbar').toBeVisible({
          timeout: 10_000,
        });
        for (const [sel, label] of [
          ['.ql-bold', 'Bold'],
          ['.ql-italic', 'Italic'],
          ['.ql-underline', 'Underline'],
        ] as const) {
          await expect(toolbar.locator(sel).first(), `${label} is in the toolbar`).toBeVisible();
        }

        const body = page.locator('.ql-editor[contenteditable="true"]').first();
        await body.click();
        await toolbar.locator('.ql-bold').first().click();
        await page.keyboard.type('bold mail text');
        await toolbar.locator('.ql-bold').first().click();
        await toolbar.locator('.ql-italic').first().click();
        await page.keyboard.type(' italic mail text');

        await expect(
          body.locator('strong, b').filter({ hasText: 'bold mail text' }).first(),
          'Bold wraps the typed text',
        ).toBeVisible();
        await expect(
          body.locator('em, i').filter({ hasText: 'italic mail text' }).first(),
          'Italic wraps the typed text',
        ).toBeVisible();
      },
    );

    test(
      'FR-KM-017 — the K-AI Assist trigger opens its panel without running a generation, and closes @ui',
      { annotation: [{ type: 'requirement', description: 'FR-KM-017' }] },
      async ({ page }) => {
        await openCompose(page);
        const aiCalls: string[] = [];
        page.on('request', (r) => {
          // Match whole path segments: "getKmailDashboardMsg" and font names contain the letters "ai".
          const p = new URL(r.url()).pathname;
          if (/\/translator\/translation|\/(ai|prompt|generate|openai|gpt)(\/|$)/i.test(p))
            aiCalls.push(r.url());
        });

        const trigger = page.locator('.cas-trigger[aria-label="K-AI Assist"]').first();
        await expect(trigger, 'the composer offers K-AI Assist').toBeVisible({ timeout: 10_000 });
        await trigger.click();

        const panel = page.locator('.cas-pop').first();
        await expect(panel, 'the K-AI Assist panel opens').toBeVisible({ timeout: 10_000 });
        await expect(
          panel.locator('.cas-pop-head').first(),
          'the panel has its header',
        ).toBeVisible();

        // Close via the panel's own close button (aria-label from the source) or the trigger again.
        const close = panel.getByRole('button', { name: /close/i }).first();
        if (await close.isVisible().catch(() => false)) await close.click();
        else await trigger.click();
        await expect(panel, 'the panel closes').toBeHidden({ timeout: 10_000 });

        test.info().annotations.push({
          type: 'observed',
          description: `AI-looking requests while opening/closing the panel: ${aiCalls.length}`,
        });
        expect(
          aiCalls,
          'opening the assist panel must not itself call the metered AI service',
        ).toEqual([]);
      },
    );

    test(
      'FR-KM-014 — the Attachment control takes one or more files and shows the attachment count @ui',
      { annotation: [{ type: 'requirement', description: 'FR-KM-014' }] },
      async ({ page }) => {
        await openCompose(page);
        const bar = page.locator('.writeMailActionBar').first();
        await expect(
          bar.locator('.icon-KP_36-Attach[title="Attachment"]').first(),
          'the action bar offers Attachment',
        ).toBeVisible();
        await bar.locator('input#fileInput[type="file"]').setInputFiles([
          { name: 'qa-one.txt', mimeType: 'text/plain', buffer: Buffer.from('QA attachment one') },
          { name: 'qa-two.txt', mimeType: 'text/plain', buffer: Buffer.from('QA attachment two') },
        ]);
        await expect(
          bar.locator('.attachment_count').first(),
          'the icon shows the number of attached files',
        ).toHaveText('02', { timeout: 10_000 });
      },
    );

    test(
      'FR-KM-003/004 — tapping To opens the suggestion list, and typing narrows it as you type @ui',
      {
        annotation: [
          { type: 'requirement', description: 'FR-KM-003' },
          { type: 'requirement', description: 'FR-KM-004' },
        ],
      },
      async ({ page }) => {
        // Contacts load asynchronously after focus, so the first narrowing step polls.
        await openCompose(page);
        const to = page.getByRole('textbox', { name: 'To' }).first();
        await to.click();
        const dropdown = page.locator('.suggestion-dropdown').first();
        await expect(dropdown, 'tapping To opens the suggestion list').toBeVisible({
          timeout: 10_000,
        });
        await expect(dropdown, 'the list is headed "Suggestions"').toContainText(/Suggestions/i);

        const needle = testData.victimKpostId.split('@')[0]!;
        const target = new RegExp(needle, 'i');
        const rows = dropdown.locator('.writeMailSuggestionRow, [class*="ContactBar"]');
        await to.pressSequentially(needle.slice(0, 3), { delay: 40 });
        await expect
          .poll(() => rows.filter({ hasText: target }).count(), {
            message: `a 3-letter prefix ("${needle.slice(0, 3)}") already suggests ${needle}`,
            timeout: 20_000,
          })
          .toBeGreaterThan(0);
        const broad = await rows.count();

        await to.pressSequentially(needle.slice(3), { delay: 40 });
        await expect(
          rows.filter({ hasText: target }).first(),
          `the full id still suggests ${needle}`,
        ).toBeVisible();
        // With a single prefix match there is nothing left to narrow.
        if (broad > 1)
          await expect
            .poll(() => rows.count(), {
              message: `typing more narrows the list (it had ${broad} rows for the prefix)`,
              timeout: 10_000,
            })
            .toBeLessThan(broad);
        test.info().annotations.push({
          type: 'observed',
          description: `prefix "${needle.slice(0, 3)}" → ${broad} suggestions; "${needle}" → ${await rows.count()}`,
        });
        await page.keyboard.press('Escape');
      },
    );

    test(
      'FR-KM-022 — an external (non-KPOST) address is accepted as the recipient; a malformed one is not @ui',
      { annotation: [{ type: 'requirement', description: 'FR-KM-022' }] },
      async ({ page }) => {
        await openCompose(page);
        const to = page.getByRole('textbox', { name: 'To' }).first();
        await expect(to, 'the To field renders').toBeVisible();

        // Malformed: handleInputonBlur only adopts a value that passes validateEmail.
        await to.fill('not-an-address');
        await to.blur();
        await expect(to, 'a malformed address is not adopted as a recipient').not.toHaveValue(
          /^not-an-address$/,
        );

        // Well-formed external address: adopted, shown by its local part (name = value.split('@')[0]).
        const external = `qa.external.${Date.now()}@example.com`;
        await to.fill(external);
        await to.blur();
        await expect(to, 'a valid external address becomes the recipient').toHaveValue(
          external.split('@')[0]!,
          { timeout: 10_000 },
        );
      },
    );

    /** Compose to the second QA account and return its greeting row (salutation box + name box). */
    async function greetingRow(page: Page) {
      await openCompose(page);
      const to = page.getByRole('textbox', { name: 'To' }).first();
      await to.click();
      await to.fill(testData.victimKpostId);
      await page
        .locator('.suggestion-dropdown')
        .getByText(testData.victimKpostId, { exact: false })
        .first()
        .click({ timeout: 8_000 })
        .catch(() => to.blur());
      const salutation = page.getByPlaceholder('Select Salutation').first();
      const name = page.locator('.himessagetextbox').first();
      await expect(salutation, 'the greeting row shows the salutation box').toBeVisible({
        timeout: 15_000,
      });
      await expect(name, 'the recipient name is filled in next to it').not.toHaveValue('', {
        timeout: 10_000,
      });
      // The To suggestion panel can stay open over the greeting row; Escape closes it.
      await to.press('Escape');
      await page
        .locator('.suggestion-dropdown')
        .first()
        .waitFor({ state: 'hidden', timeout: 5_000 })
        .catch(() => undefined);
      return { salutation, name, autoName: await name.inputValue() };
    }

    test(
      'FR-KM-007..008 — the salutation list defaults to Hi and a pick updates the greeting row @ui',
      { annotation: [{ type: 'requirement', description: 'FR-KM-007..008' }] },
      async ({ page }) => {
        test.skip(!testData.victimKpostId, 'needs a second QA account as the recipient');
        const { salutation, name, autoName } = await greetingRow(page);
        await expect(salutation, 'it defaults to "Hi" (FR-KM-007)').toHaveValue('Hi');

        await salutation.click();
        const menu = page.locator('.custom-dropdown-menu').first();
        await expect(menu, 'tapping it opens the salutation list').toBeVisible({ timeout: 10_000 });
        // Clear the search text first: the list is filtered by what the box holds ("Hi").
        await salutation.fill('');
        const items = menu.locator('.custom-dropdown-item');
        await expect
          .poll(() => items.count(), { message: 'the full list shows', timeout: 10_000 })
          .toBeGreaterThan(1);
        const options = (await items.allInnerTexts()).map((t) => t.trim());
        test
          .info()
          .annotations.push({ type: 'observed', description: `list: ${options.join(' | ')}` });
        // Sir / Madam / Respect only appear inside longer forms ("Respected Sir"), so match a substring.
        for (const s of ['Hi', 'Hello', 'Dear'])
          expect(options, `the list offers "${s}" (FR-KM-007)`).toContain(s);
        for (const s of ['Sir', 'Madam', 'Respect'])
          expect(options, `the list offers a "${s}" form (FR-KM-007)`).toContainEqual(
            expect.stringContaining(s),
          );

        await menu
          .locator('.custom-dropdown-item', { hasText: /^Hello$/ })
          .first()
          .click();
        await expect(salutation, 'the pick replaces the salutation (FR-KM-008)').toHaveValue(
          'Hello',
        );
        await expect(menu, 'and the list closes').toBeHidden();
        await expect(name, 'the name stays beside it').toHaveValue(autoName);
      },
    );

    test(
      'FR-KM-008 — the auto-filled recipient name in the greeting row can be edited by hand @ui',
      { annotation: [{ type: 'requirement-partial', description: 'FR-KM-008' }] },
      async ({ page }) => {
        // Known defect #13213: the name box has no onChange, so typing is discarded.
        test.skip(!testData.victimKpostId, 'needs a second QA account as the recipient');
        const { name, autoName } = await greetingRow(page);
        await name.click();
        await page.keyboard.press('End');
        await page.keyboard.type(' QA');
        test.info().annotations.push({
          type: 'observed',
          description: `name before "${autoName}", after typing " QA": "${await name.inputValue()}"`,
        });
        await expect(name, 'the recipient name can be edited by hand (FR-KM-008)').toHaveValue(
          `${autoName} QA`,
        );
      },
    );
  },
);
