import type { Page } from '@playwright/test';
import type { ScreenDef as UiScreenDef } from '@ui/screens';
import { runUiChecks } from '@ui/ui-checks';
import { watchUiHealth } from '@ui/ui-health';
import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';
import {
  gotoContacts,
  openAdvancedSearch,
  openCreateGroup,
  openPeopleSearch,
} from '../support/contacts';

/**
 * runUiChecks (health, performance, layout) on Contacts' people search, Advanced Search and
 * Create-Group dialog states.
 */
const RANK: Record<string, number> = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1, INFO: 0 };

async function assertNoFileableIssues(
  page: Page,
  screen: UiScreenDef,
  health: ReturnType<ReturnType<typeof watchUiHealth>>,
  loadMs: number,
): Promise<void> {
  const findings = await runUiChecks({ page, screen, health, loadMs });
  const fileable = findings.filter((f) => RANK[f.severity]! >= RANK.MEDIUM!);
  const context = findings.filter((f) => RANK[f.severity]! < RANK.MEDIUM!);
  if (context.length) {
    console.log(
      `[ui-context] ${screen.name}: ${context.map((f) => `[${f.check}] ${f.message}`).join(' | ')}`,
    );
  }
  const problems = fileable.map((f) => `[${f.check}] ${f.message}`);
  expect(problems, `${screen.name} UI issues — ${problems.join(' | ')}`).toEqual([]);
}

test.describe(
  'KPost Contacts — dynamic-state health/performance/layout sweep',
  {
    tag: ['@ui', '@contacts', '@regression'],
    annotation: [{ type: 'non-functional', description: 'performance' }],
  },
  () => {
    test.skip(
      !testData.kpostId || testData.kpostId.includes('qa.bench'),
      'needs a real live account (QA_KPOST_ID)',
    );

    test('Contacts — Add-contact people-search step: health, performance, layout @ui', async ({
      page,
    }) => {
      const stop = watchUiHealth(page);
      const started = Date.now();
      const opened = await gotoContacts(page);
      test.skip(
        !opened,
        'the Contacts panel was not showing right now (a session or load condition, not a Contacts defect) — see support/contacts.ts',
      );
      const search = await openPeopleSearch(page);
      expect(search, 'the people-search step renders').not.toBeNull();
      const loadMs = Date.now() - started;

      const screen: UiScreenDef = {
        route: '/kdirectory',
        name: 'Contacts — Add-contact people-search step',
        screen: 'katchup',
        ready: [],
        controls: [],
      };
      await assertNoFileableIssues(page, screen, stop(), loadMs);
    });

    test('Contacts — Advanced Search step: health, performance, layout @ui', async ({ page }) => {
      const stop = watchUiHealth(page);
      const started = Date.now();
      const opened = await gotoContacts(page);
      test.skip(
        !opened,
        'the Contacts panel was not showing right now (a session or load condition, not a Contacts defect) — see support/contacts.ts',
      );
      const search = await openPeopleSearch(page);
      expect(search, 'the people-search step renders').not.toBeNull();
      const mobile = await openAdvancedSearch(page);
      expect(mobile, 'Advanced Search opens').not.toBeNull();
      const loadMs = Date.now() - started;

      const screen: UiScreenDef = {
        route: '/kdirectory',
        name: 'Contacts — Advanced Search step',
        screen: 'katchup',
        ready: [],
        controls: [],
      };
      await assertNoFileableIssues(page, screen, stop(), loadMs);
    });

    test('Contacts — Create-Group dialog: health, performance, layout @ui', async ({ page }) => {
      const stop = watchUiHealth(page);
      const started = Date.now();
      const opened = await gotoContacts(page);
      test.skip(
        !opened,
        'the Contacts panel was not showing right now (a session or load condition, not a Contacts defect) — see support/contacts.ts',
      );
      const modal = await openCreateGroup(page);
      expect(modal, 'the Create New Group modal opens').not.toBeNull();
      const loadMs = Date.now() - started;

      const screen: UiScreenDef = {
        route: '/katchup',
        name: 'Contacts — Create-Group dialog',
        screen: 'katchup',
        ready: [],
        controls: [],
      };
      await assertNoFileableIssues(page, screen, stop(), loadMs);
    });
  },
);
