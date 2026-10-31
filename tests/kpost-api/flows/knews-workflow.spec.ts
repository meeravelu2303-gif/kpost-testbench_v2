import { KNEWS_SETTINGS_SAMPLE } from '@api/definitions/kpost/knews/knews.api';
import type { ParsedJson } from '@api/client/response-wrapper';
import { expect, test } from '@fixtures';

/**
 * KNews flows that need a real value from an earlier step: the caller's own news settings are saved,
 * read back and restored, and one real feed's articles are read with a feedId from the feed status.
 * Only our own settings row is written (kpostId comes from the token).
 */
type Envelope = { data?: Record<string, unknown> };

/** The parsed JSON body, or undefined when it is not JSON. */
function bodyOf<T>(exchange: { json(): ParsedJson }): T | undefined {
  const parsed = exchange.json();
  return parsed.ok ? (parsed.value as T) : undefined;
}

test.describe('KPost KNews · workflows', { tag: ['@api', '@verticals', '@regression'] }, () => {
  test.describe.configure({ mode: 'default' });

  test('news settings: save, read back, then restore what was there', async ({ endpoints }) => {
    const before = await endpoints.sendTo(
      'knews-get-settings',
      {},
      { label: 'knews:settings-before' },
    );
    const original = before.status === 200 ? bodyOf<Envelope>(before)?.data : undefined;

    const changed = { ...KNEWS_SETTINGS_SAMPLE, category: 'Technology', retentionDays: 15 };
    const saved = await endpoints.sendTo(
      'knews-update-settings',
      { body: changed },
      { label: 'knews:settings-save', allowLiveWrite: true },
    );
    try {
      expect(saved.status, 'updateKnewsSettings saves our own settings').toBe(200);

      const read = await endpoints.sendTo(
        'knews-get-settings',
        {},
        { label: 'knews:settings-read' },
      );
      expect(read.status, 'getKnewsSettings reads them back').toBe(200);
      const data = bodyOf<Envelope>(read)?.data;
      expect.soft(data?.category, 'the saved category is stored').toBe('Technology');
      expect.soft(data?.retentionDays, 'the saved retention is stored').toBe(15);
    } finally {
      // Re-post what was there; a user with no settings before keeps the sample (no delete API).
      const restore = original
        ? Object.fromEntries(
            Object.keys(KNEWS_SETTINGS_SAMPLE).map((k) => [k, original[k] ?? undefined]),
          )
        : KNEWS_SETTINGS_SAMPLE;
      await endpoints
        .sendTo(
          'knews-update-settings',
          { body: restore },
          { label: 'knews:settings-restore', allowLiveWrite: true },
        )
        .catch(() => undefined);
    }
  });

  test('one real feed: its articles are served', async ({ endpoints }) => {
    const status = await endpoints.sendTo('knews-feed-status', {}, { label: 'knews:feed-status' });
    expect(status.status, 'the feed status list answers').toBe(200);
    const feeds = bodyOf<{ feeds?: { feedId?: string }[] }>(status)?.feeds ?? [];
    const feedId = feeds.find((f) => f.feedId)?.feedId;
    test.skip(
      !feedId,
      'no news feed on this target to read (the server has no KNews feeds configured)',
    );

    const articles = await endpoints.sendTo(
      'knews-feed-articles',
      { pathParams: { feedId: feedId! }, query: { limit: 30 } },
      { label: 'knews:feed-articles', allowLiveRead: true, ownedIdentifiers: [feedId!] },
    );
    expect(articles.status, `the articles of feed ${feedId} are served`).toBe(200);
    const body = bodyOf<{ items?: unknown }>(articles) ?? {};
    expect.soft(Array.isArray(body.items), 'the answer carries an items list').toBe(true);
  });
});
