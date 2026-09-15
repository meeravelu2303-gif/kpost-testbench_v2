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
    /**
     * Where a PLATFORM-WIDE (systemic) defect is filed — a shared gateway/auth-filter fault that is
     * not specific to any one module (missing security headers, the auth filter answering 400/403
     * instead of 401). These are all security/auth concerns, so on KPost API they go to the real
     * `Authentication V2` component rather than the generic catch-all. Must exist in the product;
     * defaults to `fallbackComponent` when unset.
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
 * KMail routes by functional **area**, not by module: every KMail endpoint is tagged
 * `['kmail-api', 'kmail', 'kmail-<area>', '<sub-area>?', …]`, so the module tag is generic and the
 * component comes from the area / sub-area tags. Two tiers:
 *
 * - **`kmail-<area>`** — the per-file default (read / send / draft / manage / settings), used when an
 *   endpoint carries no finer tag.
 * - **bare sub-area tags** — a specific endpoint's component (`contacts`, `status`, `content`, …);
 *   these WIN over the area default (see `componentFor`'s kmail-api branch).
 *
 * `external` is deliberately unmapped: it means other-domain *mails* on one endpoint and other-domain
 * *contacts* on another, so it falls back to the endpoint's area rather than being mis-filed.
 * Targets are the exact live component names of the KMail API product (read 2026-09-14).
 */
const KMAIL_COMPONENT_BY_TAG: Record<string, string> = {
  // Area defaults (the per-file tag).
  'kmail-read': 'Read Mail & Attachments',
  'kmail-send': 'Sent Mail - Compose & Send',
  'kmail-draft': 'Draft Mail',
  'kmail-manage': 'Mailbox, Folders & Follow-up',
  'kmail-settings': 'KMail Settings - Signature & Letterhead',
  // Sub-area tags — a specific endpoint's component, overriding its area default.
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
      // Platform-wide auth/security defects (missing headers, wrong auth status codes) → the real
      // security component, never the generic catch-all.
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
/**
 * Generic suite-level tags every factory prepends (the suite id, plus KMail's `kmail`). They are
 * NOT module tags, so component routing skips them when it looks for the module a defect belongs to.
 */
const SUITE_LEVEL_TAGS = new Set<string>(['kpost-api', 'admin-api', 'kmail-api', 'kmail']);

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
    /*
     * KMail routes by functional AREA, not by module: tags[0] is the generic `kmail-api`, so the
     * component comes from the area / sub-area tags. A bare sub-area tag (`contacts`, `status`,
     * `content`, `draft`, …) names the component and WINS over the per-file `kmail-<area>` default;
     * with neither, the module catch-all. (`kmail` itself is bare-but-unmapped, so it is skipped.)
     */
    const subArea = firstMapped(tags.filter((tag) => !tag.startsWith('kmail-')));
    const area = firstMapped(tags.filter((tag) => tag.startsWith('kmail-')));
    return subArea ?? area ?? directKnown() ?? suite.bugzilla.fallbackComponent;
  }

  if (suite.kind === 'api') {
    /*
     * KPost / Admin: after the generic suite tag every factory writes the MODULE tag first
     * (`['kpost-api', '<module>', '<module>-<area>', ...]`), and it is authoritative. A bare sub-tag
     * that happens to be ANOTHER module's name must not steal it — a Kall endpoint tagged
     * `[..., kall, kall-read, contacts]` belongs to Kall, not to Contacts. So the module tag sets the
     * component, and only a *hyphenated* refinement (`common-company` refines `common`,
     * `business-tier` refines the enterprise login) may override it.
     */
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

  return directKnown() ?? suite.bugzilla.fallbackComponent;
}

/**
 * Components that exist in each product, as read from the live instance on 2026-09-12.
 * Only used to recognise a tag that is already a component name; the filer still validates
 * every component against Bugzilla before filing, so a stale entry here cannot lose a ticket.
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
};
