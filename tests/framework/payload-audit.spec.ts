import fs from 'node:fs';
import path from 'node:path';
import { workbookContract } from '@api/contract/workbook-contract';
import { apiRegistry } from '@api/definitions/index';
import type { EndpointDefinition } from '@api/registry/endpoint-definition';
import type { RequestFactoryHelpers } from '@api/registry/endpoint-definition';
import type { HttpMethod, RequestSpec } from '@api/client/request-builder';
import { ROOT_DIR } from '@config/constants';
import { expect, test } from '@fixtures';

/**
 * Payload completeness audit: does each endpoint send every field of its documented example?
 * A partial request files a false bug. Schema-only fields are listed but usually correct.
 * Writes `docs/generated/payload-audit.md`.
 */

// A stub `call` for the static audit: never contacts an endpoint, returns an empty object.
const STUB: RequestFactoryHelpers = {
  call: (() => Promise.resolve({})) as RequestFactoryHelpers['call'],
  tenantId: 'qa-audit',
};

/** `productionSafe` endpoints that legitimately omit a documented-example field, with reasons. */
const LIVE_OMISSIONS: Record<string, string> = {};

/**
 * Gated writes / needs-id reads that omit a documented-example field, with the reason. Exhaustive
 * because a bad write payload can contaminate other endpoints through the shared DB.
 */
const GATED_WRITE_OMISSIONS: Record<string, string> = {
  // The working request omits the workbook's `sendDate` (sending it answers 500).
  'common-validate-mail-otp': 'workbook `sendDate` omitted — matches the working validateOTP shape',
  // Katchup forwards/bulk: the referenced msgIDs are minted at runtime by KATCHUP_LIFECYCLE.
  'katchup-forward-message-new':
    'referenceMessage + source msgIDs supplied at runtime by the katchup lifecycle',
  'katchup-send-forward-selected-attachment':
    'referenceMessage + attachment uuid + msgIDs supplied at runtime by the katchup lifecycle',
  'katchup-forward-multiple':
    'forwardMessageIDList + uuid supplied at runtime by the katchup lifecycle',
  'katchup-send-bulk': 'mapDetails (per-recipient) supplied at runtime by the katchup lifecycle',
  'katchup-messages-by-reference':
    'read keyed by a runtime referenceMessageID list a send flow mints',
  // The frontend sends {msgID, groupFlag}; the workbook `status:5` is stale and invalid.
  'katchup-recall-message':
    'frontend sends {msgID, groupFlag}; workbook `status` is stale/invalid — deliberately omitted',
  // Admin `global` writes are blocked on live in every mode, so the placeholder is never sent.
  'admin-update-company-details':
    'global write, blocked on live in every mode; never driven — real payload built by an authorized admin flow',
  'admin-update-bank-account':
    'global write, blocked on live in every mode; never driven — real payload built by an authorized admin flow',
  'admin-update-role':
    'global write, blocked on live in every mode; never driven — real payload built by an authorized admin flow',
  'admin-reset-password':
    'global write, blocked on live in every mode; never driven — real payload built by an authorized admin flow',
  'admin-hold-or-release':
    'global write, blocked on live in every mode; never driven — real payload built by an authorized admin flow',
  // Gated data writes / needs-id reads: the lifecycle spec fills runtime ids and optional values.
  'profile-update-contact':
    'gated PROFILE_LIFECYCLE, self-restoring; optional contact fields (addressLine2/alternateMobile/landline)',
  // The backend takes a JSON array; the fields are sent inside each element, not at the top level.
  'contacts-add-multiple':
    'documented fields are sent inside each array element (backend takes a JSON array, the example shows one object)',
  // Never driven: a real third-party seat hold; its ids only exist after a live search.
  'kbooking-block-ticket':
    'never executed (real third-party seat hold, needs owner authorisation); trip/boarding/route ids come from a live search',
  'kmail-draft-content':
    'read keyed by a runtime draftMailID/senderUniqueMailID a draft-save mints',
  'kmail-draft-delete': 'gated KMAIL_LIFECYCLE; kmailSendDate of the runtime draft being deleted',
  'kmail-edit-od-contact': 'gated KMAIL_LIFECYCLE; referenceName of a runtime other-domain contact',
  'kmail-download-od-attachment': 'needs-id read; targetFileName of a runtime attachment',
};

interface AuditRow {
  id: string;
  method: string;
  path: string;
  missingFromExample: string[];
  missingFromSchema: string[];
  destructive: boolean;
  runsLive: boolean;
}

function keysOf(value: unknown): string[] {
  return value && typeof value === 'object' ? Object.keys(value) : [];
}

interface DocumentedFields {
  schema: string[];
  example: string[];
}

function documentedFields(d: EndpointDefinition): DocumentedFields {
  if (!d.suite) return { schema: [], example: [] };
  const method: HttpMethod = d.contractMethod ?? d.method;
  const candidates = [d.contractPath ?? d.path, d.path];
  for (const p of candidates) {
    try {
      const c = workbookContract(d.suite, method, p);
      return { schema: keysOf(c.requestSchema?.properties), example: keysOf(c.requestExample) };
    } catch {
      /* try next candidate */
    }
  }
  return { schema: [], example: [] };
}

test.describe('payload completeness audit @framework', () => {
  test('every live-running endpoint sends every documented-example field (no false-bug risk)', async () => {
    const endpoints = apiRegistry.all();
    const rows: AuditRow[] = [];

    for (const d of endpoints) {
      let spec: RequestSpec;
      try {
        spec = d.request ? await d.request(STUB) : {};
      } catch {
        continue; // a factory that needs a live `call()` — skip in the static audit
      }
      // Multipart carries its fields in a `text` JSON part, not `body`: skip.
      if (spec.multipart) continue;
      // A GET has no body, so a stale POST-era example body does not apply.
      if (d.method === 'GET') continue;
      // "Sent" = body, query or path param, compared case-insensitively (workbook casing drifts).
      const sent = new Set(
        [...keysOf(spec.body), ...keysOf(spec.query), ...keysOf(spec.pathParams)].map((k) =>
          k.toLowerCase(),
        ),
      );
      const has = (k: string): boolean => sent.has(k.toLowerCase());
      const { schema, example } = documentedFields(d);
      if (schema.length === 0 && example.length === 0) continue; // nothing documented

      const exampleLc = new Set(example.map((k) => k.toLowerCase()));
      const missingFromExample = example.filter((k) => !has(k));
      const missingFromSchema = schema.filter((k) => !has(k) && !exampleLc.has(k.toLowerCase()));
      if (missingFromExample.length === 0 && missingFromSchema.length === 0) continue;
      rows.push({
        id: d.id,
        method: d.method,
        path: d.path,
        missingFromExample,
        missingFromSchema,
        destructive: d.destructive ?? false,
        runsLive: d.productionSafe === true,
      });
    }

    const risks = rows.filter((r) => r.missingFromExample.length > 0);
    risks.sort(
      (a, b) =>
        Number(b.runsLive) - Number(a.runsLive) ||
        b.missingFromExample.length - a.missingFromExample.length,
    );
    // Only a `productionSafe` endpoint runs on the default live run, so only it files false bugs.
    const liveRisks = risks.filter((r) => r.runsLive);
    const gatedRisks = risks.filter((r) => !r.runsLive);
    const schemaOnly = rows.filter((r) => r.missingFromExample.length === 0);

    const lines = [
      '# Payload completeness audit',
      '',
      '**GENERATED — do not edit.** Written by `tests/framework/payload-audit.spec.ts`.',
      '',
      `**${liveRisks.length}** endpoints that run on live (\`productionSafe\`) omit a field present in`,
      'the documented request *example* — the actual false-bug queue, because only a live-running',
      'endpoint auto-files a bug. A further **' +
        String(gatedRisks.length) +
        '** example-missing endpoints are GATED writes (payload supplied by their lifecycle spec with',
      'runtime ids — not fuzzed on live), and **' +
        String(schemaOnly.length) +
        '** omit only *schema-declared* fields with no example (mostly the admin entity DTO — the',
      'springdoc schema lists every optional field; the measured frontend sends a subset).',
      '',
      '## A — Runs on live AND omits an example field (the false-bug queue)',
      '',
      liveRisks.length === 0
        ? '_None — every live-running endpoint sends every documented-example field._'
        : '',
      ...(liveRisks.length
        ? [
            '| Write? | Endpoint | Fields in the example but not sent |',
            '| ------ | -------- | ---------------------------------- |',
            ...liveRisks.map(
              (r) =>
                `| ${r.destructive ? 'WRITE' : 'read'} | \`${r.method} ${r.path}\` (\`${r.id}\`) | ${r.missingFromExample.join(', ')} |`,
            ),
          ]
        : []),
      '',
      '## B — Not run on the default live run (gated writes + needs-id reads) omitting an example field',
      '',
      'These never execute on the default live run (the production guard blocks a destructive',
      'non-`productionSafe` endpoint, and a needs-id read has no live-safe input), so they cannot',
      'auto-file a bug. Their real payload — with runtime ids — is built by the endpoint’s lifecycle',
      'spec (`*_LIFECYCLE`), not by the static factory audited here.',
      '',
      '| Endpoint | Fields in the example but not sent |',
      '| -------- | ---------------------------------- |',
      ...gatedRisks.map(
        (r) => `| \`${r.method} ${r.path}\` (\`${r.id}\`) | ${r.missingFromExample.join(', ')} |`,
      ),
      '',
      '## C — Missing from the schema only (no example — review, usually correct)',
      '',
      '| Endpoint | Schema-only fields not sent |',
      '| -------- | --------------------------- |',
      ...schemaOnly.map(
        (r) => `| \`${r.method} ${r.path}\` (\`${r.id}\`) | ${r.missingFromSchema.join(', ')} |`,
      ),
      '',
    ];
    fs.writeFileSync(
      path.join(ROOT_DIR, 'docs', 'generated', 'payload-audit.md'),
      `${lines.join('\n')}\n`,
    );

    console.log(
      `PAYLOAD AUDIT: ${liveRisks.length} live+example-missing (fix), ${gatedRisks.length} gated, ${schemaOnly.length} schema-only. See docs/generated/payload-audit.md`,
    );
    for (const r of liveRisks)
      console.log(`  LIVE RISK  ${r.id}: ${r.missingFromExample.join(', ')}`);

    // Tier 1: a live-running endpoint must send every example field or be in LIVE_OMISSIONS.
    const liveUnaccounted = liveRisks.filter((r) => !(r.id in LIVE_OMISSIONS));
    expect(
      liveUnaccounted.map((r) => `${r.id}: missing ${r.missingFromExample.join(', ')}`),
      'a productionSafe endpoint under-sends a documented-example field (false-bug risk) — complete its payload or record it in LIVE_OMISSIONS',
    ).toEqual([]);

    // Tier 2: every gated omission must be recorded in GATED_WRITE_OMISSIONS with its reason.
    const gatedUnaccounted = gatedRisks.filter((r) => !(r.id in GATED_WRITE_OMISSIONS));
    expect(
      gatedUnaccounted.map((r) => `${r.id}: missing ${r.missingFromExample.join(', ')}`),
      'a gated write/read omits a documented-example field with no recorded reason — a wrong/incomplete write payload can contaminate other endpoints via the shared DB (§3); complete it or record why the field is runtime/lifecycle-supplied in GATED_WRITE_OMISSIONS',
    ).toEqual([]);

    // An allowlist entry that no longer names a current risk is stale.
    const currentRiskIds = new Set(risks.map((r) => r.id));
    const staleAllowlisted = [
      ...Object.keys(LIVE_OMISSIONS),
      ...Object.keys(GATED_WRITE_OMISSIONS),
    ].filter((id) => !currentRiskIds.has(id));
    expect(
      staleAllowlisted,
      'a payload-omission allowlist names an endpoint that no longer under-sends — remove the stale entry',
    ).toEqual([]);
  });
});
