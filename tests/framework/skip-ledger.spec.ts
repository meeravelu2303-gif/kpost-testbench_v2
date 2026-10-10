// This spec GENERATES docs/generated/skips.md from a static scan, so its branching is string work.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT_DIR } from '@config/constants';
import { expect, test } from '@fixtures';

/**
 * THE skip ledger — every `test.skip(...)` / `test.fixme(...)` reason in the suite, classified.
 *
 * ## Why
 *
 * A skip looks like a pass in a summary line. Found 2026-10-10: a User Management test had skipped on
 * every run for weeks because a placeholder changed, and seven business-tier UI specs can never run
 * under the product command. Nobody could see either from the report. This ledger makes every skip
 * reason visible, puts it in one of four classes, and **fails the build on a reason it cannot
 * classify**, so a new skip has to say honestly which kind it is.
 *
 * ## The classes (`docs/reference/production-readiness-plan.md`, Phase 1)
 *
 *  - `provision`      needs an account, a database connection, a host or a secret the machine lacks
 *  - `owner-decision` gated behind a `*_LIFECYCLE` flag, a pause, or a safety choice the owner made
 *  - `live-condition` the application genuinely had nothing to test this run (no data, a collision)
 *  - `retune`         "did not open on this build — needs a re-tune": a selector that no longer matches
 *                     OR a real defect — today the report cannot tell. Phase 1 drives this class to 0;
 *                     after that it becomes a failure, not a skip.
 *
 * Generated to `docs/generated/skips.md`, never hand-kept.
 */

type SkipClass =
  'retune' | 'defect' | 'owner-decision' | 'provision' | 'live-condition' | 'no-reason';

/**
 * Order matters: the first matching class wins. Each pattern is tried against the reason text first
 * and, when that does not settle it, against the whole `test.skip(...)` argument list (so a
 * `test.skip(process.env.KALL_LIFECYCLE !== 'true')` with no reason string still classifies).
 */
const CLASSIFIERS: Array<{ cls: SkipClass; pattern: RegExp }> = [
  {
    cls: 'retune',
    pattern:
      /did not (open|render|enable|reach|appear|complete)|needs a (codegen )?re-tune|not present in this (editor )?build|(?<!unavailable on )this build|not reachable in this build|could not read a real|no .* found to click|never mounted|did not exist on this host|share the .* selector|not reachable (on this tab|this run)/i,
  },
  {
    cls: 'defect',
    pattern:
      /#\d{3,}|blocked on|currently (500|400|404|returns)|500 for every|for every (account|caller)|Dev-confirmed|not in use|intentionally unavailable|did not return a|could not get the created|known (defect|bug|regression)|still (broken|500s|fails)|see .* defects?|did not send/i,
  },
  {
    cls: 'owner-decision',
    pattern:
      /_LIFECYCLE|LIFECYCLE|paused|PAUSED|owner('s)? (sign-off|authori[sz]ation|says|PDF|directive)|only meaningful when TEST_ENV|TEST_ENV=production|non-production environment|ALLOW_DESTRUCTIVE|CONCURRENCY|WRITE_FUZZ|TEST_DB_MODE|sends? (a )?real|places a real|writes real|provisions a real|OTP_TEST_GATEWAY|forgot-password lives on the (live|real)|deliberate|by (design|choice)|sideEffect|PERMANENT|production-guard|never cleared for live|not run standalone|out of scope|live-verified|documented in the .*workbook|definition (explicitly )?says|set [A-Z_]+=true|needs explicit authori[sz]ation|session.?destroyer|not testable here|needs its own OTP flow|metered|real third-party|unconfirmed sandbox|real \d+-minute wait|opt-in/i,
  },
  {
    cls: 'provision',
    pattern:
      /needs the KPOST_QA|connection|needs (both|two|three|the|a) .{0,40}?(principals?|accounts?|password)|qa\.bench needs|principals? configured|no KPost principal|needs QA_|QA_[A-Z0-9_]+|needs a real live account|needs the BUSINESS|needs provisioned|spare account|known current password|not configured|no local \.env|BASE_URL|API key|credentials|account registry|from the registry|legacy reference account|no finding supplied|needs the admin|needs an admin|AuthGate|authGate|Gate\(\)|account'?s role|role value|at least (one|two|three) .{0,30}accounts?|BUGZILLA_|snapshot found/i,
  },
  {
    cls: 'live-condition',
    pattern:
      /right now|nothing to (test|click|check|attack)|happened to collide|collided|re-run$|rejected this run|was not created|no .* (on this target|on this account|to attack|to check against|to set|to click into)|absent from this target|no message history|returned no|is empty|already (exists|present|registered|taken)|is taken|set a fresh|throttl|429|rate.?limit|needs the .* (sent|created|from) (by|in|the) .*step|from the first step|from the previous step|failed \(replied|replied …|no .* (was )?available/i,
  },
];

interface SkipSite {
  file: string;
  line: number;
  reason: string;
  cls: SkipClass | 'unclassified';
  dynamic: boolean;
}

/** Literals that are part of the condition, never the reason (`process.env.X !== 'true'`). */
const NOT_A_REASON = new Set(['true', 'false', 'production', 'test', '1', '0']);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(spec|setup)\.ts$/.test(entry.name) && !/skip-ledger\.spec\.ts$/.test(entry.name))
      out.push(full);
  }
  return out;
}

/**
 * The reason text of a `test.skip(...)`: every string literal in the argument list, joined (reasons
 * are often concatenated across lines), minus the literals that belong to the condition. A skip with
 * no literal at all is reported as such — the caller classifies it from the condition instead.
 */
function reasonOf(args: string): { reason: string; dynamic: boolean; hasLiteral: boolean } {
  const literals = [
    ...args.matchAll(/'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g),
  ]
    .map((m) => m[1] ?? m[2] ?? m[3] ?? '')
    .filter((s) => s.length > 0 && !NOT_A_REASON.has(s));
  if (literals.length === 0) {
    if (/accounts\.reason|\.reason\b/.test(args)) {
      return {
        reason: 'account registry says which role is missing (requireAll)',
        dynamic: true,
        hasLiteral: false,
      };
    }
    return {
      reason: `(no reason string) ${args.replace(/\s+/g, ' ').trim().slice(0, 80)}`,
      dynamic: true,
      hasLiteral: false,
    };
  }
  const reason = literals.join(' ').replace(/\s+/g, ' ');
  return {
    reason: reason.replace(/\$\{[^}]*\}/g, '…'),
    dynamic: /\$\{/.test(reason),
    hasLiteral: true,
  };
}

function classify(reason: string, args: string, hasLiteral: boolean): SkipSite['cls'] {
  for (const { cls, pattern } of CLASSIFIERS) if (pattern.test(reason)) return cls;
  for (const { cls, pattern } of CLASSIFIERS) if (pattern.test(args)) return cls;
  return hasLiteral ? 'unclassified' : 'no-reason';
}

function scan(): SkipSite[] {
  const sites: SkipSite[] = [];
  for (const file of walk(path.join(ROOT_DIR, 'tests'))) {
    const text = fs.readFileSync(file, 'utf8');
    const rel = path.relative(ROOT_DIR, file).replace(/\\/g, '/');
    for (const m of text.matchAll(/test\.(?:skip|fixme)\(([\s\S]*?)\);/g)) {
      // A mention inside a comment (`// ... test.skip(true, reason) ...`) is not a skip site.
      const lineStart = text.lastIndexOf('\n', m.index ?? 0) + 1;
      const prefix = text.slice(lineStart, m.index).trimStart();
      if (prefix.startsWith('//') || prefix.startsWith('*') || prefix.startsWith('/*')) continue;
      const args = m[1] ?? '';
      const { reason, dynamic, hasLiteral } = reasonOf(args);
      const line = text.slice(0, m.index).split('\n').length;
      sites.push({ file: rel, line, reason, dynamic, cls: classify(reason, args, hasLiteral) });
    }
  }
  return sites;
}

function lastRunSkips(): string[] {
  const file = path.join(ROOT_DIR, 'reports', 'REPORT.json');
  if (!fs.existsSync(file)) return ['_No `reports/REPORT.json` on this machine._'];
  try {
    // Strip a UTF-8 byte-order mark (PowerShell writes one); JSON.parse refuses it.
    const bom = new RegExp(`^${String.fromCharCode(0xfeff)}`);
    const report = JSON.parse(fs.readFileSync(file, 'utf8').replace(bom, '')) as {
      meta?: { generatedAt?: string; testRunId?: string };
      api?: {
        checks?: { total?: number; skipped?: number };
        skips?: Record<string, number>;
        applicable?: { ran?: number; passRate?: number };
      };
    };
    const s = report.api?.skips;
    if (!s) return ['_The last report carries no API skip breakdown (UI-only run)._'];
    return [
      `Run \`${report.meta?.testRunId ?? '?'}\` at ${report.meta?.generatedAt ?? '?'}: ` +
        `${report.api?.checks?.total ?? '?'} checks, ${report.api?.applicable?.ran ?? '?'} applicable ran ` +
        `(${report.api?.applicable?.passRate ?? '?'}% passed), ${report.api?.checks?.skipped ?? '?'} skipped:`,
      '',
      '| Engine skip class | Checks | Meaning |',
      '| ----------------- | -----: | ------- |',
      `| notApplicable | ${s.notApplicable ?? 0} | the validator does not apply to that endpoint (by design) |`,
      `| recoverable | ${s.recoverable ?? 0} | needs a fixture, an id or a second principal — a gap to close |`,
      `| blockedByDefect | ${s.blockedByDefect ?? 0} | an open defect stops the check from being meaningful |`,
      `| deliberate | ${s.deliberate ?? 0} | an owner pause or a safety choice |`,
      `| environmental | ${s.environmental ?? 0} | host or transport trouble this run |`,
    ];
  } catch {
    return ['_`reports/REPORT.json` could not be read._'];
  }
}

test.describe('skip ledger', () => {
  const sites = scan();

  test('write docs/generated/skips.md from a static scan of every spec', () => {
    const byClass = (cls: SkipSite['cls']) => sites.filter((s) => s.cls === cls);
    const classes: Array<[SkipSite['cls'], string]> = [
      [
        'retune',
        'Retune — a selector that no longer matches, or a defect; Phase 1 drives this to 0',
      ],
      ['defect', 'Blocked by a defect — an open bug stops the check from meaning anything'],
      ['provision', 'Provision — an account, connection, host or secret this machine lacks'],
      ['owner-decision', 'Owner decision — gated flows, pauses and safety choices'],
      ['live-condition', 'Live condition — the application had nothing to test this run'],
      [
        'no-reason',
        'No reason string — classified from the condition only; Phase 1 gives each one a reason',
      ],
      ['unclassified', 'Unclassified — must be 0 (the build fails otherwise)'],
    ];

    const lines: string[] = [
      '# Skip ledger — every skip reason in the suite, classified',
      '',
      '**GENERATED — do not edit.** Written by `tests/framework/skip-ledger.spec.ts`',
      '(`npm run test:framework`). Edit the specs, not this file.',
      '',
      'A skip is honest only when its reason says what kind of skip it is. Five classes a skip may',
      'be in, one it should not stay in (no reason string), and one that fails the build (unclassified).',
      'The plan: `docs/reference/production-readiness-plan.md`, Phase 1.',
      '',
      '| Class | Sites | Spec files |',
      '| ----- | ----: | ---------: |',
      ...classes.map(
        ([cls, label]) =>
          `| ${label.split(' — ')[0]} | ${byClass(cls).length} | ${new Set(byClass(cls).map((s) => s.file)).size} |`,
      ),
      `| **Total** | **${sites.length}** | **${new Set(sites.map((s) => s.file)).size}** |`,
      '',
      '## The last run, by the engine’s own skip classes',
      '',
      ...lastRunSkips(),
      '',
    ];

    for (const [cls, label] of classes) {
      const rows = byClass(cls);
      lines.push(`## ${label} (${rows.length})`, '');
      if (rows.length === 0) {
        lines.push('_None._', '');
        continue;
      }
      const grouped = new Map<string, SkipSite[]>();
      for (const r of rows) grouped.set(r.reason, [...(grouped.get(r.reason) ?? []), r]);
      lines.push('| Sites | Reason | Where |', '| ----: | ------ | ----- |');
      for (const [reason, group] of [...grouped.entries()].sort(
        (a, b) => b[1].length - a[1].length,
      )) {
        const where = [...new Set(group.map((g) => `${g.file}:${g.line}`))];
        const shown = where
          .slice(0, 4)
          .map((w) => `\`${w}\``)
          .join(', ');
        const more = where.length > 4 ? ` +${where.length - 4} more` : '';
        lines.push(`| ${group.length} | ${reason.replace(/\|/g, '\\|')} | ${shown}${more} |`);
      }
      lines.push('');
    }

    const outPath = path.join(ROOT_DIR, 'docs', 'generated', 'skips.md');
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, `${lines.join('\n')}\n`);

    test.info().annotations.push({
      type: 'skip-ledger',
      description: classes.map(([cls]) => `${cls}=${byClass(cls).length}`).join(' '),
    });
    expect(sites.length, 'the scan found the suite’s skips').toBeGreaterThan(0);
    expect(fs.existsSync(outPath), 'the ledger was written').toBe(true);
  });

  test('every skip reason belongs to a class', () => {
    const unknown = sites.filter((s) => s.cls === 'unclassified');
    expect(
      unknown.map((u) => `${u.file}:${u.line}  "${u.reason}"`),
      'a skip reason the ledger cannot classify — reword it so it says provision / owner decision / ' +
        'live condition, or (until Phase 1 closes) "did not open on this build"',
    ).toEqual([]);
  });
});
