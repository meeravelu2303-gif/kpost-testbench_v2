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
      componentByTag: {},
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
  for (const tag of tags) {
    const mapped =
      suite.bugzilla.componentByTag[tag] ?? suite.bugzilla.componentByTag[tag.toLowerCase()];
    if (mapped) return mapped;
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
