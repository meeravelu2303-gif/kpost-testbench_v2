import fs from 'node:fs';
import path from 'node:path';
import { ROOT_DIR } from '@config/constants';
import { test } from '@fixtures';

/**
 * Every message the web app shows to refuse input or report a failure, read from the React source,
 * and whether any bench test checks it. Written to docs/generated/ui-rule-coverage.md on every
 * `npm run framework`, so an untested rule is listed instead of being found by chance. A rule counts
 * as checked when a test names its text (the first words, case and punctuation ignored).
 */

const FRONTEND =
  process.env.FRONTEND_SRC ?? 'D:/KPOST_PROJECTS/KPOST_REACTJS_2023_V1/src/components';

/** Where a message is raised: a toast, an error state, an errors map, or an alert. */
const RULE =
  /(toast\.(?:warn|error|warning|info)\(\s*(?:t\()?\s*|setError[A-Za-z]*\(\s*(?:t\()?\s*|Errors?\.[a-zA-Z]+\s*=\s*(?:t\()?\s*|errors?\s*:\s*|alert\(\s*)(["'`])([^"'`]{6,140})\2/g;

/** Not testable from a browser on this bench, with the reason. First match wins. */
const NOT_TESTABLE: Array<[RegExp, string]> = [
  [/^[,(]|error\);|\);$/, 'a console call, not a message'],
  [/coming soon|launching soon|in progress|scroll is working/i, 'a placeholder notice, not a rule'],
  [
    /mic|microphone|speech|voice recording|clipboard|geolocation|permission denied|copy (automatically|the link|meeting)/i,
    'needs a device permission the test browser does not grant',
  ],
  [/otp/i, 'behind an OTP that texts a real phone'],
  [
    /logged on another|session has expired|socket|props\.response|left the call|rejected|disconnected|no response/i,
    'a session or live-call event',
  ],
  // Rules the live screen gives a user no way to reach, each confirmed by a spec that says so.
  [
    /^(Priority is required|Schedule period is required|Repeat type is required)$/,
    'unreachable: a plain select that cannot be emptied (Save waits instead; kdiary-validation)',
  ],
  [
    /^(Mail content is too large|No email ids found in Excel)/,
    'Bulk Mail is not offered on this build (kmail-validation skips with that reason)',
  ],
];

/**
 * Source files the app never shows, with the reason (read from the React source, 2026-10-31). Their
 * messages are not rules a user can meet.
 */
const NEVER_SHOWN: Array<[RegExp, string]> = [
  [
    /^Katchup\/classic\//,
    'the Classic chat style is disabled ("temporarily unavailable", Personalize.js)',
  ],
  [
    /^Katchup\/bubble\/(ContactList|RecentMessage|Diary|Contact|Recent|KKatch)\/|^Katchup\/bubble\/Katchup\.js$/,
    'never imported: the page mounts the components/ copy',
  ],
  [
    /^Katchup\/components\/KatchupMessage\//,
    'never imported: Katchup.js mounts the bubble (or disabled classic) copy',
  ],
  [
    /^Kmail\/components\/KmailContactList\//,
    'never imported: KMail Contacts uses Katchup ContactList',
  ],
  [/^Kall\/components\/KallContact\//, 'never imported: Kall Contacts uses Katchup ContactList'],
  [/^auth\/Register\.js$/, 'not routed: /signup renders MainSignup'],
  [
    /^Kdirectory\/components\/KdirectoryModal\//,
    'the modal’s show prop is commented out, so it never opens',
  ],
];

/**
 * Live code no user can reach on that screen, with the reason (each read from the source). Keyed by
 * screen and the message's start, so the same text elsewhere still counts.
 */
const UNREACHABLE: Array<[string, RegExp, string]> = [
  ['Katchup/forwardFooter', /^Enter Your Message/, 'its only callers are commented out'],
  [
    'Katchup/forwardFooter',
    /^Please select atleast one contact/,
    'Send is disabled until a contact is picked',
  ],
  [
    'Katchup/KatchupMessage',
    /^Single Admin Cannot Exit/,
    'an earlier return ("Group admins cannot exit") always wins, and Exit is hidden for admins',
  ],
  [
    'Katchup/KatchupMessage',
    /^Your message is Block/,
    'the bell menu is not rendered for that message type',
  ],
  [
    'Katchup/KatchupMessage',
    /^Error!, Please Try Again After Some Time/,
    'the delete service swallows errors, so this catch never runs',
  ],
  [
    'Katchup/MessageBox',
    /^Can not able to select more than one message/,
    'the checkbox is disabled under the same condition',
  ],
  [
    'Katchup/MultipleContact',
    /^Access Deneid|^Access Denied/,
    'removed groups are filtered out of the list and their checkbox is disabled',
  ],
  [
    'Katchup/ContactList',
    /^Please enter a group name/,
    'Create is disabled while the name is empty',
  ],
  [
    'Katchup/ContactList',
    /^Please select at least one group member/,
    'Create only appears once a member is added',
  ],
  [
    'Katchup/ContactList',
    /^Already this contact is saved/,
    'other-domain rows are not listed in Katchup Contacts',
  ],
  ['Katchup/DigitalCard', /^No image available/, 'the photo button always has an image address'],
  [
    'common/ComposeAssist',
    /^Add a few words for K-AI/,
    'every caller opens straight in Generate, where this check does not run',
  ],
  ['auth', /^Passwords do not match/, 'Submit stays disabled until the two passwords match'],
  [
    'Kmail/MailFooter',
    /^Mail could not be sent/,
    'only a client-side exception reaches it; a failed send shows the server’s own message',
  ],
  [
    'Kall/KallPage',
    /^You have received new kool kall/,
    'a live push from another user’s browser creating the meeting (socket)',
  ],
  [
    'K-Booking',
    /^Error: Payment details could not be retrieved/,
    'comes after the ticket is blocked for payment, which the bench never does',
  ],
];

/** Raised when the server fails: covered by forcing the call to fail (the -api-handling specs). */
const SERVER_FAILURE =
  /unable to|failed|failure|went wrong|some ?error|error occur|api error|processing error|unexpected error|not available|cannot be recalled|error (from|while|in|loading|checking|sending)/i;

const norm = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

function files(dir: string, pick: (p: string) => boolean, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!/node_modules|test-results|playwright-report/.test(p)) files(p, pick, out);
    } else if (pick(p)) out.push(p);
  }
  return out;
}

test.describe('web input-rule coverage ledger', { tag: '@framework' }, () => {
  test('write docs/generated/ui-rule-coverage.md listing every unchecked rule', () => {
    test.skip(
      !fs.existsSync(FRONTEND),
      'needs provisioned React source on this machine (set FRONTEND_SRC)',
    );

    const bench = norm(
      [
        ...files(path.join(ROOT_DIR, 'tests'), (p) => p.endsWith('.ts')),
        ...files(path.join(ROOT_DIR, 'mobile', 'patrol_test'), (p) => p.endsWith('.dart')),
      ]
        .map((p) => fs.readFileSync(p, 'utf8'))
        .join('\n'),
    );

    type Row = {
      screen: string;
      message: string;
      kind: 'input' | 'server' | 'excluded';
      why?: string;
    };
    const rows = new Map<string, Row>();
    for (const file of files(FRONTEND, (p) => p.endsWith('.js') && !p.includes('.test.'))) {
      const rel = path.relative(FRONTEND, file).split(path.sep).join('/');
      if (rel.startsWith('KOS/')) continue; // KDoc/KOS is out of scope (owner directive).
      if (NEVER_SHOWN.some(([re]) => re.test(rel))) continue;
      // The bubble, classic and components variants are one screen.
      const screen = path
        .dirname(rel)
        .replace(/^(Katchup|Kmail|Kall)\/(bubble|classic|components)\//, '$1/');
      // Commented-out code raises nothing: drop block comments and whole commented lines.
      const source = fs
        .readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      for (const match of source.matchAll(RULE)) {
        const message = (match[3] ?? '').trim();
        if (/\$\{|^http|success|^\w+$/i.test(message)) continue;
        const key = `${screen}|${norm(message)}`;
        if (rows.has(key)) continue;
        const dead = UNREACHABLE.find(([s, re]) => s === screen && re.test(message));
        const excluded = dead
          ? ([dead[1], `unreachable: ${dead[2]}`] as const)
          : NOT_TESTABLE.find(([re]) => re.test(message));
        rows.set(key, {
          screen,
          message,
          kind: excluded ? 'excluded' : SERVER_FAILURE.test(message) ? 'server' : 'input',
          why: excluded?.[1],
        });
      }
    }

    const checked = (row: Row) => {
      const words = norm(row.message)
        .replace(/^(the|please) /, '')
        .split(' ');
      return bench.includes(words.slice(0, Math.min(words.length, 5)).join(' '));
    };
    const all = [...rows.values()].sort((a, b) => a.screen.localeCompare(b.screen));
    const section = (kind: Row['kind']) => all.filter((r) => r.kind === kind);
    const table = (list: Row[], withStatus: boolean) => [
      withStatus ? '| Screen | Message | Checked |' : '| Screen | Message | Why |',
      '| ------ | ------- | ------- |',
      ...list.map(
        (r) =>
          `| \`${r.screen}\` | ${r.message.replace(/\|/g, '/')} | ${withStatus ? (checked(r) ? 'yes' : '**no**') : r.why} |`,
      ),
    ];
    const count = (list: Row[]) => `${list.filter(checked).length} of ${list.length}`;
    const input = section('input');
    const server = section('server');
    const lines = [
      '# Web input-rule coverage',
      '',
      '**GENERATED — do not edit.** Written by `tests/framework/ui-rule-coverage.spec.ts`',
      '(`npm run framework`) from the React source. A rule is checked when a test names its text.',
      '',
      `- Input rules checked: **${count(input)}**`,
      `- Server-failure messages checked: **${count(server)}**`,
      `- Not testable from a browser here: ${section('excluded').length}`,
      '',
      '## Input rules (bad input the screen must refuse)',
      '',
      ...table(input, true),
      '',
      '## Server-failure messages (forced by failing the call)',
      '',
      ...table(server, true),
      '',
      '## Not testable from a browser here',
      '',
      ...table(section('excluded'), false),
      '',
    ];
    fs.writeFileSync(
      path.join(ROOT_DIR, 'docs', 'generated', 'ui-rule-coverage.md'),
      lines.join('\n'),
    );
    test.info().annotations.push({
      type: 'coverage',
      description: `input rules ${count(input)}; server-failure messages ${count(server)}`,
    });
  });
});
