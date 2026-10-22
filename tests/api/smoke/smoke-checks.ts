import { TAGS } from '@config/constants';
import { env } from '@config/env';
import { kmailAuthGate } from '@fixtures/kmail-auth-gate';

/**
 * API SMOKE — the checks, as data. One row per module, 1–3 reads each (the `lint:tags` smoke budget),
 * chosen as the read that proves the module's service is up and serving the signed-in user's data.
 * The spec (`api.smoke.spec.ts`) turns every row into one test; the helper (`smoke-read.ts`) owns how
 * a read is judged. To add a check, add a row here.
 *
 * Every read is `productionSafe` (it reads only our own QA data) and was probed live on 2026-10-22.
 * A row says what the answer must CONTAIN, not only that it was HTTP 200: KPost often answers 200
 * with `"status":"FAILURE"` in the body, which a status-only smoke would pass.
 */

/** The JSON type a field must have. */
export type FieldType = 'array' | 'object' | 'number' | 'string';

export interface SmokeRead {
  /** Registered endpoint id (`src/api/definitions`). */
  endpoint: string;
  /** What a pass proves, in plain words: it becomes the test title. */
  proves: string;
  /** Dotted paths that must be present with this type (`data`, `data.0.kpostID`, `msgsCount`). */
  fields?: Readonly<Record<string, FieldType>>;
  /** A dotted path whose value must be the signed-in personal account (this is OUR data). */
  ownerField?: string;
  /** The exact plain-text body expected (the platform status endpoint answers a bare word). */
  plainText?: string;
  /** Slower-than-usual reads get their own ceiling (default `SMOKE_MAX_MS`). */
  maxMs?: number;
}

export interface SmokeModule {
  /** Module name as people say it. */
  name: string;
  /** Its module tag (one per module; `lint:tags` counts the smoke budget per tag). */
  tag: string;
  /** Why the module's API smoke cannot run right now, or undefined when it can. */
  gate?: () => string | undefined;
  reads: readonly SmokeRead[];
}

/**
 * A "the service hung" ceiling, not a performance target: performance is measured by the FULL profile,
 * and a response-time finding is never filed (validity gate). 10 s is far above every probe (max 3.5 s).
 */
export const SMOKE_MAX_MS = 10_000;

export const API_SMOKE: readonly SmokeModule[] = [
  {
    name: 'Platform',
    tag: TAGS.platform,
    reads: [{ endpoint: 'common-ms-status', proves: 'the KPost API is up', plainText: 'SUCCESS' }],
  },
  {
    name: 'Signup & Login',
    tag: TAGS.auth,
    reads: [
      {
        endpoint: 'signup-login-active-session',
        proves: 'a login issues a working session for our account',
        fields: { data: 'array' },
        ownerField: 'data.0.kpostID',
      },
      {
        endpoint: 'signup-login-login-history',
        proves: 'the login history is recorded and readable',
        fields: { data: 'array' },
      },
    ],
  },
  {
    name: 'Katchup',
    tag: TAGS.katchup,
    reads: [
      {
        endpoint: 'katchup-unopened-count',
        proves: 'the unread-message count is served',
        fields: { msgsCount: 'number', resultList: 'array' },
      },
      {
        endpoint: 'katchup-frequent-contacts',
        proves: 'the frequent chat contacts are served',
        fields: { data: 'array' },
      },
      {
        endpoint: 'katchup-message-count',
        proves: 'the message store answers a conversation count',
        fields: { messageCount: 'number' },
      },
    ],
  },
  {
    name: 'Kall',
    tag: TAGS.kall,
    reads: [
      {
        endpoint: 'kall-dashboard',
        proves: 'the call history is served',
        fields: { kall: 'array' },
      },
      {
        endpoint: 'kall-today-kool',
        proves: "today's scheduled Kool Kalls are served",
        fields: { data: 'array' },
      },
      {
        endpoint: 'kall-frequent-contacts',
        proves: 'the frequent call contacts are served',
        fields: { data: 'array' },
      },
    ],
  },
  {
    name: 'KMail',
    tag: TAGS.kmail,
    // Same gate as every KMail spec: while the KMail host refuses valid tokens, every read would only
    // re-report that one root cause (src/fixtures/kmail-auth-gate.ts).
    gate: kmailAuthGate,
    reads: [
      {
        endpoint: 'kmail-status-total-count',
        proves: 'the KMail service is up and counts our mail',
        fields: { REPLY_NOT_RECEIVED: 'number', SENT_MAILS_NOT_OPENED: 'number' },
      },
      {
        endpoint: 'kmail-unopened-count',
        proves: 'the unread-mail count is served',
        fields: { SenderWithCount: 'array' },
      },
      {
        endpoint: 'kmail-saluations',
        proves: 'the compose salutation list is served',
        fields: { data: 'array', 'data.0.saluation': 'string' },
      },
    ],
  },
  {
    name: 'Contacts',
    tag: TAGS.contacts,
    reads: [
      {
        endpoint: 'contacts-my-contacts',
        proves: 'the contact list is served',
        fields: { contacts_added: 'array' },
      },
      {
        endpoint: 'contacts-blocked',
        proves: 'the blocked-contacts list is served',
        fields: { data: 'array' },
      },
    ],
  },
  {
    name: 'Group',
    tag: TAGS.group,
    reads: [
      {
        endpoint: 'contacts-my-groups',
        proves: 'the groups the user belongs to are served',
        fields: { group_added: 'array' },
      },
    ],
  },
  {
    name: 'Profile',
    tag: TAGS.profile,
    reads: [
      {
        endpoint: 'profile-fetch-user-details',
        proves: "the signed-in user's own profile is served",
        fields: { data: 'object', 'data.firstName': 'string' },
        ownerField: 'data.kpostID',
      },
      {
        endpoint: 'profile-get-languages',
        proves: 'the profile language list is served',
        fields: { data: 'array' },
      },
    ],
  },
  {
    name: 'Settings',
    tag: TAGS.settings,
    reads: [
      {
        endpoint: 'settings-get-personalize',
        proves: 'the personalisation settings (theme, font) are served',
        fields: { data: 'object', 'data.changeTheme': 'object' },
      },
      {
        endpoint: 'settings-get-notifications',
        proves: 'the notification settings are served',
        fields: { data: 'object' },
      },
    ],
  },
  {
    name: 'Home',
    tag: TAGS.home,
    reads: [
      {
        endpoint: 'dashboard-home-msgs',
        proves: 'the Home dashboard feed is served',
        fields: { kall: 'array', kmail: 'array' },
        // The heaviest read (3.5 s on 2026-10-22): it aggregates every module's latest items.
        maxMs: 20_000,
      },
    ],
  },
  {
    name: 'Verticals (KDiary, KBooking)',
    tag: TAGS.verticals,
    reads: [
      {
        endpoint: 'kdiary-today-schedules',
        proves: "KDiary serves today's schedule",
        fields: { schedule: 'array' },
      },
      {
        endpoint: 'kdiary-get-events',
        proves: 'KDiary serves the saved events',
        fields: { data: 'array' },
      },
      {
        endpoint: 'kbooking-city-suggestion',
        proves: 'KBooking (bus booking) answers a city search',
        fields: { value: 'array', 'value.0.cityName': 'string' },
      },
    ],
  },
  {
    name: 'User Management (business)',
    tag: TAGS.userManagement,
    reads: [
      {
        endpoint: 'admin-user-management-details',
        proves: "the business admin's member summary is served",
        fields: { memberCountDetails: 'object', 'memberCountDetails.totalMembersCount': 'number' },
      },
      {
        endpoint: 'admin-bank-and-company-details',
        proves: "the business admin's company details are served",
        fields: { 'data.companyDetails': 'array' },
      },
    ],
  },
];

/**
 * ADMIN API SMOKE (Admin / HR-Setup on the Admin test box, as the BUSINESS_M company admin): one read
 * per Admin area. Runs in the runner's own Admin stage, never inside the KPost smoke. The rows assert the
 * envelope only: on 2026-10-22, the day they were added, the box refused every logged-in request (401
 * after 30 s), so no answer body could be probed. Add `fields` once it answers again.
 */
export const ADMIN_API_SMOKE: readonly SmokeModule[] = [
  {
    name: 'Admin / HR-Setup',
    tag: TAGS.admin,
    gate: () =>
      env.ADMIN_API_BASE_URL ? undefined : 'needs ADMIN_API_BASE_URL (the Admin test box)',
    reads: [
      { endpoint: 'admin-workplace-location-all', proves: 'Work Place: the locations are served' },
      {
        endpoint: 'admin-hr-tier-attribute-by-company',
        proves: 'HR Setup: the HR tier attributes are served',
      },
      {
        endpoint: 'admin-role-posting-by-company',
        proves: 'Role Posting: the company role postings are served',
      },
      { endpoint: 'admin-employee-details', proves: 'Employee: the employee data is served' },
    ],
  },
];
