// This spec GENERATES docs/LIVE-ENDPOINTS.md, so the "conditionals" it is flagged for are string
// and data formatting (a table cell, a summary line, a filter), not branches guarding an assertion.
/* eslint-disable playwright/no-conditional-in-test */
import fs from 'node:fs';
import path from 'node:path';
import { apiRegistry } from '@api/definitions/index';
import type { EndpointDefinition } from '@api/registry/endpoint-definition';
import { ROOT_DIR } from '@config/constants';
import { defaultedIdentityFields } from '@config/test-data.config';
import { resolveEndpoint } from '@engine/validation-policy';
import { expect, test } from '@fixtures';

/**
 * Writes **the** endpoint reference: what runs against the live application and what does not.
 *
 * Generated from the definitions rather than maintained by hand, because a hand-written list of 46
 * endpoints is wrong within a week and then actively misleads — somebody reads "blocked" for an
 * endpoint that has since been cleared, or the reverse, which is worse.
 *
 * It is a test rather than a script so it can import the registry through the same path aliases the
 * bench uses, and so it fails if the reasons stop making sense. Run `npm run test:framework`.
 */

/** Why an endpoint does not run on live, in the order the reasons take effect. */
function blockedReason(definition: EndpointDefinition): string | undefined {
  if (definition.otpDependent) {
    const detail = {
      sends: 'sends a real OTP by SMS/email to a real recipient',
      consumes: 'needs a real OTP in its payload; live has no bypass',
      requires: 'needs an OTP validated in an earlier step; live has no bypass',
    }[definition.otpDependent];
    return `OFF-LIVE (OTP): ${detail}`;
  }
  if (definition.productionSafe) return undefined;
  const p = definition.path;
  // Attachment/media reads keyed by a real S3 uuid — need a real file upload, which no lifecycle
  // does yet (the one genuine file-upload coverage gap). Not downloadCompanyLogo ({companyID}).
  if (
    /\/(download|downloadThumbnail|mediaStreaming)\/\{uuid\}|generateThumbnailUsingUUID/i.test(p)
  ) {
    return 'OFF-LIVE: needs a real uploaded attachment (S3 file upload) — the one file-upload gap';
  }
  if (definition.sideEffect === 'global') {
    return 'OFF-LIVE by choice: writes state shared by the whole environment (no self-cleaning lifecycle)';
  }
  if (definition.sideEffect === 'external') {
    return 'OFF-LIVE by choice: sends a real SMS or email to a real recipient';
  }
  if (definition.destructive) {
    // Public writes that persist a real shared record (enquiry / unsubscribe) have no lifecycle.
    if (/\/common\/save(Enquiry|Unsubscriber)/i.test(p)) {
      return 'OFF-LIVE by choice: persists a real shared record (enquiry / unsubscribe) — no self-cleaning lifecycle';
    }
    return 'COVERED via lifecycle: write/delete — driven on live by its module `*_LIFECYCLE` flow, self-cleaning';
  }
  const tags = definition.tags ?? [];
  // Reads keyed by a RUNTIME id — a message/call/group/attachment/mail/document id that only a
  // completed write produces. Detected by tag OR by a runtime-id path param. NOT a business-account
  // block: these are covered by the gated lifecycle flows that create the id first.
  const RUNTIME_ID_PATH = /\{(uuid|docId|sessionId|kmailID|msgID|eventID)\}/i;
  if (
    tags.some((tag) => /^needs-(message-id|kall-id|group|attachment)$/.test(tag)) ||
    RUNTIME_ID_PATH.test(definition.path)
  ) {
    return 'COVERED via lifecycle: read keyed by a runtime id (message / call / group / document) a write flow mints';
  }
  // The admin reporting/location reads keyed by a runtime ObjectId a create mints (covered by the
  // admin lifecycle, not a business-account block).
  if (
    /getLocation|getLocationById|Reporting\w*Hierarchy|RolePostingByCompanyIdAndEmployeeId/.test(
      definition.path,
    )
  ) {
    return 'COVERED via admin lifecycle: read keyed by a runtime ObjectId the create-sequence mints';
  }
  // KMail reads that need a real mail/kmailID (the id is in the body, not the path) — covered by the
  // KMail lifecycle, not a business-account block.
  if (/readMail|kmailGroupReadStatus|replyNotRequired|bulkMail\/status/.test(definition.path)) {
    return 'COVERED via KMail lifecycle: read keyed by a real mail / kmailID a send flow mints';
  }
  return 'OFF-LIVE: read needs setup we do not have (business-tier login answers 403; company logo 500s)';
}

/** Split the blocked set: truly not driven on live vs covered on live by a gated lifecycle. */
function isTrulyOffLive(reason: string): boolean {
  return reason.startsWith('OFF-LIVE');
}

function moduleOf(definition: EndpointDefinition): string {
  const tags = definition.tags ?? [];
  if (tags.includes('admin-api')) return 'Admin';
  if (tags.includes('signup-login')) return 'Login & session';
  if (tags.includes('katchup')) return 'Katchup';
  if (tags.includes('kall')) return 'Kall';
  if (tags.includes('contacts')) return 'Contacts';
  if (tags.includes('settings')) return 'Settings';
  if (tags.includes('kdiary')) return 'KDiary';
  if (tags.includes('kos')) return 'KOS';
  if (tags.includes('aws')) return 'AWS';
  if (tags.includes('kmail')) return 'KMail';
  if (tags.includes('profile')) return 'Profile';
  if (tags.includes('group')) return 'Group';
  if (tags.includes('common-company')) return 'common · company';
  if (tags.includes('common')) return 'common';
  return 'other';
}

test.describe('live endpoint coverage @framework', () => {
  test('write docs/LIVE-ENDPOINTS.md from the definitions', () => {
    const all = apiRegistry
      .all()
      .filter((definition: EndpointDefinition) => !definition.mockFixture)
      .sort(
        (a: EndpointDefinition, b: EndpointDefinition) =>
          moduleOf(a).localeCompare(moduleOf(b)) || a.path.localeCompare(b.path),
      );

    const unset = defaultedIdentityFields();
    const unsetIdentitySummary = unset.length
      ? unset.join(', ')
      : 'none — every identifier is configured';

    const runs = all.filter((d: EndpointDefinition) => !blockedReason(d));
    const blocked = all.filter((d: EndpointDefinition) => blockedReason(d));

    const row = (d: EndpointDefinition, reason?: string): string =>
      `| \`${d.method}\` | \`${d.path}\` | ${moduleOf(d)} |${reason ? ` ${reason} |` : ''}`;

    const lines = [
      '# Live endpoints — what we can and cannot test',
      '',
      '**GENERATED — do not edit.** Written by `tests/framework/live-coverage.spec.ts`',
      '(`npm run test:framework`). Edit the endpoint definitions, not this file.',
      '',
      `Target: the live application (\`devapi2.kpostindia.com\`). Scope: PERSONAL accounts plus the`,
      'BUSINESS_S/M/L company accounts (company reads + user-management now run on live).',
      'A clear per-reason list of what stays blocked is in `docs/BLOCKED-ENDPOINTS.md`.',
      '',
      '| | Count |',
      '| - | ----: |',
      `| **Runs on live** | **${runs.length}** |`,
      `| Blocked | ${blocked.length} |`,
      `| Total registered | ${all.length} |`,
      '',
      '---',
      '',
      `## Runs on live — ${runs.length}`,
      '',
      'Every one is read-only, needs no company, and uses identifiers that are set in `.env`.',
      'Reaching this list requires `productionSafe: true` on the definition, which is a claim a',
      'reviewer can check against the comment beside it.',
      '',
      '| Method | Path | Module |',
      '| ------ | ---- | ------ |',
      ...runs.map((d: EndpointDefinition) => row(d)),
      '',
      '---',
      '',
      `## Blocked on live — ${blocked.length}`,
      '',
      'Not failures — these are refused before a request is sent, each for a stated reason.',
      '',
      '| Method | Path | Module | Why |',
      '| ------ | ---- | ------ | --- |',
      ...blocked.map((d: EndpointDefinition) => row(d, blockedReason(d))),
      '',
      '---',
      '',
      '## What unblocks the rest',
      '',
      '**A business account on live** unblocks the company lookups and the business-tier login.',
      'They are blocked today because `QA_COMPANY_ID`, `QA_UNIQUE_NAME` and the business ids are',
      'deliberately unset: an unset identifier is absent from the QA-identifier guard’s allowlist,',
      'so anything naming a company is refused. That is the scope enforcing itself rather than',
      'depending on anyone remembering.',
      '',
      '**Nothing unblocks the OTP endpoints.** Live has no bypass, and it must not have one — a',
      'fixed OTP that always validates is an account-takeover key. They stay blocked permanently.',
      '',
      '**The destructive endpoints stay blocked by choice**, not by limitation: `updateFlutterAppVersion`',
      'changes what every mobile client is told to install, `saveEnquiryDetails` writes into a real',
      'sales table, and the logo trio acts on a company id taken from the payload rather than the',
      'token. Running them needs a decision, not a flag.',
      '',
      `Identity values still unset: ${unsetIdentitySummary}.`,
      '',
    ];

    const outPath = path.join(ROOT_DIR, 'docs', 'LIVE-ENDPOINTS.md');
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, `${lines.join('\n')}\n`);

    // This file lists ONLY the endpoints NOT tested on the live application. The other blocked
    // endpoints (writes + runtime-id reads) ARE tested on live via the gated lifecycle flows, so they
    // are deliberately excluded here — listing them would misrepresent them as untested.
    const coveredCount = blocked.filter((d) => !isTrulyOffLive(blockedReason(d) ?? '')).length;
    const offLive = blocked.filter((d) => isTrulyOffLive(blockedReason(d) ?? ''));

    // A short category label for the count table (derived from the reason).
    const category = (d: EndpointDefinition): string => {
      const r = blockedReason(d) ?? '';
      if (r.includes('OTP')) return 'OTP — no bypass on live (permanent)';
      if (r.includes('uploaded attachment'))
        return 'Attachment file-upload — the one REAL coverage gap';
      if (r.includes('SMS or email')) return 'Real SMS / email to a real recipient';
      if (r.includes('shared record')) return 'Public record write (enquiry / unsubscribe)';
      if (r.includes('shared by the whole environment')) return 'Shared / global write (by choice)';
      return 'Needs setup we lack (business login 403, company logo 500)';
    };
    const catCounts = new Map<string, number>();
    for (const d of offLive) catCounts.set(category(d), (catCounts.get(category(d)) ?? 0) + 1);

    const stripReason = (d: EndpointDefinition): string =>
      (blockedReason(d) ?? '').replace(/^OFF-LIVE[^:]*:\s*/, '');

    const modules = new Map<string, EndpointDefinition[]>();
    for (const d of offLive) modules.set(moduleOf(d), [...(modules.get(moduleOf(d)) ?? []), d]);

    const blockedLines = [
      '# Endpoints NOT tested on the live application',
      '',
      '**GENERATED — do not edit.** Written by `tests/framework/live-coverage.spec.ts`.',
      '',
      `**${offLive.length} of ${all.length}** registered endpoints are **not driven against the live app**.`,
      `The rest ARE tested on live: **${runs.length}** on the default run + **${coveredCount}** via the`,
      'gated self-cleaning lifecycle flows (`npm run kpost:file`). This file lists ONLY the not-tested.',
      '',
      'They are not silent gaps — each is refused for a permanent constraint or a deliberate safety',
      'choice, and every one is still contract-validated OFF live.',
      '',
      '## Count by category',
      '',
      '| Category | Count |',
      '| -------- | ----: |',
      ...[...catCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([cat, n]) => `| ${cat} | ${n} |`),
      `| **Total not tested on live** | **${offLive.length}** |`,
      '',
      '---',
      '',
      '## The endpoints, module by module',
      '',
      ...[...modules.entries()]
        .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
        .flatMap(([module, eps]) => [
          `### ${module} (${eps.length})`,
          '',
          '| Method | Path | Why not tested on live |',
          '| ------ | ---- | ---------------------- |',
          ...eps
            .slice()
            .sort((a, b) => a.path.localeCompare(b.path))
            .map((d) => `| \`${d.method}\` | \`${d.path}\` | ${stripReason(d)} |`),
          '',
        ]),
    ];
    fs.writeFileSync(
      path.join(ROOT_DIR, 'docs', 'BLOCKED-ENDPOINTS.md'),
      `${blockedLines.join('\n')}\n`,
    );

    // Every endpoint lands in exactly one list, so the file can never omit one silently.
    expect(runs.length + blocked.length, 'every endpoint is classified').toBe(all.length);
    expect(
      runs.length,
      'at least one endpoint must run on live, or the scope is empty',
    ).toBeGreaterThan(0);
  });

  test('every live-cleared endpoint is a read, or a named write to our own state', () => {
    /*
     * `productionSafe` is a human claim, and this is the part of it a machine can check.
     *
     * No cleared endpoint may reach beyond its own request (`external` or `global`). A cleared
     * WRITE is allowed only by name, below, with the reason it touches nothing but our own state —
     * so widening the live scope to a new write is a visible, reviewable change to this list rather
     * than a flag flipped in a definition nobody re-reads. The rest of the claim — "uses only
     * identifiers we own" — is enforced at runtime by the QA-identifier guard.
     */
    const LIVE_OWN_WRITES: Record<string, string> = {
      'signup-login-user-logout':
        'ends only the session whose token and device it is sent with — one the test opened',
    };

    const unsafe = apiRegistry
      .all()
      .filter((d: EndpointDefinition) => d.productionSafe && !d.mockFixture)
      .filter(
        (d: EndpointDefinition) =>
          (d.sideEffect ?? 'data') !== 'data' || (d.destructive === true && !LIVE_OWN_WRITES[d.id]),
      )
      .map(
        (d: EndpointDefinition) => `${d.id} (destructive=${d.destructive}, side=${d.sideEffect})`,
      );

    expect(
      unsafe,
      'a cleared endpoint must not send or change shared state, and a cleared write must be named',
    ).toEqual([]);
  });

  test('no OTP-dependent endpoint is cleared for live', () => {
    const contradictory = apiRegistry
      .all()
      .filter((d: EndpointDefinition) => d.productionSafe && d.otpDependent)
      .map((d: EndpointDefinition) => d.id);

    expect(contradictory, 'OTP endpoints cannot run on live, cleared or not').toEqual([]);
  });

  test('a cleared READ does not resolve to destructive (or grepInvert drops it on live)', () => {
    /*
     * `destructive` defaults to true for POST/PUT/PATCH/DELETE. A cleared endpoint that is a read
     * but forgets `destructive: false` therefore RESOLVES to destructive, gets the `@destructive`
     * test tag, and is silently removed by the production `grepInvert` — the whole endpoint collects
     * zero engine tests while every other check passes. (The dashboard POST reads hit exactly this.)
     *
     * The intentional cleared writes (userLogout) run through a flow, not `describeEndpointCases`,
     * and are exempt by name here — the same list the test above uses.
     */
    const LIVE_CLEARED_WRITES = new Set(['signup-login-user-logout']);
    const dropped = apiRegistry
      .all()
      .filter((d: EndpointDefinition) => d.productionSafe && !d.mockFixture)
      .filter((d: EndpointDefinition) => !LIVE_CLEARED_WRITES.has(d.id))
      .filter((d: EndpointDefinition) => resolveEndpoint(d).destructive)
      .map((d: EndpointDefinition) => d.id);

    expect(
      dropped,
      'these are productionSafe reads that resolve to destructive — add `destructive: false`',
    ).toEqual([]);
  });
});
