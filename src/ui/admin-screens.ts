/**
 * The Admin/HR-Setup UI screen registry, the admin analogue of `screens.ts`. No `data-testid`s, so
 * each screen is proven by its `.title-font` heading (or its controls) and its key controls.
 */

export interface AdminControl {
  /** CSS selector for the control. */
  selector: string;
  /** Optional visible-text filter (for tabs / buttons that share a class). */
  hasText?: string;
  /** Human label, used in the assertion message and any finding. */
  label: string;
}

export interface AdminScreenDef {
  /** Route under ADMIN_UI_BASE_URL. */
  route: string;
  /** Human name for the test title. */
  name: string;
  /** The `.title-font` heading text that proves the screen mounted, or `null` to use the controls. */
  title: string | null;
  /** Key controls the screen renders at load — asserted individually. */
  controls: AdminControl[];
}

/** The always-present shell: the fixed sidebar nav and the sticky header. */
export const ADMIN_SHELL: readonly AdminControl[] = [
  { selector: '.sidebar-nav', label: 'sidebar navigation' },
  { selector: '.header.header-sticky', label: 'sticky header' },
];

/** The sidebar nav groups and their child routes (children mount only when the group is expanded). */
export const ADMIN_NAV: readonly { group: string; links: { text: string; route: string }[] }[] = [
  {
    group: 'Admin Setup',
    links: [
      { text: 'Work Place Setup', route: '/workplace-setup' },
      { text: 'Work Place Location Setup', route: '/workplace-location-setup' },
    ],
  },
  {
    group: 'Human Resources',
    links: [
      { text: 'HR Breakdown Setup', route: '/hr-breakdown-setup' },
      { text: 'Role Posting Setup', route: '/role-posting-setup' },
      { text: 'Employee Data', route: '/employee-data' },
      { text: 'Assign Role Posting', route: '/assign-role-posting' },
      { text: 'Employee Management', route: '/employee-management' },
    ],
  },
];

const TAB = '.nav-pills .nav-link';
const ADD_VIEW = '.boderIcon';

export const ADMIN_SCREENS: readonly AdminScreenDef[] = [
  {
    route: '/dashboard',
    name: 'Dashboard',
    title: 'Dashboard',
    controls: [],
  },
  {
    route: '/workplace-setup',
    name: 'Work Place Setup',
    title: 'Work Place Setup',
    controls: [
      { selector: TAB, hasText: 'Tier', label: 'Tier tab' },
      { selector: TAB, hasText: 'Variable', label: 'Variable tab' },
    ],
  },
  {
    route: '/workplace-location-setup',
    name: 'Workplace Location Setup',
    title: 'Workplace Location Setup',
    controls: [{ selector: ADD_VIEW, label: 'Add / View icon control' }],
  },
  {
    route: '/hr-breakdown-setup',
    name: 'HR Breakdown Setup',
    // The heading wrongly reads "Work Place Setup" (a product bug), so the tabs prove the screen.
    title: null,
    controls: [
      { selector: TAB, hasText: 'Tier', label: 'Tier tab' },
      { selector: TAB, hasText: 'Variable', label: 'Variable tab' },
    ],
  },
  {
    route: '/role-posting-setup',
    name: 'Role Posting Setup',
    title: 'Role Posting Setup',
    controls: [{ selector: ADD_VIEW, label: 'Add / View icon control' }],
  },
  {
    route: '/employee-data',
    name: 'Employee Data',
    title: 'Employee Data',
    // The Add/View icons render only for role 1, so the heading alone proves the screen loaded.
    controls: [],
  },
  {
    route: '/assign-role-posting',
    name: 'Assign Role / Posting',
    // Leading space in the source heading; a substring match is used in the spec.
    title: 'Assign Role / Posting',
    controls: [
      { selector: '.subheading', hasText: 'Employee Details', label: 'Employee Details section' },
    ],
  },
  {
    route: '/employee-management',
    name: 'Employee Management',
    title: 'Employee Management',
    controls: [
      { selector: TAB, hasText: 'Promote', label: 'Promote tab' },
      { selector: TAB, hasText: 'Terminate', label: 'Terminate tab' },
    ],
  },
];
