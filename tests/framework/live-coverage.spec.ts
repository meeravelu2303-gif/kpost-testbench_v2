// Generates docs/generated/live-endpoints.md: its conditionals format strings, not assertions.

import { env } from '@config/env';
import fs from 'node:fs';
import path from 'node:path';
import { apiRegistry } from '@api/definitions/index';
import type { EndpointDefinition } from '@api/registry/endpoint-definition';
import { ROOT_DIR } from '@config/constants';
import { defaultedIdentityFields } from '@config/test-data.config';
import { resolveEndpoint } from '@engine/validation-policy';
import { expect, test } from '@fixtures';

/**
 * Writes the endpoint reference (what runs on live and what does not) from the definitions.
 * A test rather than a script so it shares the bench's path aliases. Run `npm run framework`.
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
    // No lifecycle flag drives blockTicket (a real third-party seat hold), so it is not "covered".
    if (definition.id === 'kbooking-block-ticket') {
      return "OFF-LIVE (WRITTEN, execution blocked): no env flag actually gates this (KBOOKING_LIFECYCLE is referenced only in comments) — unconditionally test.skip'd pending explicit owner authorization, not driven by any lifecycle flow";
    }
    return 'COVERED via lifecycle: write/delete — driven on live by its module `*_LIFECYCLE` flow, self-cleaning';
  }
  const tags = definition.tags ?? [];
  // Routes that 404 on this build: checked first, or the needs-id branch would claim them.
  if (/getKatchupMessagesSubject|\/kword\/documents\/$/.test(definition.path)) {
    return 'OFF-LIVE: route not deployed on this test build (confirmed 404 — needs the dev to confirm deployment, not a business-account gap)';
  }
  // Reads keyed by a runtime id a write mints (tag or path param): covered by lifecycle flows.
  const RUNTIME_ID_PATH = /\{(uuid|docId|sessionId|kmailID|msgID|eventID)\}/i;
  if (
    tags.some((tag) => /^needs-(id|message-id|kall-id|group|attachment)$/.test(tag)) ||
    RUNTIME_ID_PATH.test(definition.path)
  ) {
    return 'COVERED via lifecycle: read keyed by a runtime id (message / call / group / document) a write flow mints';
  }
  // Admin reporting/location reads keyed by a runtime ObjectId a create mints.
  if (
    /getLocation|getLocationById|Reporting\w*Hierarchy|RolePostingByCompanyIdAndEmployeeId/.test(
      definition.path,
    )
  ) {
    return 'COVERED via admin lifecycle: read keyed by a runtime ObjectId the create-sequence mints';
  }
  // KMail reads keyed by a real kmailID in the body, not the path.
  if (/readMail|kmailGroupReadStatus|replyNotRequired|bulkMail\/status/.test(definition.path)) {
    return 'COVERED via KMail lifecycle: read keyed by a real mail / kmailID a send flow mints';
  }
  if (/getKatchupMessagesSubject|\/kword\/documents\/$/.test(definition.path)) {
    return 'OFF-LIVE: route not deployed on this test build (confirmed 404 — needs the dev to confirm deployment, not a business-account gap)';
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
  test('write docs/generated/live-endpoints.md from the definitions', () => {
    const all = apiRegistry
      .all()

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
      '(`npm run framework`). Edit the endpoint definitions, not this file.',
      '',
      `Target: the test environment (\`${new URL(env.KPOST_API_BASE_URL ?? env.API_BASE_URL ?? 'http://unset.invalid').host}\`, from \`KPOST_API_BASE_URL\`). Scope: PERSONAL accounts plus the`,
      'BUSINESS_S/M/L company accounts (company reads + user-management now run on live).',
      'A clear per-reason list of what stays blocked is in `docs/generated/blocked-endpoints.md`.',
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

    const outPath = path.join(ROOT_DIR, 'docs', 'generated', 'live-endpoints.md');
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, `${lines.join('\n')}\n`);

    // blocked-endpoints.md lists only the not-tested; lifecycle-covered endpoints are excluded.
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
      if (r.includes('not deployed on this test build'))
        return 'Route not deployed on this test build (confirmed 404)';
      if (r.includes('WRITTEN, execution blocked'))
        return 'Written, execution blocked pending explicit owner authorization';
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
      'gated self-cleaning lifecycle flows (`npm run product:kpost-api:file`). This file lists ONLY the not-tested.',
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
      path.join(ROOT_DIR, 'docs', 'generated', 'blocked-endpoints.md'),
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
    // The checkable part of `productionSafe`: no external/global effect; writes by name only.
    const LIVE_OWN_WRITES: Record<string, string> = {
      'signup-login-user-logout':
        'ends only the session whose token and device it is sent with — one the test opened',
    };

    const unsafe = apiRegistry
      .all()
      .filter((d: EndpointDefinition) => d.productionSafe)
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
    // `destructive` defaults to true for POST, so a cleared read without `destructive: false` is
    // tagged `@destructive` and silently dropped on live. Named cleared writes run via a flow.
    const LIVE_CLEARED_WRITES = new Set(['signup-login-user-logout']);
    const dropped = apiRegistry
      .all()
      .filter((d: EndpointDefinition) => d.productionSafe)
      .filter((d: EndpointDefinition) => !LIVE_CLEARED_WRITES.has(d.id))
      .filter((d: EndpointDefinition) => resolveEndpoint(d).destructive)
      .map((d: EndpointDefinition) => d.id);

    expect(
      dropped,
      'these are productionSafe reads that resolve to destructive — add `destructive: false`',
    ).toEqual([]);
  });
});
