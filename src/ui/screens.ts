/**
 * The screen registry: every KPost screen the UI suite drives, with structural selectors (from
 * `docs/ui/ui-screens.md`) proving it mounted and rendered its key controls.
 */

/** The session a screen needs: `personal` (default), `business` (BUSINESS_S) or `public` (none). */
export type ScreenSession = 'personal' | 'business' | 'public';

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
  /** The session the screen needs; omitted = `personal`. */
  session?: ScreenSession;
}

/**
 * The nav rail: each `icon-KP_*` icon and the route it must open, so tests navigate as a user does.
 */
export const NAV_LINKS: readonly { icon: string; route: string; name: string }[] = [
  { icon: '.icon-KP_01-Home', route: '/home', name: 'Home' },
  { icon: '.icon-KP_03-KMail', route: '/kmail', name: 'KMail' },
  { icon: '.icon-KP_04-Katchup', route: '/katchup', name: 'Katchup' },
  { icon: '.icon-KP_05-Kall', route: '/kall', name: 'Kall' },
  { icon: '.icon-KP_15-Settings', route: '/settings', name: 'Settings' },
];

const ALL_AUTHENTICATED_SCREENS: readonly ScreenDef[] = [
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
  // --- Secondary and vertical screens: no distinctive root, so the shell is the mount anchor.
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
  {
    // The KMail workspace with the compose form open; it must mount, not the error boundary.
    route: '/writemail',
    name: 'WriteMail',
    screen: 'writemail',
    ready: ['.kmail-layout-shell', '.icon-KP_03-KMail'],
    controls: [
      { selector: '.kmail-layout-shell', label: 'KMail workspace (compose opens inside)' },
    ],
  },
  {
    // KPoster: a client-side demo feed; also listed under PUBLIC_SCREENS.
    route: '/kposter',
    name: 'KPoster',
    screen: 'kposter',
    ready: ['.kp-app', '.icon-KP_01-Home'],
    controls: [{ selector: '.kp-feed, .kp-main', label: 'poster feed' }],
  },
  {
    // The 404 page is a screen too: it must render its message, pass a11y and layout, and never
    // crash. Anonymous visitors are bounced to /login instead, so this is a signed-in screen.
    route: '/this-route-does-not-exist-kpost-bench',
    name: 'NotFound',
    screen: 'not-found',
    ready: ['.PNF_firstLine'],
    controls: [{ selector: '.PNF_secondLine', label: '"Page not found" message' }],
  },
];

/** Screens that need the BUSINESS_S company-admin session (`screens-business.spec.ts`). */
const ALL_BUSINESS_SCREENS: readonly ScreenDef[] = [
  {
    route: '/usermanagement',
    name: 'UserManagement',
    screen: 'usermanagement',
    session: 'business',
    ready: ['.channelslist', '.user-body'],
    controls: [
      { selector: '.user-button', label: '"Add New Channels" button' },
      { selector: '[placeholder*="Search members" i]', label: 'member search box' },
    ],
  },
];

/**
 * Screens an anonymous visitor can open; a bounce to `/login` is a failure. Parameterised public
 * routes (`/digital-card/:id`, …) need a real id and have their own specs.
 */
const ALL_PUBLIC_SCREENS: readonly ScreenDef[] = [
  {
    route: '/login',
    name: 'Login',
    screen: 'login',
    session: 'public',
    ready: ['.login__wrapper'],
    controls: [
      { selector: '[placeholder*="KPOST ID" i]', label: 'KPOST ID / mobile field' },
      { selector: 'button:has-text("Submit")', label: 'Submit button' },
    ],
  },
  {
    route: '/signup',
    name: 'Signup',
    screen: 'signup',
    session: 'public',
    ready: ['.signup-v2', '.Select_account'],
    controls: [{ selector: '.Select_account', label: 'account-type chooser' }],
  },
  {
    route: '/child-safety-standards-policy',
    name: 'ChildSafetyPolicy',
    screen: 'child-safety-policy',
    session: 'public',
    ready: ['h1:has-text("Child Safety Standards Policy")', '.section'],
    controls: [{ selector: '.section', label: 'policy sections' }],
  },
  {
    // Signed out it must show its own "Unauthorized — sign in to KPost to use Kall" state screen.
    route: '/kall-window',
    name: 'KallWindow',
    screen: 'kall-window',
    session: 'public',
    ready: ['.kw-root'],
    controls: [{ selector: '.kw-state-screen', label: 'Kall window state screen' }],
  },
  {
    route: '/kposter',
    name: 'KPosterPublic',
    screen: 'kposter',
    session: 'public',
    ready: ['.kp-app'],
    controls: [{ selector: '[placeholder*="Find a poster" i]', label: 'poster search box' }],
  },
];

/** Screens paused from all testing (KDoc); every UI sweep reads this. Empty it to resume. */
const PAUSED_SCREENS: ReadonlySet<string> = new Set(['kdoc']);

const notPaused = (screen: ScreenDef): boolean => !PAUSED_SCREENS.has(screen.screen);

/** PERSONAL-session screens — what the sweep batches, axe, crawl, visual and interaction specs drive. */
export const AUTHENTICATED_SCREENS: readonly ScreenDef[] =
  ALL_AUTHENTICATED_SCREENS.filter(notPaused);
/** BUSINESS_S-session screens — `screens-business.spec.ts`. */
export const BUSINESS_SCREENS: readonly ScreenDef[] = ALL_BUSINESS_SCREENS.filter(notPaused);
/** No-session screens — `screens-public.spec.ts`. */
export const PUBLIC_SCREENS: readonly ScreenDef[] = ALL_PUBLIC_SCREENS.filter(notPaused);
/** Every screen the bench knows, for the coverage ledger. */
export const ALL_SCREENS: readonly ScreenDef[] = [
  ...AUTHENTICATED_SCREENS,
  ...BUSINESS_SCREENS,
  ...PUBLIC_SCREENS,
];

/** Routes that exist in the front end but are aliases, not screens (documented so the ledger is complete). */
export const ROUTE_ALIASES: readonly { route: string; resolvesTo: string; note: string }[] = [
  { route: '/', resolvesTo: '/login', note: 'anonymous landing redirects to the login screen' },
  {
    route: '/profile',
    resolvesTo: '/userprofile',
    note: 'redirects to the profile screen (verified live 2026-10-10)',
  },
];
