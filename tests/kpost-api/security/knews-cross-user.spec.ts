// KNews settings cross-user. Gated on SETTINGS_LIFECYCLE: A and C each write their own settings row,
// and both are restored afterwards.
import { KNEWS_SETTINGS_SAMPLE } from '@api/definitions/kpost/knews/knews.api';
import { AUTH_PROFILES } from '@config/auth-profile';
import type { Principal } from '@config/auth.config';
import type { EndpointExecutor } from '@engine/endpoint-executor';
import { expect, test } from '@fixtures';

/**
 * A user's KNews settings belong to that user alone. updateKnewsSettings overwrites the body's
 * kpostId with the token's (KnewsController.java:131) and getKnewsSettings reads only the token's
 * row (KnewsController.java:151-156), so naming another user's KPost ID must neither change nor
 * reveal that user's settings. Proven live with an owner control: A writes a marker into its own
 * settings and reads it back (A's identical call works), then C makes the same call naming A, and
 * A's own read-back decides. The status code alone is not trusted.
 */
const A: Principal = AUTH_PROFILES.kpost.principals.find((p) => p.key === 'personal')!;
const C: Principal = AUTH_PROFILES.kpost.principals.find((p) => p.key === 'personal-3')!;

type Row = Record<string, unknown>;
const SETTING_KEYS = Object.keys(KNEWS_SETTINGS_SAMPLE) as Array<
  keyof typeof KNEWS_SETTINGS_SAMPLE
>;

function bodyOf(ex: { json(): { ok: boolean; value?: unknown } }): Row {
  const parsed = ex.json();
  return (parsed.ok ? parsed.value : {}) as Row;
}

async function settingsOf(
  endpoints: EndpointExecutor,
  who: Principal,
  step: string,
): Promise<Row | undefined> {
  const ex = await endpoints.sendTo(
    'knews-get-settings',
    {},
    { label: `knews-xu:read-${step}`, auth: { principal: who } },
  );
  return ex.status === 200 ? (bodyOf(ex).data as Row | undefined) : undefined;
}

async function save(
  endpoints: EndpointExecutor,
  who: Principal,
  body: Row,
  step: string,
): Promise<{ status: number; text: string }> {
  const ex = await endpoints.sendTo(
    'knews-update-settings',
    { body },
    {
      label: `knews-xu:save-${step}`,
      auth: { principal: who },
      allowLiveWrite: true,
      ownedIdentifiers: [A.username, C.username],
    },
  );
  return { status: ex.status, text: ex.bodyText ?? '' };
}

/** Puts back what `who` had; a user who had none keeps the workbook sample (there is no delete API). */
async function restore(
  endpoints: EndpointExecutor,
  who: Principal,
  original: Row | undefined,
): Promise<void> {
  const body = original
    ? Object.fromEntries(
        SETTING_KEYS.filter((k) => original[k] !== null && original[k] !== undefined).map((k) => [
          k,
          original[k],
        ]),
      )
    : { ...KNEWS_SETTINGS_SAMPLE };
  const done = await save(endpoints, who, body, `restore-${who.key}`).catch(() => ({
    status: 0,
    text: '',
  }));
  expect.soft(done.status, `${who.username}'s original news settings are put back`).toBe(200);
}

/** A finding when `harm` describes one, recorded and soft-asserted (undefined = no harm). */
function verdict(
  endpoints: EndpointExecutor,
  v: {
    endpointId: string;
    ruleId: string;
    rule: string;
    expected: string;
    request: Row;
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
      request: { body: v.request },
    });
  expect
    .soft(Boolean(v.harm), `BOLA (${v.endpointId}, HTTP ${v.status}): ${v.harm ?? ''}`)
    .toBe(false);
}

test.describe(
  'KPost Security · KNews settings cross-user @api @kpost-api @security',
  {
    tag: ['@api', '@auth', '@security', '@regression', '@verticals'],
    annotation: [{ type: 'non-functional', description: 'security' }],
  },
  () => {
    test.describe.configure({ timeout: 120_000 });
    test.skip(
      process.env.SETTINGS_LIFECYCLE !== 'true',
      'writes the KNews settings of two QA accounts (restored afterwards); set SETTINGS_LIFECYCLE=true',
    );
    test.skip(!A || !C, 'needs the personal and personal-3 principals');

    test("an unrelated user cannot read or change another user's KNews settings by naming their KPost ID @api @verticals @security", async ({
      endpoints,
    }) => {
      const stamp = Date.now();
      const originalA = await settingsOf(endpoints, A, 'a-before');
      const originalC = await settingsOf(endpoints, C, 'c-before');
      const ownerMarker = `QA XU owner ${stamp}`;
      const hijackMarker = `QA XU HIJACK ${stamp}`;

      try {
        // Owner control: A's own save (naming itself) lands and reads back.
        const ownerBody = { ...KNEWS_SETTINGS_SAMPLE, kpostId: A.username, cityNames: ownerMarker };
        const ownerSave = await save(endpoints, A, ownerBody, 'owner-control');
        const control =
          (await settingsOf(endpoints, A, 'a-after-owner'))?.cityNames === ownerMarker;
        test.skip(
          !control,
          `owner control: A's own updateKnewsSettings did not land (HTTP ${ownerSave.status}), so the probe proves nothing`,
        );

        // --- write: C's identical call, naming A in the body (camel and upper-case id keys) ------
        const attackBody = {
          ...KNEWS_SETTINGS_SAMPLE,
          kpostId: A.username,
          kpostID: A.username,
          cityNames: hijackMarker,
        };
        const attack = await save(endpoints, C, attackBody, 'attack');
        const aNow = await settingsOf(endpoints, A, 'a-after-attack');
        expect.soft(aNow, "A's own settings are still readable after C's call").toBeDefined();
        verdict(endpoints, {
          endpointId: 'knews-update-settings',
          ruleId: 'IDOR-knews-update-settings-cross-user',
          rule:
            "updateKnewsSettings must write only the caller's own settings: the body's kpostId is replaced " +
            "by the token's (KnewsController.java:131), so naming another user's KPost ID must not change theirs.",
          expected: "A's settings keep A's own values; C's call changes at most C's row",
          request: attackBody,
          status: attack.status,
          harm:
            aNow?.cityNames !== ownerMarker
              ? `${C.username} changed ${A.username}'s KNews settings: cityNames is now ${JSON.stringify(aNow?.cityNames)}`
              : attack.text.includes(ownerMarker)
                ? `the response disclosed ${A.username}'s settings ("${ownerMarker}")`
                : undefined,
        });

        // --- read: C asks getKnewsSettings naming A (query keys the server could honour) --------
        for (const key of ['kpostId', 'kpostID']) {
          const read = await endpoints.sendTo(
            'knews-get-settings',
            { query: { [key]: A.username } },
            {
              label: `knews-xu:read-attack-${key}`,
              auth: { principal: C },
              ownedIdentifiers: [A.username],
            },
          );
          const text = read.bodyText ?? '';
          verdict(endpoints, {
            endpointId: 'knews-get-settings',
            ruleId: 'IDOR-knews-get-settings-cross-user',
            rule:
              "getKnewsSettings must return only the caller's own settings (KnewsController.java:151-156): " +
              "naming another user's KPost ID must not reveal theirs.",
            expected: "C gets its own settings (or 404), never A's",
            request: { query: { [key]: A.username } },
            status: read.status,
            harm: text.includes(ownerMarker)
              ? `${C.username} read ${A.username}'s KNews settings via ?${key}= (saw "${ownerMarker}")`
              : undefined,
          });
        }
      } finally {
        await restore(endpoints, A, originalA);
        await restore(endpoints, C, originalC);
      }
    });
  },
);
