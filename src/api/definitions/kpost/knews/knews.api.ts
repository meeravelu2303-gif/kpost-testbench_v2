import { pathParamSchema, typesOnlySchema } from '@api/schema/sample-schema';
import type { EndpointDefinition } from '../../../registry/endpoint-definition';
import {
  body,
  defineKpostEndpoint,
  defineUndocumentedKpostEndpoint,
  pathParams,
  queryParams,
  type KpostEndpointConfig,
  type UndocumentedKpostEndpointConfig,
} from '../kpost-endpoint';

/**
 * KNews: the news reference data and the caller's own news settings (`/v2/knews/*`, in the workbook),
 * the article feed the web app reads (`/v1/news*`), and the feed administration (`/admin/news/*`).
 * Everything needs a login; the admin routes change every user's feed and are never driven.
 */
const KNEWS_TAGS = ['knews'] as const;

function defineKnewsEndpoint(config: KpostEndpointConfig): EndpointDefinition {
  return defineKpostEndpoint({
    ...config,
    authentication: config.authentication ?? { required: true },
    tags: [...KNEWS_TAGS, ...(config.tags ?? [])],
  });
}

function defineUndocumentedKnewsEndpoint(
  config: UndocumentedKpostEndpointConfig,
): EndpointDefinition {
  return defineUndocumentedKpostEndpoint({
    ...config,
    authentication: config.authentication ?? { required: true },
    tags: [...KNEWS_TAGS, ...(config.tags ?? [])],
  });
}

/** The workbook's settings example (KatchupAPI row 259), with nothing personal in it. */
const SETTINGS = {
  countryName: 'India',
  stateName: 'Tamil Nadu',
  cityNames: 'Chennai, Coimbatore',
  languageId: 817,
  newsType: 'Paid Digital News',
  newsSource: 'All',
  publications: 'India Today, The Hindu, Times of India',
  category: 'Sports',
  subCategories: 'Badminton, Cricket, Tennis',
  retentionDays: 30,
  archiveDays: 30,
  subscriptionDetails:
    '{"newsCost":300,"newsCostPeriod":"Per Year","kpostServiceCharge":30,"gstPercent":18,"gstAmount":54,"totalPayableAmount":384,"currency":"INR"}',
};

export const categoriesApi = defineKnewsEndpoint({
  id: 'knews-categories',
  method: 'GET',
  path: '/v2/knews/getAllCategories/',
  summary: 'News categories (reference data)',
  // Reference data; names nobody.
  productionSafe: true,
});

export const subCategoriesApi = defineKnewsEndpoint({
  id: 'knews-sub-categories',
  method: 'POST',
  path: '/v2/knews/getSubCategoriesByCategoryId/',
  summary: 'Sub-category names of one news category',
  destructive: false,
  productionSafe: true,
  // The workbook's example category; an id comes from getAllCategories data[].id.
  request: body(() => ({ categoryId: 7 })),
});

export const publicationsApi = defineKnewsEndpoint({
  id: 'knews-publications',
  method: 'POST',
  path: '/v2/knews/getPublicationByLanguageId/',
  summary: 'News publications for one language',
  destructive: false,
  productionSafe: true,
  request: body(() => ({ languageId: SETTINGS.languageId })),
});

export const newsSourcesApi = defineKnewsEndpoint({
  id: 'knews-sources',
  method: 'GET',
  path: '/v2/knews/getAllNewsSource/',
  summary: 'Active news source names (reference data)',
  productionSafe: true,
});

export const updateSettingsApi = defineKnewsEndpoint({
  id: 'knews-update-settings',
  method: 'POST',
  path: '/v2/knews/updateKnewsSettings/',
  summary: 'Save the caller’s own news settings',
  tags: ['settings'],
  // Our own TBL_KPOST_KN_SETTINGS row (kpostId is taken from the token); the knews flow restores it.
  destructive: true,
  sideEffect: 'data',
  request: body(() => ({ ...SETTINGS })),
  note: 'the body kpostId is ignored (overwritten from the token, KnewsController.java:131) — the IDOR probe checks that',
});

export const getSettingsApi = defineKnewsEndpoint({
  id: 'knews-get-settings',
  method: 'GET',
  path: '/v2/knews/getKnewsSettings/',
  summary: 'The caller’s own news settings',
  tags: ['settings'],
  productionSafe: true,
  // 404 FAILURE is the answer for a user who never saved settings (KnewsController.java:162-165).
  expectedStatus: [200, 404],
});

export const newsFeedApi = defineUndocumentedKnewsEndpoint({
  id: 'knews-news-feed',
  method: 'GET',
  path: '/v1/news',
  summary: 'The news article feed (the web app’s KNews page)',
  // Read-only from the database (never calls the providers); not the KPost envelope.
  productionSafe: true,
  envelope: false,
  request: queryParams(() => ({ limit: 30 })),
  evidence: 'React Services/KNews.js:602-621 (GET /v1/news?limit=30…); NewsController.java:48-61',
});

export const feedStatusApi = defineUndocumentedKnewsEndpoint({
  id: 'knews-feed-status',
  method: 'GET',
  path: '/v1/news/feeds/status',
  summary: 'The state of every news feed (OK / FAILING / PENDING / DISABLED)',
  productionSafe: true,
  envelope: false,
  evidence:
    'NewsController.java:77-91 (no admin check: any logged-in user sees it); no client calls it',
});

export const feedArticlesApi = defineUndocumentedKnewsEndpoint({
  id: 'knews-feed-articles',
  method: 'GET',
  path: '/v1/news/feeds/{feedId}/articles',
  summary: 'Articles of one news feed',
  tags: ['needs-id'],
  envelope: false,
  // A real feedId comes from /v1/news/feeds/status; the knews flow asks it with the first one.
  request: pathParams(() => ({ feedId: 'no_such_feed' })),
  pathParamsSchema: pathParamSchema('feedId'),
  evidence:
    'React Services/KNews.js:614 (/v1/news/feeds/${feedId}/articles?limit=30); NewsController.java:63-75',
});

/** The feed administration: each changes every user's news, so none is ever driven (owner rule). */
function feedAdmin(
  id: string,
  method: 'POST' | 'PUT',
  path: string,
  summary: string,
  evidence: string,
): EndpointDefinition {
  return defineUndocumentedKnewsEndpoint({
    id,
    method,
    path,
    summary,
    tags: ['admin', 'needs-id'],
    destructive: true,
    sideEffect: 'global',
    ...(path.includes('{feedId}')
      ? {
          request: pathParams(() => ({ feedId: 'no_such_feed' })),
          pathParamsSchema: pathParamSchema('feedId'),
        }
      : {}),
    evidence,
    note:
      'never driven: changes every user’s news (sync also fetches every RSS feed from the internet); ' +
      'the knews-admin allow-list is empty in the repo config, so every caller gets 403 — confirm live',
  });
}

export const feedSyncApi = feedAdmin(
  'knews-admin-feed-sync',
  'POST',
  '/admin/news/feeds/sync',
  'Start a sync of every enabled news feed now',
  'NewsAdminController.java:42-54; NewsSyncService.java:91-159 (fetches each rss_url over the internet)',
);
export const feedEnableApi = feedAdmin(
  'knews-admin-feed-enable',
  'PUT',
  '/admin/news/feeds/{feedId}/enable',
  'Turn a news feed on for everyone',
  'NewsAdminController.java:56-59,66-84 (@PutMapping)',
);
export const feedDisableApi = feedAdmin(
  'knews-admin-feed-disable',
  'PUT',
  '/admin/news/feeds/{feedId}/disable',
  'Turn a news feed off for everyone',
  'NewsAdminController.java:61-64,66-84 (@PutMapping)',
);

export const knewsApis = [
  categoriesApi,
  subCategoriesApi,
  publicationsApi,
  newsSourcesApi,
  updateSettingsApi,
  getSettingsApi,
  newsFeedApi,
  feedStatusApi,
  feedArticlesApi,
  feedSyncApi,
  feedEnableApi,
  feedDisableApi,
];

// Keeps the settings sample available to the knews flow and the schema derivation.
export const KNEWS_SETTINGS_SAMPLE = SETTINGS;
export const knewsSettingsSchema = typesOnlySchema(SETTINGS);
