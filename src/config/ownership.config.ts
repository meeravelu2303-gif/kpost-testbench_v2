import path from 'node:path';
import { OPENAPI_DIR } from './constants';
import { env } from './env';

/**
 * THE routing table for the whole KPost platform: which module a test belongs to, where its
 * defects are filed, and **which developer owns them**.
 *
 * KPost is one product built from separately maintained modules, so a defect is only useful
 * when it reaches the person who maintains that module:
 *
 * | Suite       | Module                    | Bugzilla product | Owner              |
 * | ----------- | ------------------------- | ---------------- | ------------------ |
 * | kpost-api   | KPost core API            | KPost API        | Jaganathan Murthy  |
 * | admin-api   | Admin module (own repo)   | KPost Admin      | Jaganathan Murthy  |
 * | kmail-api   | KMail module (own repo)   | KMail API        | Jitendra Kumar     |
 * | kpost-ui    | KPost React front end     | KPost UI         | Ayyappan Ashok     |
 *
 * This file is the single source of truth. Endpoint definitions declare a `suite`, and
 * everything else — base URL, product, component, assignee — follows from here. A test in
 * tests/framework checks these owners still match the live Bugzilla component defaults, so
 * drift on either side is caught instead of silently misrouting tickets.
 */

export const SUITE_IDS = ['kpost-api', 'admin-api', 'kmail-api', 'kpost-ui'] as const;
export type SuiteId = (typeof SUITE_IDS)[number];

export interface SuiteOwnership {
  id: SuiteId;
  label: string;
  kind: 'api' | 'ui';
  /** Where the module's source lives — named so a ticket can say who maintains it. */
  repository: string;
  owner: { name: string; email: string };
  bugzilla: {
    product: string;
    version: string;
    /** Used when a tag/screen maps to no component; must itself exist in the product. */
    fallbackComponent: string;
    /** Swagger tag (or UI screen) → Bugzilla component, when the names differ. */
    componentByTag: Record<string, string>;
  };
  /** Base URL of the module under test. */
  baseUrl: string;
  /** OpenAPI document describing the module, when one exists. */
  specFile?: string;
}

/**
 * KPost API: the module tags the bench puts on its endpoints, mapped to the Bugzilla components
 * that already exist in this instance (27 of them, read live on 2026-09-12).
 *
 * Without this map every finding landed on `kpost-webservice-application`, the catch-all — and the
 * tickets the previous bench filed (bugs 95-101) are on precise components like
 * `KPresentation` and `User Profile V2`. A whole module's defects arriving on one generic
 * component is how a queue becomes unreadable, and it loses the per-component default assignee that
 * Bugzilla would otherwise apply.
 *
 * Keys are lower-cased; `componentFor` looks up both the tag and its lower-case form.
 */
const KPOST_COMPONENT_BY_TAG: Record<string, string> = {
  // Signup & Login (FR-S01..S12)
  'signup-login': 'Authentication V2',
  login: 'Authentication V2',
  signup: 'Authentication V2',
  session: 'Authentication V2',
  'token-refresh': 'Authentication V2',
  'account-security': 'Authentication V2',
  // The medium/large enterprise login is its own component in this Bugzilla.
  'business-tier': 'Authentication - Medium & Large Enterprise',
  // OTP and password recovery are authentication concerns, not generic utilities.
  'common-otp': 'Authentication V2',
  // Reference data, existence checks and platform utilities.
  'common-reference': 'Common Reference Data & Utilities V2',
  'common-identity': 'Common Reference Data & Utilities V2',
  'common-platform': 'Common Reference Data & Utilities V2',
  common: 'Common Reference Data & Utilities V2',
  // Company records, the logo and business registration.
  'common-company': 'Company Administration',
  company: 'Company Administration',
  // The feature modules built since — each maps its module tag to the component that already
  // exists in this Bugzilla (see KNOWN_COMPONENTS). Without these every one of their defects
  // landed on the `kpost-webservice-application` catch-all.
  katchup: 'Katchup Messaging V2',
  kall: 'Kall (Voice/Video) V2 - current',
  contacts: 'Contacts Directory V2',
  dashboard: 'Dashboard V2',
  group: 'Groups V2',
  profile: 'User Profile V2',
  settings: 'General Settings',
  kdiary: 'Kdiary - Schedules, Events & Reports',
  aws: 'Integration - AWS S3 Pre-signed URLs',
  kos: 'KWord Documents',
  kword: 'KWord Documents',
  ai: 'Integration - AI Assistant',
};

/**
 * KMail's Swagger tags and its Bugzilla components were named separately, so they need an
 * explicit map. KPost API and Admin components were created FROM their Swagger tags, so their
 * names already match and only the exceptions are listed.
 */
const KMAIL_COMPONENT_BY_TAG: Record<string, string> = {
  'Sent Mail': 'Sent Mail - Compose & Send',
  'Sent Mail (Legacy Path)': 'Sent Mail - Compose & Send',
  'Mailbox & Contacts': 'Mailbox, Folders & Follow-up',
  'KMail Settings': 'KMail Settings - Signature & Letterhead',
  Contacts: 'Contacts & Sync',
};

/** UI screens → components of the KPost UI product. */
const UI_COMPONENT_BY_SCREEN: Record<string, string> = {
  login: 'Auth',
  signup: 'Auth',
  auth: 'Auth',
  home: 'Home',
  kmail: 'KMail',
  writemail: 'WriteMail',
  katchup: 'Katchup',
  kdirectory: 'KDirectory',
  'e-commerce': 'KEcommerce',
  ecommerce: 'KEcommerce',
  knews: 'KNews',
  kpay: 'KPay',
  settings: 'Settings',
  userprofile: 'Settings',
  a11y: 'Accessibility',
  accessibility: 'Accessibility',
};

export const SUITES: Record<SuiteId, SuiteOwnership> = {
  'kpost-api': {
    id: 'kpost-api',
    label: 'KPost core API',
    kind: 'api',
    repository: 'KPOST webservice',
    owner: { name: 'Jaganathan Murthy', email: 'jagan@kpost.in' },
    bugzilla: {
      product: 'KPost API',
      version: 'unspecified',
      fallbackComponent: 'kpost-webservice-application',
      componentByTag: KPOST_COMPONENT_BY_TAG,
    },
    baseUrl: env.KPOST_API_BASE_URL ?? env.API_BASE_URL,
    specFile: path.join(OPENAPI_DIR, 'kpost-api.openapi.json'),
  },
  'admin-api': {
    id: 'admin-api',
    label: 'KPost Admin module API',
    kind: 'api',
    repository: 'admin-module (separate repo)',
    owner: { name: 'Jaganathan Murthy', email: 'jagan@kpost.in' },
    bugzilla: {
      product: 'KPost Admin',
      version: 'unspecified',
      fallbackComponent: 'admin-module-application',
      componentByTag: {},
    },
    baseUrl: env.ADMIN_API_BASE_URL ?? env.API_BASE_URL,
    // No spec: the Admin module is absent from the KPost API workbook, and its swagger file
    // was removed as unreliable. Endpoints are hand-written until a contract exists.
    specFile: undefined,
  },
  'kmail-api': {
    id: 'kmail-api',
    label: 'KMail module API',
    kind: 'api',
    repository: 'kmail (separate repo)',
    owner: { name: 'Jitendra Kumar', email: 'jitendra@kpost.in' },
    bugzilla: {
      product: 'KMail API',
      version: '5.0',
      fallbackComponent: 'kmail-application',
      componentByTag: KMAIL_COMPONENT_BY_TAG,
    },
    baseUrl: env.KMAIL_API_BASE_URL ?? env.API_BASE_URL,
    specFile: path.join(OPENAPI_DIR, 'kmail-api.openapi.json'),
  },
  'kpost-ui': {
    id: 'kpost-ui',
    label: 'KPost React front end',
    kind: 'ui',
    repository: 'KPOST_REACTJS_2023_V1',
    owner: { name: 'Ayyappan Ashok', email: 'ayyappan@kpostindia.com' },
    bugzilla: {
      product: 'KPost UI',
      version: 'unspecified',
      fallbackComponent: 'General',
      componentByTag: UI_COMPONENT_BY_SCREEN,
    },
    baseUrl: env.BASE_URL,
  },
};

export const DEFAULT_SUITE: SuiteId = 'kpost-api';

export function suiteFor(id: SuiteId = DEFAULT_SUITE): SuiteOwnership {
  return SUITES[id];
}

export function apiSuites(): SuiteOwnership[] {
  return Object.values(SUITES).filter((suite) => suite.kind === 'api');
}

/**
 * The Bugzilla component for a defect, from the endpoint's tags (or a UI screen name).
 * Tags usually ARE the component name; the map covers the modules where they differ.
 */
export function componentFor(suite: SuiteOwnership, tags: readonly string[]): string {
  const lookup = (tag: string): string | undefined =>
    suite.bugzilla.componentByTag[tag] ?? suite.bugzilla.componentByTag[tag.toLowerCase()];

  if (suite.kind === 'api') {
    /*
     * For an API endpoint the FIRST tag is always the module tag (every factory writes
     * `['<module>', ...rest]`), and it is authoritative. A shorter sub-tag that happens to be
     * ANOTHER module's name must not steal it — a Kall endpoint tagged `[kall, read, contacts]`
     * belongs to Kall, not to Contacts. So the module tag sets the component, and only a
     * *hyphenated* refinement (`common-company` refines `common`, `business-tier` refines the
     * enterprise login) may override it. Bare foreign module names are never refinements.
     */
    const moduleComponent = tags[0] ? lookup(tags[0]) : undefined;
    const refinement = tags
      .filter((tag) => tag.includes('-'))
      .map((tag) => ({ tag, component: lookup(tag) }))
      .filter((entry): entry is { tag: string; component: string } => Boolean(entry.component))
      .sort((a, b) => b.tag.length - a.tag.length)[0]?.component;
    if (refinement) return refinement;
    if (moduleComponent) return moduleComponent;
  } else {
    /*
     * UI "tags" are unordered screen tokens (from the spec path + title), so there is no module
     * tag to anchor on — the most specific (longest) matching key wins.
     */
    const match = tags
      .map((tag) => ({ tag, component: lookup(tag) }))
      .filter((entry): entry is { tag: string; component: string } => Boolean(entry.component))
      .sort((a, b) => b.tag.length - a.tag.length)[0];
    if (match) return match.component;
  }

  // A tag that is already a component name (KPost API and Admin were built that way).
  const known = KNOWN_COMPONENTS[suite.id];
  const direct = tags.find((tag) => known?.has(tag));
  return direct ?? suite.bugzilla.fallbackComponent;
}

/**
 * Components that exist in each product, as read from the live instance on 2026-09-12.
 * Only used to recognise a tag that is already a component name; the filer still validates
 * every component against Bugzilla before filing, so a stale entry here cannot lose a ticket.
 */
const KNOWN_COMPONENTS: Partial<Record<SuiteId, Set<string>>> = {
  'kpost-api': new Set([
    'Authentication - Medium & Large Enterprise',
    'Authentication V2',
    'Common Reference Data & Utilities V2',
    'Company Administration',
    'Contacts Directory V2',
    'Crypto - Payload Encryption Key',
    'Dashboard V2',
    'Firebase Diagnostics',
    'General Settings',
    'Groups V2',
    'Integration - AI Assistant',
    'Integration - AWS S3 Pre-signed URLs',
    'Integration - E-commerce Catalogue',
    'Integration - MetaDee AI',
    'Integration - RazorPay Payments',
    'Integration - RedBus Bus Booking',
    'Integration - TA Wallet Callback',
    'Integration - Voice / Speech-to-Text',
    'Kall (Voice/Video) V2 - current',
    'Katchup Messaging V2',
    'Kdiary - Schedules, Events & Reports',
    'Knews',
    'kpost-webservice-application',
    'KPresentation',
    'KWord Documents',
    'TA Wallet Payments',
    'User Profile V2',
  ]),
  'admin-api': new Set([
    'Admin Details',
    'admin-module-application',
    'Country & Address Reference Data',
    'Departments',
    'Designations',
    'Employee ↔ Role Posting Mapping',
    'Employee Master Data',
    'Generic Attributes (Base Hierarchy Levels)',
    'Generic Variables (Base Hierarchy Nodes)',
    'Holiday Calendar',
    'HR Set-Up Tier — Levels',
    'HR Set-Up Tier — Variables (Nodes)',
    'HR Tier — Levels',
    'HR Tier — Variables (Nodes)',
    'Product ↔ Employee Licensing',
    'Product Catalogue',
    'Product Demo Requests',
    'Product Subscriptions',
    'Project Catalogue',
    'Role Postings',
    'Users, Onboarding & Authentication',
    'Workplace Hierarchy Links',
    'Workplace Locations',
    'Workplace Tier — Attributes (Levels)',
    'Workplace Tier — Variables (Nodes)',
  ]),
  'kmail-api': new Set([
    'Contacts & Sync',
    'Draft Mail',
    'KMail Settings - Signature & Letterhead',
    'kmail-application',
    'Mailbox, Folders & Follow-up',
    'Read Mail & Attachments',
    'Sent Mail - Compose & Send',
    'Storage Quota',
    'Translation',
  ]),
  'kpost-ui': new Set([
    'Accessibility',
    'Auth',
    'General',
    'Home',
    'Katchup',
    'KDirectory',
    'KEcommerce',
    'KMail',
    'KNews',
    'KPay',
    'Settings',
    'WriteMail',
  ]),
};
