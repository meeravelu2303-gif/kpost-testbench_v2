import { typesOnlySchema } from '@api/schema/sample-schema';
import { body } from '../kpost-endpoint';
import { defineContactsEndpoint } from './contacts-endpoint';

/**
 * Contacts reads: address book, groups, phone contacts, blocked list and search. All run on live.
 * `lastfetchDate: null` means the full list; POST reads set `destructive: false`.
 */
const READ_TAGS = ['contacts-read'] as const;

export const myContactsApi = defineContactsEndpoint({
  id: 'contacts-my-contacts',
  // KDirectory directory listing + total count (FR-KD-001/004) — the org directory is the same
  // contacts surface (see docs/reference/requirements-frd.md § KDirectory).
  requirements: ['FR-KD-001', 'FR-KD-004'],
  method: 'POST',
  path: '/v2/contacts/myContacts/',
  summary: "The caller's known contacts",
  tags: [...READ_TAGS, 'list'],
  destructive: false,
  productionSafe: true,
  // Contact emails are user-entered data returned as-is, so common.email does not apply.
  skipValidators: ['common.email'],
  request: body(() => ({ lastfetchDate: null })),
});

export const myUnknownContactsApi = defineContactsEndpoint({
  id: 'contacts-my-unknown-contacts',
  method: 'POST',
  path: '/v2/contacts/myUnknownKatchupContacts/',
  summary: 'People who messaged the caller but are not saved contacts',
  tags: [...READ_TAGS, 'list'],
  destructive: false,
  productionSafe: true,
  // As in myContacts, emails are other people's data returned as-is.
  skipValidators: ['common.email'],
  request: body(() => ({ lastfetchDate: null })),
});

export const myGroupsApi = defineContactsEndpoint({
  id: 'contacts-my-groups',
  requirements: ['FR-GM-002'],
  method: 'POST',
  path: '/v2/contacts/myGroups/',
  summary: "The caller's groups",
  tags: [...READ_TAGS, 'group'],
  destructive: false,
  productionSafe: true,
  request: body(() => ({ lastfetchDate: null })),
});

export const myUnknownGroupsApi = defineContactsEndpoint({
  id: 'contacts-my-unknown-groups',
  method: 'POST',
  path: '/v2/contacts/myUnknownGroups/',
  summary: 'Groups the caller is in but has not saved',
  tags: [...READ_TAGS, 'group'],
  destructive: false,
  productionSafe: true,
  request: body(() => ({ lastfetchDate: null })),
});

export const importedPhoneContactsApi = defineContactsEndpoint({
  id: 'contacts-imported-phone',
  method: 'GET',
  path: '/v2/contacts/getImportedPhoneContacts/',
  summary: 'Phone contacts the caller has imported',
  tags: [...READ_TAGS, 'list'],
  productionSafe: true,
});

export const blockedContactsApi = defineContactsEndpoint({
  id: 'contacts-blocked',
  method: 'GET',
  path: '/v2/contacts/getblockContactDetails',
  summary: 'The contacts the caller has blocked',
  tags: [...READ_TAGS, 'block'],
  productionSafe: true,
  // Types-only, from a captured live body.
  responseSchema: typesOnlySchema({ data: [], urlPath: '', status: 'SUCCESS', statusCode: 200 }),
});

export const globalSearchApi = defineContactsEndpoint({
  id: 'contacts-global-search',
  // KDirectory search-by-name + entry details (FR-KD-002/003).
  requirements: ['FR-KD-002', 'FR-KD-003'],
  method: 'POST',
  path: '/v2/contacts/globalSearch/',
  summary: 'Search all KPost users by name/filters',
  tags: [...READ_TAGS, 'search', 'enumeration-surface'],
  // A search over public directory data with a harmless term. No identifier names anyone specific.
  destructive: false,
  productionSafe: true,
  request: body(() => ({
    search: 'qa',
    languageList: ['english'],
    userTypeList: ['personal'],
    countryList: ['india'],
  })),
});

export const searchDetailsApi = defineContactsEndpoint({
  id: 'contacts-search-details',
  method: 'POST',
  path: '/v2/contacts/getSearchDetails/',
  summary: 'Reference-data lookups for the search filters (area/province/state)',
  tags: [...READ_TAGS, 'search', 'reference'],
  // Reference data (area names), not a person. Harmless read.
  destructive: false,
  productionSafe: true,
  // A cascade: country -> provienceName (a zone) -> state -> city -> areaName, each needing the
  // levels above. Only `provienceName` works with just `country`; the cascade spec drives the rest.
  request: body(() => ({
    requestType: 'provienceName',
    country: 'INDIA',
    provienceName: '',
    state: '',
    city: '',
  })),
});

export const contactsReadApis = [
  myContactsApi,
  myUnknownContactsApi,
  myGroupsApi,
  myUnknownGroupsApi,
  importedPhoneContactsApi,
  blockedContactsApi,
  globalSearchApi,
  searchDetailsApi,
];
