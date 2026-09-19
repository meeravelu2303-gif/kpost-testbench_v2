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
 * Payload completeness audit — the answer to "does the bench send every field the contract documents?".
 *
 * A hardcoded partial request files a FALSE bug: the API validates the missing field and answers an
 * error the bench reads as a product defect (the KMail signature endpoints did exactly this). This
 * spec builds each endpoint's real request body from its own factory and compares its keys against the
 * documented request fields, splitting "missing" into two classes so the real risk stands out:
 *
 *   - **missing-from-EXAMPLE** — the field appears in the documented request *example* (the payload
 *     the product actually sends). This is the KMail-signature class: a real false-bug risk, because
 *     the API expects it and validates its absence.
 *   - **missing-from-SCHEMA-only** — the field is a property of the request schema but not in any
 *     example. On the admin surface the springdoc schema lists the *whole entity DTO* (every optional
 *     field); the frontend, measured, sends a subset. Omitting these is correct, not a defect.
 *
 * It writes `docs/PAYLOAD-AUDIT.md`. The example-missing column is the queue to fix.
 */

// A stub `call` for the static audit — it never chains to a real endpoint, so an empty object is
// returned for whatever type a factory expects (cast because `call` is generic in its return type).
const STUB: RequestFactoryHelpers = {
  call: (() => Promise.resolve({})) as RequestFactoryHelpers['call'],
  tenantId: 'qa-audit',
};

/**
 * `productionSafe` endpoints that run on the default live run yet legitimately omit a
 * documented-example field, each with the reason. The guard asserts this stays EMPTY unless a real
 * exception is recorded — a live-running endpoint that under-sends auto-files a false bug.
 * (Currently empty: every live-running endpoint sends every documented-example field.)
 */
const LIVE_OMISSIONS: Record<string, string> = {};

/**
 * GATED writes / needs-id reads that omit a documented-example field for a REAL, recorded reason.
 *
 * Why this must be exhaustive — the contamination rule (CLAUDE.md §3): KPost runs on a **shared
 * monolithic database with circular module dependencies**, so a wrong or incomplete payload sent to
 * ONE write can persist bad data that a DIFFERENT endpoint later reads — the failure then surfaces
 * somewhere else entirely and looks like that endpoint's bug. A write's payload is therefore
 * safety-critical, not cosmetic. So every gated omission is accounted for here: the field is supplied
 * at RUNTIME by the endpoint's `*_LIFECYCLE` spec (a real msgID/ObjectId/draftID a fabricated value
 * cannot replace), or the authoritative frontend client deliberately does NOT send the stale
 * workbook-example field (adding it back is what a wrong payload looks like — see `recall`). A new
 * gated write that omits an example field fails the guard until it is completed or recorded here, so
 * a wrong/incomplete write payload can never reach the bench unexamined.
 */
const GATED_WRITE_OMISSIONS: Record<string, string> = {
  // The workbook example documents `sendDate`, but the owner-verified WORKING live curl (2026-09-19)
  // sends { otp, countryID, mobileNumber } WITHOUT it — a `sendDate: Date.now()` epoch pushed the API
  // into a failure path that answered 500. Deliberately omitted to match the real, working contract.
  'common-validate-otp':
    'workbook `sendDate` omitted — the working live curl does not send it (a sendDate epoch 500s)',
  'common-validate-mail-otp': 'workbook `sendDate` omitted — matches the working validateOTP shape',
  // Katchup forwards/bulk — the reference-message object + source msgIDs are minted by the running
  // conversation and supplied by the KATCHUP_LIFECYCLE spec; a static value would be a fabricated id.
  'katchup-forward-message':
    'referenceMessage + source msgIDs supplied at runtime by the katchup lifecycle',
  'katchup-forward-message-new':
    'referenceMessage + source msgIDs supplied at runtime by the katchup lifecycle',
  'katchup-send-forward-selected-attachment':
    'referenceMessage + attachment uuid + msgIDs supplied at runtime by the katchup lifecycle',
  'katchup-forward-multiple':
    'forwardMessageIDList + uuid supplied at runtime by the katchup lifecycle',
  'katchup-send-bulk': 'mapDetails (per-recipient) supplied at runtime by the katchup lifecycle',
  'katchup-messages-by-reference':
    'read keyed by a runtime referenceMessageID list a send flow mints',
  // Deliberate: the authoritative live client sends {msgID, groupFlag}; the workbook `status:5` is
  // stale AND not a valid katchupStatus. Adding it back would be the wrong payload.
  'katchup-recall-message':
    'frontend sends {msgID, groupFlag}; workbook `status` is stale/invalid — deliberately omitted',
  // Admin company/member writes are sideEffect:global — blocked on live in EVERY mode (the guard
  // clears only `data` writes via allowLiveWrite), contract-validated off-live only, never driven on
  // live. A real payload would be built by an authorized admin flow; the placeholder cannot contaminate.
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
  // Gated data-writes/needs-id reads: the missing fields are runtime ids/optional values the
  // lifecycle spec fills, self-cleaning on our own QA records only.
  'profile-update-contact':
    'gated PROFILE_LIFECYCLE, self-restoring; optional contact fields (addressLine2/alternateMobile/landline)',
  'common-save-enquiry-details': 'public write, off-live only; optional `timeToContact`',
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
    const endpoints = apiRegistry.all().filter((d: EndpointDefinition) => !d.mockFixture);
    const rows: AuditRow[] = [];

    for (const d of endpoints) {
      let spec: RequestSpec;
      try {
        spec = d.request ? await d.request(STUB) : {};
      } catch {
        continue; // a factory that needs a live `call()` — skip in the static audit
      }
      // Multipart carries its fields in a `text` JSON part, not `body` — audited separately, skip.
      if (spec.multipart) continue;
      // A GET has no request body, so a documented (POST-era) example body does not describe fields
      // it should send — its identity rides in the token and its args in the path/query. Comparing
      // a GET against a stale POST example false-flags it (e.g. the method-corrected fetchUserDetails).
      if (d.method === 'GET') continue;
      // A field is "sent" whether it rides in the body, the query string or a path param. Compare
      // case-insensitively: the workbook and the working client sometimes differ only in casing
      // (`deviceIdentity_Primary` vs `deviceIdentity_primary`), and the client is authoritative.
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
    // The decisive filter: only a `productionSafe` endpoint runs on the default live run, so only
    // it can auto-file a false bug from a missing field. A gated write's payload is supplied by its
    // own lifecycle spec (with runtime ids), and is never fuzzed on live by the engine.
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
    fs.writeFileSync(path.join(ROOT_DIR, 'docs', 'PAYLOAD-AUDIT.md'), `${lines.join('\n')}\n`);

    console.log(
      `PAYLOAD AUDIT: ${liveRisks.length} live+example-missing (fix), ${gatedRisks.length} gated, ${schemaOnly.length} schema-only. See docs/PAYLOAD-AUDIT.md`,
    );
    for (const r of liveRisks)
      console.log(`  LIVE RISK  ${r.id}: ${r.missingFromExample.join(', ')}`);

    // The regression guard, in two tiers, so NO payload gap — read or write — can pass unexamined.
    //
    // Tier 1 — live false-bug risk. A `productionSafe` endpoint runs on the default live run, so one
    // that omits a documented-example field is the exact shape that filed the KMail-signature false
    // bug. It must send the field or be recorded in LIVE_OMISSIONS.
    const liveUnaccounted = liveRisks.filter((r) => !(r.id in LIVE_OMISSIONS));
    expect(
      liveUnaccounted.map((r) => `${r.id}: missing ${r.missingFromExample.join(', ')}`),
      'a productionSafe endpoint under-sends a documented-example field (false-bug risk) — complete its payload or record it in LIVE_OMISSIONS',
    ).toEqual([]);

    // Tier 2 — contamination risk (CLAUDE.md §3). A gated WRITE with a wrong/incomplete payload can
    // persist bad data the shared DB then serves to OTHER endpoints. So every gated omission must be
    // recorded in GATED_WRITE_OMISSIONS with the reason it is safe (runtime/lifecycle-supplied, or a
    // deliberate frontend-authoritative omission). A new one fails here until it is examined.
    const gatedUnaccounted = gatedRisks.filter((r) => !(r.id in GATED_WRITE_OMISSIONS));
    expect(
      gatedUnaccounted.map((r) => `${r.id}: missing ${r.missingFromExample.join(', ')}`),
      'a gated write/read omits a documented-example field with no recorded reason — a wrong/incomplete write payload can contaminate other endpoints via the shared DB (§3); complete it or record why the field is runtime/lifecycle-supplied in GATED_WRITE_OMISSIONS',
    ).toEqual([]);

    // Keep the allowlists honest: an entry that no longer names a current risk is stale and must be
    // removed, so the recorded reasons cannot rot into a list nobody has revisited.
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
