/**
 * THE screen registry — every authenticated KPost screen the deep UI suite drives, with the stable
 * selectors that prove it (a) mounted and (b) rendered its own key controls, not just an empty shell.
 *
 * Selectors come from the front-end source map (`docs/ui-screens.md`, mined from
 * `KPOST_REACTJS_2023_V1`). The app ships almost no `data-testid`s, so these are structural — each
 * one is the element the screen is known to render at load. A UI change that removes one is exactly
 * the kind of regression this suite exists to catch.
 */

export interface ScreenDef {
  /** Route under BASE_URL. */
  route: string;
  /** Human name, used in the test title and any filed bug. */
  name: string;
  /** The Bugzilla-UI component this screen maps to (must match UI_COMPONENT_BY_SCREEN). */
  screen: string;
  /** Any-of selectors that prove the screen mounted (first match wins across engines). */
  ready: string[];
  /** Key controls the screen must render — asserted individually, so a missing one is a finding. */
  controls: Array<{ selector: string; label: string }>;
}

/**
 * The always-present nav rail: each destination icon and the route it must open. The `icon-KP_*`
 * font class encodes the destination, so a test can click the icon and assert the route — exercising
 * the real navigation a user does, not a scripted `goto`.
 */
export const NAV_LINKS: readonly { icon: string; route: string; name: string }[] = [
  { icon: '.icon-KP_01-Home', route: '/home', name: 'Home' },
  { icon: '.icon-KP_03-KMail', route: '/kmail', name: 'KMail' },
  { icon: '.icon-KP_04-Katchup', route: '/katchup', name: 'Katchup' },
  { icon: '.icon-KP_05-Kall', route: '/kall', name: 'Kall' },
  { icon: '.icon-KP_15-Settings', route: '/settings', name: 'Settings' },
];

export const AUTHENTICATED_SCREENS: readonly ScreenDef[] = [
  {
    route: '/home',
    name: 'Home',
    screen: 'home',
    ready: ['.homeWeblasccs', '.icon-KP_01-Home', '.header_font'],
    controls: [{ selector: '.icon-KP_01-Home', label: 'Home nav icon' }],
  },
  {
    route: '/katchup',
    name: 'Katchup',
    screen: 'katchup',
    ready: ['.icon-KP_04-Katchup', '.Katchup_Name'],
    controls: [
      { selector: '.icon-KP_02-Write-Letter', label: 'compose (write-message) entry point' },
      { selector: '[placeholder*="Search" i]', label: 'contact search box' },
    ],
  },
  {
    route: '/kall',
    name: 'Kall',
    screen: 'kall',
    ready: ['.kall-layout-shell', '.icon-KP_05-Kall'],
    controls: [{ selector: '[placeholder*="Search" i]', label: 'contact search box' }],
  },
  {
    route: '/kmail',
    name: 'KMail',
    screen: 'kmail',
    ready: ['.kmail-layout-shell', '.icon-KP_03-KMail'],
    controls: [{ selector: '[placeholder*="Search" i]', label: 'mail search box' }],
  },
  {
    route: '/userprofile',
    name: 'Profile',
    screen: 'userprofile',
    ready: ['.name_font_profile', '.Main-Profile-image'],
    controls: [{ selector: '.name_font_profile', label: 'account holder name' }],
  },
  {
    route: '/settings',
    name: 'Settings',
    screen: 'settings',
    ready: ['.settings-theme-shell'],
    controls: [{ selector: '.settings-theme-shell', label: 'settings workspace' }],
  },
  // --- Secondary + vertical screens: the deep CHECK CATALOGUE (health / performance / layout / a11y)
  // runs on each. They ship generic bootstrap layouts with no distinctive root, so the mount anchor is
  // the authenticated **shell** (nav rail / header) — which proves the route loaded signed-in (not
  // bounced to /login) — plus the screen's own distinctive root where the frontend has one. The value
  // here is the check sweep catching a JS crash, a broken asset, overflow or an a11y gap on any of them.
  {
    route: '/kdiary',
    name: 'KDiary',
    screen: 'kdiary',
    ready: ['.icon-KP_01-Home', '.header-user-name', '.header_font'],
    controls: [
      {
        selector: '.icon-KP_01-Home, .header-user-name, .header_font',
        label: 'authenticated shell',
      },
    ],
  },
  {
    route: '/kdoc',
    name: 'KDoc',
    screen: 'kdoc',
    ready: ['.homeWeblasccs', '.icon-KP_01-Home', '.header_font'],
    controls: [
      { selector: '.homeWeblasccs, .icon-KP_01-Home, .header_font', label: 'KDoc/shell root' },
    ],
  },
  {
    route: '/kcloud',
    name: 'KCloud',
    screen: 'kcloud',
    ready: ['.icon-KP_01-Home', '.header-user-name', '.header_font'],
    controls: [
      {
        selector: '.icon-KP_01-Home, .header-user-name, .header_font',
        label: 'authenticated shell',
      },
    ],
  },
  {
    route: '/kbooking',
    name: 'KBooking',
    screen: 'kbooking',
    ready: ['.icon-KP_01-Home', '.header-user-name', '.header_font'],
    controls: [
      {
        selector: '.icon-KP_01-Home, .header-user-name, .header_font',
        label: 'authenticated shell',
      },
    ],
  },
  {
    route: '/knews',
    name: 'KNews',
    screen: 'knews',
    ready: ['.icon-KP_01-Home', '.header-user-name', '.header_font'],
    controls: [
      {
        selector: '.icon-KP_01-Home, .header-user-name, .header_font',
        label: 'authenticated shell',
      },
    ],
  },
  {
    route: '/e-commerce',
    name: 'ECommerce',
    screen: 'e-commerce',
    ready: ['.icon-KP_01-Home', '.header-user-name', '.header_font'],
    controls: [
      {
        selector: '.icon-KP_01-Home, .header-user-name, .header_font',
        label: 'authenticated shell',
      },
    ],
  },
  {
    route: '/kdirectory',
    name: 'KDirectory',
    screen: 'kdirectory',
    ready: ['.background_colorss', '.icon-KP_01-Home', '.header_font'],
    controls: [
      {
        selector: '.background_colorss, .icon-KP_01-Home, .header_font',
        label: 'KDirectory/shell root',
      },
    ],
  },
];
