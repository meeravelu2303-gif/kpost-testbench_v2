import { body } from '../kpost-endpoint';
import { defineContactsEndpoint } from './contacts-endpoint';

/**
 * Contacts **reads** — the caller's address book, groups, imported phone contacts, blocked list, and
 * the two search surfaces.
 *
 * Every one reads only our own account or performs a harmless search, so all run on live. The
 * `lastfetchDate: null` the client sends means "the full list" (a delta sync passes a date). The
 * POST reads state `destructive: false` — without it a POST resolves to destructive, is tagged
 * `@destructive`, and the production `grepInvert` drops all its tests (the Dashboard trap).
 */
const READ_TAGS = ['contacts-read'] as const;

export const myContactsApi = defineContactsEndpoint({
  id: 'contacts-my-contacts',
  // KDirectory directory listing + total count (FR-KD-001/004) — the org directory is the same
  // contacts surface (see docs/requirements-frd.md § KDirectory).
  requirements: ['FR-KD-001', 'FR-KD-004'],
  method: 'POST',
  path: '/v2/contacts/myContacts/',
  summary: "The caller's known contacts",
  tags: [...READ_TAGS, 'list'],
  destructive: false,
  productionSafe: true,
  // A contact's email is USER-ENTERED data stored in the DB; the read faithfully returns it. A
  // malformed email in one contact row is a data-quality issue in that record, not a defect in this
  // read — so common.email (which flags returned email strings) is not meaningful here.
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
  // Same as myContacts: emails here are the un-saved senders' own data, returned as-is — a malformed
  // one is that record's data quality, not a defect in this read.
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
  // The documented cascade fields (province/state/city) are sent empty so the payload matches the
  // contract — an `areaName` lookup ignores them, but a strict presence check cannot then 400 us.
  request: body(() => ({
    requestType: 'areaName',
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
