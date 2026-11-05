// Settings cross-user reads and writes: can C read or change another user's settings by naming its
// kpostID in the body or the query? Gated on SETTINGS_LIFECYCLE: it changes both accounts' real
// preferences and puts them back.
import { AUTH_PROFILES } from '@config/auth-profile';
import type { Principal } from '@config/auth.config';
import type { EndpointExecutor } from '@engine/endpoint-executor';
import { expect, test } from '@fixtures';

/**
 * Every /generalSetting endpoint takes the account from the token alone,
 * `request.getAttribute("kpostID")` (GeneralSettingController.java:37, 67, 97, 134-135, 181-182,
 * 228-229, 266), and the service reads and writes only that account's row
 * (GeneralSettingServiceImpl.java:30, 58, 107, 120, 186, 247, 308 — `findByKpostID(kpostID)`). A
 * `kpostID` in the body or query is not a parameter at all, so it must be ignored. This proves it
 * live: V (personal-4) owns the settings; V's identical call succeeds first (owner control); then C
 * (personal-3) makes the same call naming V; V's own read-back decides. The status code alone is
 * not trusted: the call is expected to succeed, on C's own row.
 */
const V: Principal = AUTH_PROFILES.kpost.principals.find((p) => p.key === 'personal-4')!;
const C: Principal = AUTH_PROFILES.kpost.principals.find((p) => p.key === 'personal-3')!;

type Row = Record<string, unknown>;
const PREF_KEYS = ['Message Preview', 'Sound', 'Vibrate', 'Do Not Disturb'] as const;

function asObject(value: unknown): Row | undefined {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Row;
  if (typeof value !== 'string') return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Row)
      : undefined;
  } catch {
    return undefined;
  }
}

function bodyOf(ex: { json(): { ok: boolean; value?: unknown } }): Row {
  const parsed = ex.json();
  return (parsed.ok ? parsed.value : {}) as Row;
}

/** Key order is the server's, not meaning: compare with keys sorted at every level. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.keys(value as Row)
        .sort()
        .map((k) => [k, canonical((value as Row)[k])]),
    );
  return value ?? null;
}
const same = (a: unknown, b: unknown) =>
  JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

/** The QA guard is told both accounts are ours to name (they are QA_* accounts). */
const owned = () => [V.username, C.username];

async function write(
  endpoints: EndpointExecutor,
  who: Principal,
  id: string,
  body: Row,
  label: string,
): Promise<number> {
  const ex = await endpoints.sendTo(
    id,
    { body },
    {
      label: `settings-xu:${label}`,
      auth: { principal: who },
      allowLiveWrite: true,
      ownedIdentifiers: owned(),
    },
  );
  return ex.status;
}

/** `who`'s settings read (`data`), optionally with a `query` naming someone else. */
async function read(
  endpoints: EndpointExecutor,
  who: Principal,
  id: 'settings-get-notifications' | 'settings-get-personalize',
  label: string,
  query?: Record<string, string>,
): Promise<{ status: number; data: Row; text: string }> {
  const ex = await endpoints.sendTo(id, query ? { query } : {}, {
    label: `settings-xu:${label}`,
    auth: { principal: who },
    ownedIdentifiers: owned(),
  });
  return { status: ex.status, data: (bodyOf(ex).data ?? {}) as Row, text: ex.bodyText };
}

const katchupOf = async (endpoints: EndpointExecutor, who: Principal, label: string) =>
  asObject(
    (await read(endpoints, who, 'settings-get-notifications', label)).data.katchupNotification,
  );
const fontOf = async (endpoints: EndpointExecutor, who: Principal, label: string) =>
  asObject((await read(endpoints, who, 'settings-get-personalize', label)).data.fontSettings);

const restorablePref = (pref: Row | undefined): pref is Row =>
  typeof pref?.['Do Not Disturb'] === 'string' && pref['Do Not Disturb'] !== '';
const prefBody = (pref: Row): Row => Object.fromEntries(PREF_KEYS.map((k) => [k, pref[k] ?? '']));
const flipped = (pref: Row): Row =>
  Object.fromEntries(PREF_KEYS.map((k) => [k, pref[k] === 'On' ? 'Off' : 'On']));
const restorableFont = (font: Row | undefined): font is Row =>
  typeof font?.['Font Size'] === 'string' && typeof font['Font Style'] === 'string';
const fontBody = (font: Row): Row => ({
  fontSize: font['Font Size'],
  fontStyle: font['Font Style'],
});

/** The ways a caller could try to name another account in a body or query. */
const naming = (kpostId: string): Record<string, string> => ({
  kpostID: kpostId,
  kpostId,
  kpost_id: kpostId,
});

/** Puts `who`'s katchup preference and font back when they no longer match the originals. */
async function restore(
  endpoints: EndpointExecutor,
  who: Principal,
  original: { katchup?: Row; font?: Row },
): Promise<void> {
  if (restorablePref(original.katchup)) {
    const now = await katchupOf(endpoints, who, `${who.key}-restore-check`).catch(() => undefined);
    if (!same(now, original.katchup)) {
      const status = await write(
        endpoints,
        who,
        'settings-katchup-notification',
        prefBody(original.katchup),
        `${who.key}-restore-katchup`,
      ).catch(() => 0);
      expect.soft(status, `${who.username}'s katchup preference is restored`).toBe(200);
    }
  }
  if (restorableFont(original.font)) {
    const now = await fontOf(endpoints, who, `${who.key}-restore-font-check`).catch(
      () => undefined,
    );
    if (!same(now, original.font)) {
      const status = await write(
        endpoints,
        who,
        'settings-font',
        fontBody(original.font),
        `${who.key}-restore-font`,
      ).catch(() => 0);
      expect.soft(status, `${who.username}'s font is restored`).toBe(200);
    }
  }
}

/** A finding when `harm` describes one, recorded and soft-asserted (undefined = no harm). */
function verdict(
  endpoints: EndpointExecutor,
  v: {
    endpointId: string;
    ruleId: string;
    rule: string;
    expected: string;
    request: { body?: Row; query?: Record<string, string> };
    status: number;
    harm: string | undefined;
  },
): void {
  if (v.harm)
    endpoints.recordBusinessRuleViolation({
      endpointId: v.endpointId,
      ruleId: v.ruleId,
      rule: v.rule,
      expected: v.expected,
      actual: `HTTP ${v.status}: ${v.harm}`,
      request: v.request,
    });
  expect
    .soft(Boolean(v.harm), `BOLA (${v.endpointId}, HTTP ${v.status}): ${v.harm ?? ''}`)
    .toBe(false);
}

test.describe(
  'KPost Security · Settings cross-user reads and writes @api @kpost-api @security',
  {
    tag: ['@api', '@settings', '@auth', '@security', '@regression'],
    annotation: [{ type: 'non-functional', description: 'security' }],
  },
  () => {
    test.describe.configure({ mode: 'default', timeout: 120_000 });
    test.skip(
      process.env.SETTINGS_LIFECYCLE !== 'true',
      "changes two accounts' preferences and restores them; set SETTINGS_LIFECYCLE=true",
    );
    test.skip(!V?.username || !C?.username, 'needs the personal-3 and personal-4 principals');

    test("a user naming another user's kpostID cannot change their notification preference @api @settings @security", async ({
      endpoints,
    }) => {
      const vOriginal = { katchup: await katchupOf(endpoints, V, 'v-katchup-before') };
      const cOriginal = { katchup: await katchupOf(endpoints, C, 'c-katchup-before') };
      test.skip(
        !restorablePref(vOriginal.katchup) || !restorablePref(cOriginal.katchup),
        'both accounts need a stored katchup preference to restore afterwards',
      );
      try {
        // Owner control: V's own call, naming itself, changes V's preference.
        const ownerValue = flipped(vOriginal.katchup!);
        const ownerStatus = await write(
          endpoints,
          V,
          'settings-katchup-notification',
          { ...ownerValue, ...naming(V.username) },
          'katchup-owner-control',
        );
        const afterOwner = await katchupOf(endpoints, V, 'v-katchup-after-owner');
        const control = ownerStatus === 200 && same(afterOwner, ownerValue);
        expect
          .soft(control, `owner control: V changes its own preference (HTTP ${ownerStatus})`)
          .toBe(true);
        if (!control) return;

        // The attack: C sends the opposite value, naming V every way a body could.
        const attackValue = flipped(ownerValue);
        const attackBody = { ...attackValue, ...naming(V.username) };
        const status = await write(
          endpoints,
          C,
          'settings-katchup-notification',
          attackBody,
          'katchup-attack',
        );
        const vNow = await katchupOf(endpoints, V, 'v-katchup-after-attack');
        const cNow = await katchupOf(endpoints, C, 'c-katchup-after-attack');
        verdict(endpoints, {
          endpointId: 'settings-katchup-notification',
          ruleId: 'IDOR-settings-katchup-notification-cross-user',
          rule: "katchupNotification must change only the caller's own preference (the token's kpostID): a kpostID in the body must not let a user change another user's notification settings.",
          expected:
            "the other user's preference unchanged; the write, if accepted, lands on the caller",
          request: { body: attackBody },
          status,
          harm: !same(vNow, ownerValue)
            ? `${C.username} changed ${V.username}'s katchup preference to ${JSON.stringify(vNow ?? null)}`
            : undefined,
        });
        // Where the accepted write went: the caller's own row (token-scoped), not nowhere.
        if (status === 200)
          expect
            .soft(cNow, "an accepted write lands on the caller's own preference")
            .toEqual(attackValue);
      } finally {
        await restore(endpoints, V, vOriginal);
        await restore(endpoints, C, cOriginal);
      }
    });

    test("a user naming another user's kpostID cannot change their font @api @settings @security", async ({
      endpoints,
    }) => {
      const vOriginal = { font: await fontOf(endpoints, V, 'v-font-before') };
      const cOriginal = { font: await fontOf(endpoints, C, 'c-font-before') };
      test.skip(
        !restorableFont(vOriginal.font) || !restorableFont(cOriginal.font),
        'both accounts need a stored font to restore afterwards',
      );
      try {
        // Values the Personalize screen offers; the owner's differs from what V has stored.
        const ownerFont =
          vOriginal.font!['Font Size'] === 'large'
            ? { fontSize: 'small', fontStyle: 'Arial' }
            : { fontSize: 'large', fontStyle: 'Arial' };
        const ownerStatus = await write(
          endpoints,
          V,
          'settings-font',
          { ...ownerFont, ...naming(V.username) },
          'font-owner-control',
        );
        const afterOwner = await fontOf(endpoints, V, 'v-font-after-owner');
        const control =
          ownerStatus === 200 &&
          afterOwner?.['Font Size'] === ownerFont.fontSize &&
          afterOwner['Font Style'] === ownerFont.fontStyle;
        expect
          .soft(control, `owner control: V changes its own font (HTTP ${ownerStatus})`)
          .toBe(true);
        if (!control) return;

        const attackBody = {
          fontSize: ownerFont.fontSize === 'large' ? 'small' : 'large',
          fontStyle: 'Helvetica',
          ...naming(V.username),
        };
        const status = await write(endpoints, C, 'settings-font', attackBody, 'font-attack');
        const vNow = await fontOf(endpoints, V, 'v-font-after-attack');
        verdict(endpoints, {
          endpointId: 'settings-font',
          ruleId: 'IDOR-settings-font-cross-user',
          rule: "fontSetting must change only the caller's own font (the token's kpostID): a kpostID in the body must not let a user change another user's font.",
          expected: "the other user's font unchanged",
          request: { body: attackBody },
          status,
          harm: !same(vNow, afterOwner)
            ? `${C.username} changed ${V.username}'s font to ${JSON.stringify(vNow ?? null)}`
            : undefined,
        });
      } finally {
        await restore(endpoints, V, vOriginal);
        await restore(endpoints, C, cOriginal);
      }
    });

    test("a user naming another user's kpostID in the query reads only their own settings @api @settings @security", async ({
      endpoints,
    }) => {
      const vOriginal = {
        katchup: await katchupOf(endpoints, V, 'v-read-katchup-before'),
        font: await fontOf(endpoints, V, 'v-read-font-before'),
      };
      const cKatchup = await katchupOf(endpoints, C, 'c-read-katchup-before');
      const cFont = await fontOf(endpoints, C, 'c-read-font-before');
      test.skip(
        !restorablePref(vOriginal.katchup) ||
          !restorableFont(vOriginal.font) ||
          !restorablePref(cKatchup) ||
          !restorableFont(cFont),
        'both accounts need a stored katchup preference and font (V restored afterwards)',
      );
      try {
        // Make V's settings tell apart from C's, so a leak is visible (only V's are changed).
        const vKatchup = flipped(cKatchup!);
        const vFont = {
          fontSize: cFont!['Font Size'] === 'large' ? 'small' : 'large',
          fontStyle: cFont!['Font Style'] === 'Arial' ? 'Helvetica' : 'Arial',
        };
        const setK = await write(endpoints, V, 'settings-katchup-notification', vKatchup, 'v-mark');
        const setF = await write(endpoints, V, 'settings-font', vFont, 'v-mark-font');
        // Owner control: V's own read returns the marked values.
        const vSeesK = await katchupOf(endpoints, V, 'v-read-katchup-own');
        const vSeesF = await fontOf(endpoints, V, 'v-read-font-own');
        const control =
          setK === 200 &&
          setF === 200 &&
          same(vSeesK, vKatchup) &&
          vSeesF?.['Font Size'] === vFont.fontSize &&
          vSeesF['Font Style'] === vFont.fontStyle;
        expect
          .soft(control, `owner control: V reads its own marked settings (HTTP ${setK}/${setF})`)
          .toBe(true);
        if (!control) return;

        const query = naming(V.username);
        for (const [id, key, cOwn, vOwn] of [
          ['settings-get-notifications', 'katchupNotification', cKatchup, vSeesK],
          ['settings-get-personalize', 'fontSettings', cFont, vSeesF],
        ] as const) {
          const reply = await read(endpoints, C, id, `${id}-attack`, query);
          const seen = asObject(reply.data[key]);
          verdict(endpoints, {
            endpointId: id,
            ruleId: `IDOR-${id}-cross-user`,
            rule: `${id === 'settings-get-notifications' ? 'getAllNotification' : 'getPersonalize'} must return only the caller's own settings (the token's kpostID): a kpostID in the query must not return another user's settings.`,
            expected: `the caller's own ${key}`,
            request: { query },
            status: reply.status,
            harm:
              same(seen, vOwn) && !same(seen, cOwn)
                ? `${C.username} read ${V.username}'s ${key}: ${JSON.stringify(seen)}`
                : undefined,
          });
          expect.soft(seen, `${id}: the caller still sees its own ${key}`).toEqual(cOwn);
        }
      } finally {
        await restore(endpoints, V, vOriginal);
      }
    });
  },
);
