import fs from 'node:fs';
import path from 'node:path';
import { apiRegistry } from '@api/definitions/index';
import type { EndpointDefinition } from '@api/registry/endpoint-definition';
import { ROOT_DIR } from '@config/constants';
import { defaultedIdentityFields } from '@config/test-data.config';
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
    return `OTP — ${detail}`;
  }
  if (definition.productionSafe) return undefined;
  if (definition.sideEffect === 'global') {
    return 'writes state shared by other users of the live application';
  }
  if (definition.sideEffect === 'external') return 'sends a real SMS or email';
  if (definition.destructive) return 'writes or deletes on the live application';
  return 'not cleared: needs a business account or company we do not have on live yet';
}

function moduleOf(definition: EndpointDefinition): string {
  const tags = definition.tags ?? [];
  if (tags.includes('signup-login')) return 'Signup & Login';
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
      `Target: the live application (\`devapi2.kpostindia.com\`). Scope: **PERSONAL** accounts only —`,
      'no business account exists on live yet.',
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
      `Identity values still unset: ${
        defaultedIdentityFields().length
          ? defaultedIdentityFields().join(', ')
          : 'none — every identifier is configured'
      }.`,
      '',
    ];

    const outPath = path.join(ROOT_DIR, 'docs', 'LIVE-ENDPOINTS.md');
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, `${lines.join('\n')}\n`);

    // Every endpoint lands in exactly one list, so the file can never omit one silently.
    expect(runs.length + blocked.length, 'every endpoint is classified').toBe(all.length);
    expect(
      runs.length,
      'at least one endpoint must run on live, or the scope is empty',
    ).toBeGreaterThan(0);
  });

  test('every live-cleared endpoint is a read that owns nothing', () => {
    /*
     * `productionSafe` is a human claim, and this is the part of it a machine can check: a cleared
     * endpoint must not be destructive and must not carry a side effect beyond its own request.
     * The rest of the claim — "uses only identifiers we own" — is enforced at runtime by the
     * QA-identifier guard, which sees the built payload rather than the definition.
     */
    const unsafe = apiRegistry
      .all()
      .filter(
        (d: EndpointDefinition) =>
          d.productionSafe && (d.destructive === true || (d.sideEffect ?? 'data') !== 'data'),
      )
      .map(
        (d: EndpointDefinition) => `${d.id} (destructive=${d.destructive}, side=${d.sideEffect})`,
      );

    expect(unsafe, 'a cleared endpoint must not write, send or change shared state').toEqual([]);
  });

  test('no OTP-dependent endpoint is cleared for live', () => {
    const contradictory = apiRegistry
      .all()
      .filter((d: EndpointDefinition) => d.productionSafe && d.otpDependent)
      .map((d: EndpointDefinition) => d.id);

    expect(contradictory, 'OTP endpoints cannot run on live, cleared or not').toEqual([]);
  });
});
