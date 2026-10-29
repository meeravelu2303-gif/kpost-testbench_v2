import path from 'node:path';
import { OPENAPI_DIR } from './constants';
import { env } from './env';

/**
 * The routing table: each suite's base URL, Bugzilla product, components and owning developer.
 * Single source of truth; a framework test fails when it drifts from live Bugzilla.
 */

export const SUITE_IDS = [
  'kpost-api',
  'admin-api',
  'kmail-api',
  'kpost-ui',
  'admin-ui',
  'kpost-mobile',
] as const;
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
    /**
     * Component for platform-wide (systemic) gateway/auth faults; defaults to `fallbackComponent`.
     */
    systemicComponent?: string;
    /** Swagger tag (or UI screen) → Bugzilla component, when the names differ. */
    componentByTag: Record<string, string>;
  };
  /** Base URL of the module under test. */
  baseUrl: string;
  /** OpenAPI document describing the module, when one exists. */
  specFile?: string;
}

/** KPost API module tags → existing Bugzilla components. Keys are lower-cased. */
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
  // Feature modules.
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
 * KMail routes by area: `kmail-<area>` is the per-file default and a bare sub-area tag wins over
 * it. `external` is unmapped on purpose (it means different things on different endpoints).
 */
const KMAIL_COMPONENT_BY_TAG: Record<string, string> = {
  // Area defaults (the per-file tag).
  'kmail-read': 'Read Mail & Attachments',
  'kmail-send': 'Sent Mail - Compose & Send',
  'kmail-draft': 'Draft Mail',
  'kmail-manage': 'Mailbox, Folders & Follow-up',
  'kmail-settings': 'KMail Settings - Signature & Letterhead',
  // Sub-area tags, which override the area default.
  content: 'Read Mail & Attachments',
  attachment: 'Read Mail & Attachments',
  'read-receipt': 'Read Mail & Attachments',
  thread: 'Read Mail & Attachments',
  subject: 'Read Mail & Attachments',
  status: 'Mailbox, Folders & Follow-up',
  important: 'Mailbox, Folders & Follow-up',
  dashboard: 'Mailbox, Folders & Follow-up',
  badge: 'Mailbox, Folders & Follow-up',
  contacts: 'Contacts & Sync',
  draft: 'Draft Mail',
  settings: 'KMail Settings - Signature & Letterhead',
  bulk: 'Sent Mail - Compose & Send',
  translate: 'Translation',
};

/** Admin resource slug tags → components of the `KPost Admin` product. */
const ADMIN_COMPONENT_BY_TAG: Record<string, string> = {
  'workplace-tier-attribute': 'Workplace Tier — Attributes (Levels)',
  'workplace-tier-variable': 'Workplace Tier — Variables (Nodes)',
  'workplace-location': 'Workplace Locations',
  'workplace-hierarchy': 'Workplace Hierarchy Links',
  'hr-tier-attribute': 'HR Set-Up Tier — Levels',
  'hr-tier-variable': 'HR Set-Up Tier — Variables (Nodes)',
  'role-posting': 'Role Postings',
  employee: 'Employee Master Data',
  'country-address': 'Country & Address Reference Data',
};

/**
 * Admin/HR-Setup SPA screens → KPost Admin UI components (User Management, or the General
 * catch-all).
 */
const ADMIN_UI_COMPONENT_BY_SCREEN: Record<string, string> = {
  employee: 'User Management',
  'employee-data': 'User Management',
  'employee-management': 'User Management',
  usermanagement: 'User Management',
  'user-management': 'User Management',
};

/** UI screens → components of the KPost UI product. */
const UI_COMPONENT_BY_SCREEN: Record<string, string> = {
  login: 'Auth',
  signup: 'Auth',
  auth: 'Auth',
  home: 'Home',
  dashboard: 'Home',
  katchup: 'Katchup',
  contacts: 'Contacts',
  group: 'Groups',
  groups: 'Groups',
  kall: 'Kall',
  kmail: 'KMail',
  writemail: 'WriteMail',
  userprofile: 'User Profile',
  profile: 'User Profile',
  settings: 'Settings',
  kdiary: 'KDiary',
  kdoc: 'KDoc',
  kcloud: 'KCloud',
  kbooking: 'KBooking',
  usermanagement: 'User Management',
  kdirectory: 'KDirectory',
  'e-commerce': 'KEcommerce',
  ecommerce: 'KEcommerce',
  knews: 'KNews',
  kpay: 'KPay',
  a11y: 'Accessibility',
  accessibility: 'Accessibility',
  // Platform surfaces with no component of their own.
  kposter: 'General',
  'not-found': 'General',
  'child-safety-policy': 'General',
  'kall-window': 'Kall',
};

/**
 * Phone (Patrol) test areas → components of the `Kpost Mobile Application` product, every one
 * assigned to Manohar (components created 2026-10-29). Keys are the test file's area.
 */
const MOBILE_COMPONENT_BY_SCREEN: Record<string, string> = {
  login: 'Auth',
  signup: 'Auth',
  auth: 'Auth',
  'access-code': 'Auth',
  katchup: 'Katchup',
  kall: 'Kall',
  kmail: 'KMail',
  contacts: 'Contacts',
  group: 'Group',
  groups: 'Group',
  profile: 'Profile',
  settings: 'Settings',
  kdiary: 'KDiary',
  kbooking: 'KBooking',
  notifications: 'Notifications & Calls',
  'incoming-call': 'Notifications & Calls',
  push: 'Notifications & Calls',
  security: 'Security',
  home: 'General',
  general: 'General',
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
      systemicComponent: 'Authentication V2',
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
    owner: { name: 'Karan S', email: 'karans@kpost.in' },
    bugzilla: {
      product: 'KPost Admin',
      version: 'unspecified',
      fallbackComponent: 'admin-module-application',
      componentByTag: ADMIN_COMPONENT_BY_TAG,
    },
    baseUrl: env.ADMIN_API_BASE_URL ?? env.API_BASE_URL,
    // The Admin contract is generated from the live api-docs (`npm run contract:admin`).
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
      systemicComponent: 'Authentication & Gateway',
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
  'admin-ui': {
    id: 'admin-ui',
    label: 'KPost Admin/HR-Setup front end',
    kind: 'ui',
    repository: 'Admin_Module frontend (separate SPA)',
    owner: { name: 'Ayyappan Ashok', email: 'ayyappan@kpostindia.com' },
    bugzilla: {
      product: 'KPost Admin UI',
      version: 'unspecified',
      fallbackComponent: 'General',
      componentByTag: ADMIN_UI_COMPONENT_BY_SCREEN,
    },
    // The fallback is only for type completeness; the Admin UI command needs ADMIN_UI_BASE_URL.
    baseUrl: env.ADMIN_UI_BASE_URL ?? env.BASE_URL,
  },
  'kpost-mobile': {
    id: 'kpost-mobile',
    label: 'KPost Flutter app (Android; iOS later)',
    kind: 'ui',
    repository: 'kpost5_flutter, branch Test_ENV',
    owner: { name: 'Manohar', email: 'manohar@kpost.in' },
    bugzilla: {
      product: 'Kpost Mobile Application',
      version: '1.0',
      fallbackComponent: 'General',
      componentByTag: MOBILE_COMPONENT_BY_SCREEN,
    },
    // The app has no URL of its own; the bench's app copy calls the KPost API.
    baseUrl: env.KPOST_API_BASE_URL ?? env.API_BASE_URL,
  },
};

export const DEFAULT_SUITE: SuiteId = 'kpost-api';

export function suiteFor(id: SuiteId = DEFAULT_SUITE): SuiteOwnership {
  return SUITES[id];
}

export function apiSuites(): SuiteOwnership[] {
  return Object.values(SUITES).filter((suite) => suite.kind === 'api');
}

/** Generic suite-level tags every factory prepends; component routing skips them. */
const SUITE_LEVEL_TAGS = new Set<string>(['kpost-api', 'admin-api', 'kmail-api', 'kmail']);

/** The Bugzilla component for a defect, from the endpoint's tags (or a UI screen name). */
export function componentFor(suite: SuiteOwnership, tags: readonly string[]): string {
  const lookup = (tag: string): string | undefined =>
    suite.bugzilla.componentByTag[tag] ?? suite.bugzilla.componentByTag[tag.toLowerCase()];
  const firstMapped = (list: readonly string[]): string | undefined => {
    for (const tag of list) {
      const component = lookup(tag);
      if (component) return component;
    }
    return undefined;
  };
  // A tag that is already a component name (KPost API, Admin and the ownership tests use this).
  const known = KNOWN_COMPONENTS[suite.id];
  const directKnown = (): string | undefined => tags.find((tag) => known?.has(tag));

  if (suite.id === 'kmail-api') {
    // A bare sub-area tag wins over the per-file `kmail-<area>` default.
    const subArea = firstMapped(tags.filter((tag) => !tag.startsWith('kmail-')));
    const area = firstMapped(tags.filter((tag) => tag.startsWith('kmail-')));
    return subArea ?? area ?? directKnown() ?? suite.bugzilla.fallbackComponent;
  }

  if (suite.kind === 'api') {
    // The first non-suite tag is the module and sets the component; only a hyphenated refinement
    // (`common-company`) may override it, so a bare tag naming another module cannot steal it.
    const routing = tags.filter((tag) => !SUITE_LEVEL_TAGS.has(tag));
    const moduleTag = routing[0];
    const moduleComponent = moduleTag ? lookup(moduleTag) : undefined;
    const refinement = routing
      .filter((tag) => tag.includes('-'))
      .map((tag) => ({ tag, component: lookup(tag) }))
      .filter((entry): entry is { tag: string; component: string } => Boolean(entry.component))
      .sort((a, b) => b.tag.length - a.tag.length)[0]?.component;
    if (refinement) return refinement;
    if (moduleComponent) return moduleComponent;
  } else {
    // UI tags are unordered screen tokens, so the longest matching key wins.
    const match = tags
      .map((tag) => ({ tag, component: lookup(tag) }))
      .filter((entry): entry is { tag: string; component: string } => Boolean(entry.component))
      .sort((a, b) => b.tag.length - a.tag.length)[0];
    if (match) return match.component;
  }

  return directKnown() ?? suite.bugzilla.fallbackComponent;
}

/**
 * Components that exist in each product, to recognise a tag that already is one (the filer
 * re-validates live).
 */
export const KNOWN_COMPONENTS: Partial<Record<SuiteId, Set<string>>> = {
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
    'Authentication & Gateway',
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
    'Contacts',
    'General',
    'Groups',
    'Home',
    'Kall',
    'Katchup',
    'KBooking',
    'KCloud',
    'KDiary',
    'KDirectory',
    'KDoc',
    'KEcommerce',
    'KMail',
    'KNews',
    'KPay',
    'Settings',
    'User Management',
    'User Profile',
    'WriteMail',
  ]),
  'admin-ui': new Set(['General', 'User Management']),
  'kpost-mobile': new Set(Object.values(MOBILE_COMPONENT_BY_SCREEN)),
};
