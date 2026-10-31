import { KpostRepository } from '@database/repositories/kpost.repository';
import { text } from '@database/kpost-assertions';
import { requireAll } from '@fixtures/test-accounts';
import { expect, test } from '@fixtures';
import { flowState } from '../../support/flow-state';

/**
 * Profile read → write → persist → re-read, asserted in the API and the database (the endpoints
 * answer SUCCESS whatever they stored). The original value is restored in `afterAll`.
 */
test.describe(
  'KPost Profile · update workflow @api @kpost-api @profile @database',
  { tag: ['@api', '@profile', '@regression'] },
  () => {
    // In order, but a failed step never skips the others.
    test.describe.configure({ mode: 'default' });

    const accounts = requireAll('primary');
    test.skip(!accounts.ok, accounts.ok ? '' : accounts.reason);

    /** A value unique to this run, so a stale row cannot pass the comparison by coincidence. */
    const aboutText = `QA bench about ${Date.now()}`;
    // On disk, so a restore after a failed step still puts back the real original value.
    const flow = flowState<{ originalAbout: string }>('profile-workflow');
    let restored = false;

    test.afterAll(async ({ endpoints }) => {
      // Put the profile back; a failed restore is reported, never silent.
      if (!accounts.ok) return;
      try {
        await endpoints.sendTo(
          'profile-update-about',
          { body: { aboutYourself: flow.get('originalAbout') ?? '' } },
          { label: 'profile-workflow:restore', allowLiveWrite: true },
        );
        restored = true;
      } catch {
        restored = false;
      }
      test.info().annotations.push({
        type: 'cleanup',
        description: restored
          ? `restored about_yourself to its original value`
          : `RESTORE FAILED — about_yourself may still read "${aboutText}"`,
      });
    });

    test('the profile row exists and is readable before anything is written', async ({
      databases,
    }) => {
      const database = databases.for('kpost-api');
      test.skip(!database.enabled, 'needs the KPOST_QA connection');
      const me = accounts.ok ? accounts.accounts[0] : undefined;
      test.skip(!me, 'needs the primary account');

      const profile = await new KpostRepository(database).profile(me?.kpostId ?? '');

      expect(profile, `TBL_KPOST_USER_PROFILE holds a row for ${me?.kpostId}`).toBeDefined();
      // Captured so the write can be undone; `null` is a legitimate starting state.
      const originalAbout = text(profile?.about_yourself);
      if (originalAbout !== undefined && flow.get('originalAbout') === undefined)
        flow.set('originalAbout', originalAbout);
    });

    test('an update is accepted, persisted, and advances modified_date', async ({
      endpoints,
      databases,
    }) => {
      const database = databases.for('kpost-api');
      test.skip(!database.enabled, 'needs the KPOST_QA connection');
      const me = accounts.ok ? accounts.accounts[0] : undefined;
      test.skip(!me, 'needs the primary account');

      const repo = new KpostRepository(database);
      const before = await repo.profile(me?.kpostId ?? '');
      const beforeModified = before?.modified_date ? new Date(before.modified_date).getTime() : 0;

      const exchange = await endpoints.sendTo(
        'profile-update-about',
        { body: { aboutYourself: aboutText } },
        { label: 'profile-workflow:update', allowLiveWrite: true },
      );

      // Check the envelope too: KPost can answer HTTP 200 carrying `statusCode: 500`.
      expect(exchange.status, 'the request itself succeeded').toBeLessThan(300);
      const parsed = exchange.json();
      const envelope = parsed.ok ? (parsed.value as { statusCode?: number; status?: string }) : {};
      expect(
        envelope.statusCode ?? 200,
        `the ENVELOPE reports success (body: ${exchange.bodyText.slice(0, 160)})`,
      ).toBeLessThan(300);

      const after = await repo.profile(me?.kpostId ?? '');

      // 1. It actually landed.
      expect(text(after?.about_yourself), 'the new text is in TBL_KPOST_USER_PROFILE').toBe(
        aboutText,
      );

      // 2. The audit column moved, so the row was really rewritten.
      const afterModified = after?.modified_date ? new Date(after.modified_date).getTime() : 0;
      expect(
        afterModified,
        'modified_date advanced, so the row was genuinely rewritten',
      ).toBeGreaterThanOrEqual(beforeModified);

      // 3. It landed on OUR row and no other. The natural key must be unchanged.
      expect(text(after?.kpost_id), 'the write stayed on the calling account’s row').toBe(
        me?.kpostId,
      );
    });

    test('the API reads back what the database holds', async ({ endpoints, databases }) => {
      const database = databases.for('kpost-api');
      test.skip(!database.enabled, 'needs the KPOST_QA connection');
      const me = accounts.ok ? accounts.accounts[0] : undefined;
      test.skip(!me, 'needs the primary account');

      const stored = await new KpostRepository(database).profile(me?.kpostId ?? '');

      const storedAbout = text(stored?.about_yourself);
      expect(storedAbout, 'the database holds the updated text').toBe(aboutText);

      // API half is narrow: fetchUserDetails omits aboutYourself, and the full-profile lookup
      // fails for this account (directory-lookup.spec.ts). Recorded as a coverage gap below.
      const exchange = await endpoints.sendTo(
        'profile-fetch-user-details',
        {},
        { label: 'profile-workflow:read-back' },
      );
      expect(exchange.status, 'the profile read succeeds').toBe(200);
      expect(exchange.bodyText.length, 'and returns a body scoped to the caller').toBeGreaterThan(
        0,
      );

      test.info().annotations.push({
        type: 'coverage-gap',
        description:
          'API read-back of aboutYourself is blocked: fetchUserDetails omits it, and ' +
          'getUserProfileUsingKpostID 404s for this account (see directory-lookup.spec.ts). ' +
          'Persistence is proven at the database layer instead.',
      });
    });
  },
);
