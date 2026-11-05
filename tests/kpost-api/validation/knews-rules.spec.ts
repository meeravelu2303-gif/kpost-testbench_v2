import { KNEWS_SETTINGS_SAMPLE } from '@api/definitions/kpost/knews/knews.api';
import { AUTH_PROFILES } from '@config/auth-profile';
import type { Principal } from '@config/auth.config';
import type { EndpointExecutor } from '@engine/endpoint-executor';
import { expect, test } from '@fixtures';

/**
 * KNews rules the engine's per-field cases do not reach.
 *
 * 1. The article feed (GET /v1/news, NewsController.java:48-61 → NewsQueryService.java:127-132) answers
 *    `{items, pagination, failedFeeds}`: either articles, or the feeds that failed, by name. An empty
 *    list with no failed feed is a silent failure (the user sees an empty KNews page and no reason).
 *    On the QA server TBL_KPOST_NEWS_FEED has no rows, so the sync job (NewsSyncScheduler →
 *    NewsSyncService.java:98, `feedRepository`) fetches nothing and the feed stays silently empty.
 *    A read: not gated.
 * 2. The caller's own news settings (updateKnewsSettings, KnewsController.java:126-149 →
 *    KnewsServiceImpl.java:62-95): what is saved reads back identically, the creation date survives
 *    an update (KnewsServiceImpl.java:91 resets it on every save), and a category, sub-category or
 *    news source the reference endpoints (getAllCategories, getSubCategoriesByCategoryId,
 *    getAllNewsSource) do not list is refused (the service stores any string, KnewsServiceImpl.java:67-90).
 *    There is no country reference list in KNews, so the country is not checked here.
 *    Writes only the caller's own settings row (kpostId comes from the token) and restores it in
 *    `finally`; gated behind `SETTINGS_LIFECYCLE=true`.
 */

const A: Principal = AUTH_PROFILES.kpost.principals.find((p) => p.key === 'personal')!;

type Row = Record<string, unknown>;
const SETTING_KEYS = Object.keys(KNEWS_SETTINGS_SAMPLE) as Array<
  keyof typeof KNEWS_SETTINGS_SAMPLE
>;

function bodyOf(ex: { json(): { ok: boolean; value?: unknown } }): Row {
  const parsed = ex.json();
  return (parsed.ok ? parsed.value : {}) as Row;
}

async function readSettings(
  endpoints: EndpointExecutor,
  step: string,
): Promise<{ status: number; data: Row | undefined }> {
  const ex = await endpoints.sendTo(
    'knews-get-settings',
    {},
    { label: `knews-rules:read-${step}`, auth: { principal: A } },
  );
  const data = ex.status === 200 ? (bodyOf(ex).data as Row | undefined) : undefined;
  return { status: ex.status, data };
}

async function saveSettings(
  endpoints: EndpointExecutor,
  body: Row,
  step: string,
): Promise<{ status: number; text: string }> {
  const ex = await endpoints.sendTo(
    'knews-update-settings',
    { body },
    { label: `knews-rules:save-${step}`, auth: { principal: A }, allowLiveWrite: true },
  );
  return { status: ex.status, text: ex.bodyText ?? '' };
}

/** Puts back what was there; a user who had none keeps the workbook sample (there is no delete API). */
async function restore(endpoints: EndpointExecutor, original: Row | undefined): Promise<void> {
  const body = original
    ? Object.fromEntries(
        SETTING_KEYS.filter((k) => original[k] !== null && original[k] !== undefined).map((k) => [
          k,
          original[k],
        ]),
      )
    : { ...KNEWS_SETTINGS_SAMPLE };
  const restored = await saveSettings(endpoints, body, 'restore').catch(() => ({
    status: 0,
    text: '',
  }));
  expect.soft(restored.status, "A's original news settings are put back").toBe(200);
}

interface Category {
  id?: number;
  name?: string;
}

/** The reference lists the settings must come from; undefined when the server serves none. */
async function referenceData(endpoints: EndpointExecutor): Promise<{
  categories: Category[];
  sources: string[];
}> {
  const cats = await endpoints.sendTo('knews-categories', {}, { label: 'knews-rules:categories' });
  const srcs = await endpoints.sendTo('knews-sources', {}, { label: 'knews-rules:sources' });
  const categories = cats.status === 200 ? ((bodyOf(cats).data as Category[]) ?? []) : [];
  const sources = srcs.status === 200 ? ((bodyOf(srcs).data as string[]) ?? []) : [];
  return { categories: Array.isArray(categories) ? categories : [], sources };
}

test.describe(
  'KPost KNews · feed and settings rules',
  { tag: ['@api', '@kpost-api', '@verticals', '@regression'] },
  () => {
    test.describe.configure({ mode: 'default' });

    test('the news feed returns articles or names the feeds that failed, never a silent empty list @api @verticals', async ({
      endpoints,
    }) => {
      const ex = await endpoints.sendTo(
        'knews-news-feed',
        { query: { limit: 30 } },
        { label: 'knews-rules:news-feed', auth: { principal: A } },
      );
      expect(ex.status, 'GET /v1/news answers').toBe(200);
      const body = bodyOf(ex);
      const items = Array.isArray(body.items) ? body.items : [];
      const failedFeeds = Array.isArray(body.failedFeeds) ? body.failedFeeds : [];
      const silent = items.length === 0 && failedFeeds.length === 0;
      if (silent) {
        endpoints.recordBusinessRuleViolation({
          endpointId: 'knews-news-feed',
          ruleId: 'KNEWS-silent-empty-feed',
          rule:
            'GET /v1/news must return news articles, or name the feeds that failed in failedFeeds ' +
            '(NewsQueryService.java:127-132). An empty items list with an empty failedFeeds list leaves ' +
            'the KNews page blank with no reason: on the QA server TBL_KPOST_NEWS_FEED has no feeds, so ' +
            'the sync job (NewsSyncService.java:98) has nothing to fetch.',
          expected: 'items.length > 0, or failedFeeds naming each feed that could not be read',
          actual: `HTTP ${ex.status}: items ${JSON.stringify(body.items)}, failedFeeds ${JSON.stringify(body.failedFeeds)}`,
          request: { query: { limit: 30 } },
        });
      }
      expect
        .soft(silent, 'the feed has articles, or names the feeds that failed (not silently empty)')
        .toBe(false);
    });

    test.describe('settings writes (own row, restored)', () => {
      test.skip(
        process.env.SETTINGS_LIFECYCLE !== 'true',
        "writes A's own KNews settings (restored afterwards); set SETTINGS_LIFECYCLE=true",
      );

      test('saved news settings read back identically, and an update keeps the creation date @api @verticals', async ({
        endpoints,
      }) => {
        const before = await readSettings(endpoints, 'before');
        const { categories } = await referenceData(endpoints);
        const category = categories.find((c) => c.name)?.name ?? KNEWS_SETTINGS_SAMPLE.category;
        const stamp = Date.now();
        const wanted: Row = {
          ...KNEWS_SETTINGS_SAMPLE,
          cityNames: `Madurai, Salem ${stamp}`,
          category,
          retentionDays: 21,
          archiveDays: 14,
        };
        try {
          const first = await saveSettings(endpoints, wanted, 'first');
          expect(first.status, 'updateKnewsSettings saves A’s own settings').toBe(200);
          const read1 = await readSettings(endpoints, 'after-first');
          expect(read1.status, 'getKnewsSettings reads them back').toBe(200);
          const differing = SETTING_KEYS.filter(
            (k) => JSON.stringify(read1.data?.[k]) !== JSON.stringify(wanted[k]),
          );
          if (differing.length) {
            endpoints.recordBusinessRuleViolation({
              endpointId: 'knews-update-settings',
              ruleId: 'KNEWS-settings-read-back',
              rule: 'getKnewsSettings must return exactly what updateKnewsSettings saved (KnewsServiceImpl.java:62-99).',
              expected: Object.fromEntries(differing.map((k) => [k, wanted[k]])),
              actual: Object.fromEntries(differing.map((k) => [k, read1.data?.[k]])),
              request: { body: wanted },
            });
          }
          expect.soft(differing, 'every saved field reads back unchanged').toEqual([]);

          const createdBefore = read1.data?.createdDate;
          const second = await saveSettings(endpoints, { ...wanted, retentionDays: 7 }, 'second');
          expect.soft(second.status, 'a second save is accepted').toBe(200);
          const read2 = await readSettings(endpoints, 'after-second');
          const createdAfter = read2.data?.createdDate;
          expect.soft(read2.data?.retentionDays, 'the update is stored').toBe(7);
          if (
            createdBefore !== undefined &&
            JSON.stringify(createdAfter) !== JSON.stringify(createdBefore)
          ) {
            endpoints.recordBusinessRuleViolation({
              endpointId: 'knews-update-settings',
              ruleId: 'KNEWS-settings-created-date-kept',
              rule:
                'Updating existing news settings must keep their creation date and change only the modified ' +
                'date; KnewsServiceImpl.java:91 sets createdDate to now on every save.',
              expected: `createdDate stays ${JSON.stringify(createdBefore)}`,
              actual: `createdDate became ${JSON.stringify(createdAfter)} after an update`,
              request: { body: { ...wanted, retentionDays: 7 } },
            });
          }
          expect
            .soft(createdAfter, 'an update keeps the settings’ creation date')
            .toEqual(createdBefore);
        } finally {
          await restore(endpoints, before.data);
        }
      });

      test('a category, sub-category or news source that is not in the KNews reference lists is refused @api @verticals', async ({
        endpoints,
      }) => {
        const before = await readSettings(endpoints, 'before');
        const { categories, sources } = await referenceData(endpoints);
        const real = categories.find((c) => c.name && typeof c.id === 'number');
        test.skip(!real, 'getAllCategories lists no category to compare against');

        const subs = await endpoints.sendTo(
          'knews-sub-categories',
          { body: { categoryId: real!.id } },
          { label: 'knews-rules:sub-categories' },
        );
        const subList = subs.status === 200 ? ((bodyOf(subs).data as string[]) ?? []) : [];
        const stamp = Date.now();
        const baseline: Row = {
          ...KNEWS_SETTINGS_SAMPLE,
          category: real!.name,
          subCategories: subList.slice(0, 2).join(', ') || KNEWS_SETTINGS_SAMPLE.subCategories,
        };

        const cases: Array<{ field: string; bad: string; listed: boolean }> = [
          {
            field: 'category',
            bad: `QA No Such Category ${stamp}`,
            listed: categories.some((c) => c.name === `QA No Such Category ${stamp}`),
          },
          {
            field: 'subCategories',
            bad: `QA No Such Sub ${stamp}`,
            listed: subList.includes(`QA No Such Sub ${stamp}`),
          },
          {
            field: 'newsSource',
            bad: `QA No Such Source ${stamp}`,
            listed: sources.length === 0 || sources.includes(`QA No Such Source ${stamp}`),
          },
        ];

        try {
          const saved = await saveSettings(endpoints, baseline, 'baseline');
          expect(saved.status, 'a settings row made of listed values is saved').toBe(200);

          for (const c of cases) {
            if (c.listed) continue; // no reference list to judge against (or the value is listed)
            const body = { ...baseline, [c.field]: c.bad };
            const reply = await saveSettings(endpoints, body, `unknown-${c.field}`);
            const stored = (await readSettings(endpoints, `after-${c.field}`)).data?.[c.field];
            if (reply.status < 400 || stored === c.bad) {
              endpoints.recordBusinessRuleViolation({
                endpointId: 'knews-update-settings',
                ruleId: `KNEWS-settings-${c.field}-from-reference`,
                rule:
                  `updateKnewsSettings must refuse a ${c.field} value the KNews reference endpoints do not ` +
                  'list (getAllCategories / getSubCategoriesByCategoryId / getAllNewsSource); ' +
                  'KnewsServiceImpl.java:67-90 stores any string.',
                expected: `a 4xx, ${c.field} stays ${JSON.stringify(baseline[c.field])}`,
                actual: `HTTP ${reply.status}; ${c.field} is now ${JSON.stringify(stored)}`,
                request: { body },
              });
            }
            expect
              .soft(reply.status, `an unlisted ${c.field} is refused`)
              .toBeGreaterThanOrEqual(400);
            expect.soft(stored, `the stored ${c.field} is unchanged`).toBe(baseline[c.field]);
          }
        } finally {
          await restore(endpoints, before.data);
        }
      });
    });
  },
);
