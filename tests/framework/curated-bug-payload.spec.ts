import { ROOT_DIR } from '@config/constants';
import { expect, test } from '@fixtures';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { buildBugFields, buildEvidenceAttachment } from '../../src/bug-tracker/bug-builder';
import {
  contextOf,
  findSecrets,
  manifestToCandidate,
  parseFilingManifest,
  type CuratedContext,
  type FilingManifest,
  type ManifestDefect,
} from '../../src/bug-tracker/curated/index';

/**
 * The curated filing PAYLOAD — proven against the structure of the tickets the original KPost
 * pipeline produced (KPA-490/491/492).
 *
 * ## What went wrong, and what this file exists to stop recurring
 *
 * The curated path used to render its own description and hand-write its own `createBug` payload.
 * It omitted `severity`, `priority`, `status_whiteboard` and the evidence attachment, so Bugzilla
 * supplied its own defaults and bugs 493–500 were filed as `severity: enhancement`, `priority: ---`
 * — eight confirmed defects, two of them unhandled NullPointerExceptions, sitting in a developer's
 * queue classified as enhancement REQUESTS. The forensic account is in
 * `reports/bugs/BUGZILLA-HISTORICAL-FILING-AUDIT.md`.
 *
 * A hand-written payload omits by silence, so the guard has to be on the payload rather than on the
 * intention. Every assertion below is about what would actually be SENT.
 *
 * ## The golden reference
 *
 * KPA-492, read from the live instance during the audit:
 *
 *     severity  major   ·   priority  High   ·   whiteboard  [cat:Functional]
 *     version   unspecified  ·  assigned_to  jagan@kpost.in  ·  1 evidence attachment
 *
 * Structural equivalence is the objective, not textual equality — the defects are different, so only
 * the mechanism can be compared.
 */

const MANIFEST = path.join(ROOT_DIR, 'reports', 'bugs', 'KPOST-API-FILING-MANIFEST.json');

/**
 * The anchors `buildDescription` emits and the BUGZILLA-UI front end parses.
 *
 * They are a contract, not formatting: the UI splits the description on exactly these labels to
 * render a structured report, and `verify-resolve.ts` reads `Representative endpoint:` back out to
 * decide what a systemic ticket may be auto-resolved against. The curated path's own format matched
 * neither consumer.
 */
const REQUIRED_ANCHORS = [
  'Classification:',
  'Category:',
  'Representative endpoint:',
  'Module:',
  'Expected:',
  'Actual:',
  'Repro:',
  'curl:',
  'Owner:',
  'Environment:',
  'Run date:',
  'Filed by:',
] as const;

/** Emitted only where `guidance.ts` has an entry for the validator — as on the original tickets. */
const GUIDANCE_ANCHORS = ['What this means:', 'Why it matters:', 'How to fix:'] as const;

const manifest: FilingManifest = parseFilingManifest(
  JSON.parse(readFileSync(MANIFEST, 'utf8')) as unknown,
  'KPOST-API-FILING-MANIFEST.json',
);
const context: CuratedContext = contextOf(manifest);

const payloadOf = (defect: ManifestDefect): ReturnType<typeof buildBugFields> => {
  const candidate = manifestToCandidate(defect, context);
  return buildBugFields(candidate, { version: candidate.version, assignee: candidate.assignee });
};

/** Every manifest record with its generated payload — computed once, at module scope. */
const PAYLOADS = manifest.defects.map((defect) => ({
  defect,
  candidate: manifestToCandidate(defect, context),
  fields: payloadOf(defect),
}));

/** The records that narrow their own claim — the ones whose scope line must never be lost. */
const SCOPED = PAYLOADS.filter((p) => p.defect.confirmedScope !== undefined);

const byId = (id: string): (typeof PAYLOADS)[number] => {
  const found = PAYLOADS.find((p) => p.defect.canonicalDefectId === id);
  if (!found) throw new Error(`${id} is not in the filing manifest`);
  return found;
};

test.describe('curated payload: it is built by the canonical builder @framework', () => {
  test.describe.configure({ mode: 'default' });

  test('the filer calls buildBugFields and renders nothing itself', () => {
    const source = readFileSync(
      path.join(ROOT_DIR, 'src', 'bug-tracker', 'curated', 'curated-filer.ts'),
      'utf8',
    );
    expect(source, 'the ticket must come from the one canonical builder').toContain(
      "from '../bug-builder'",
    );
    expect(source).toContain('buildBugFields(candidate,');
  });

  test('no second Bugzilla description generator exists', () => {
    /*
     * The root cause, guarded directly. `renderEnrichment` in `enrichment.ts` is deliberately NOT
     * one of these: it renders a COMMENT for an already-filed bug, which exists only because
     * Bugzilla cannot edit a description after creation. The test below proves it never reaches a
     * create call.
     */
    const dir = path.join(ROOT_DIR, 'src', 'bug-tracker', 'curated');
    for (const file of ['curated-filer.ts', 'manifest-to-candidate.ts', 'index.ts']) {
      const source = stripComments(readFileSync(path.join(dir, file), 'utf8'));
      expect(source, `${file} must not declare a description renderer`).not.toMatch(
        /function\s+render(Description|Summary)\b/,
      );
      expect(source, `${file} must not name one either`).not.toMatch(
        /\brender(Description|Summary)\s*\(/,
      );
    }
    const filer = stripComments(readFileSync(path.join(dir, 'curated-filer.ts'), 'utf8'));
    expect(filer, 'a hand-written description key is how the fields got lost').not.toMatch(
      /^\s*description:/m,
    );
    expect(filer, 'the comment renderer must never become a description').not.toContain(
      'renderEnrichment',
    );
  });

  test('buildDescription is declared in exactly one module', () => {
    const builder = readFileSync(
      path.join(ROOT_DIR, 'src', 'bug-tracker', 'bug-builder.ts'),
      'utf8',
    );
    expect(builder).toContain('export function buildDescription(');
  });
});

test.describe('curated payload: the fields KPA-492 carries @framework', () => {
  test.describe.configure({ mode: 'default' });

  test('severity and priority are the bench band, never a Bugzilla default', () => {
    for (const { defect, fields } of PAYLOADS) {
      expect(
        fields.severity,
        `${defect.canonicalDefectId} must not be filed as an enhancement request`,
      ).not.toBe('enhancement');
      expect(['critical', 'major', 'minor', 'trivial']).toContain(fields.severity);
      expect(['Highest', 'High', 'Normal', 'Low', 'Lowest']).toContain(fields.priority);
    }
  });

  test('the confirmed severity bands match what each record states', () => {
    // CRITICAL → critical/Highest, HIGH → major/High, exactly as BUGZILLA_SEVERITY maps them.
    expect(byId('CD-BE-005').fields.severity).toBe('critical');
    expect(byId('CD-BE-005').fields.priority).toBe('Highest');
    expect(byId('CD-A-NPE-KATCHUP-001').fields.severity).toBe('major');
    expect(byId('CD-A-NPE-KATCHUP-001').fields.priority).toBe('High');
    // "CRITICAL / HIGH" merges several validator findings; the HIGHEST band wins.
    expect(byId('CD-BE-006').fields.severity).toBe('critical');
  });

  test('the whiteboard carries the category axis', () => {
    for (const { defect, fields } of PAYLOADS) {
      expect(fields.status_whiteboard, `${defect.canonicalDefectId} lost its [cat:…] axis`).toMatch(
        /^\[cat:(Functional|Security|Performance|Compatibility)]/,
      );
    }
  });

  test('product, component, version and assignee resolve from the ownership configuration', () => {
    for (const { defect, fields } of PAYLOADS) {
      expect(fields.product).toBe('KPost API');
      expect(fields.component).toBe(defect.component);
      expect(fields.version).toBe('unspecified');
      // Set when the owner verifies, omitted when it cannot — the broad filer's rule, unchanged.
      expect(fields.assigned_to).toBe('jagan@kpost.in');
      expect(fields.op_sys).toBe('All');
      expect(fields.platform).toBe('All');
    }
  });

  test('the summary carries the dedupe tag, the endpoint and the defect', () => {
    const { defect, fields } = byId('CD-BE-005');
    expect(fields.summary.startsWith(`[${defect.benchTags[0] ?? ''}]`)).toBe(true);
    expect(fields.summary).toContain('/v2/profile/shareUserDetails');
    expect(fields.summary.length).toBeLessThanOrEqual(255);
    // The canonical id belongs in the body, not the summary — the original builder puts neither
    // there, and a tag the dedupe search cannot match would file duplicates.
    expect(fields.summary).not.toContain('CD-BE-005');
  });
});

test.describe('curated payload: the description structure @framework', () => {
  test.describe.configure({ mode: 'default' });

  test('every anchor the BUGZILLA-UI parses is present', () => {
    for (const { defect, fields } of PAYLOADS) {
      for (const anchor of REQUIRED_ANCHORS) {
        expect(
          fields.description,
          `${defect.canonicalDefectId} is missing the "${anchor}" anchor`,
        ).toContain(anchor);
      }
    }
  });

  test('a request.* defect carries the plain-language guidance block, as KPA-492 does', () => {
    // Keyed by validator in `guidance.ts`; the request family resolves to the input-validation entry.
    const { fields } = byId('CD-A-NPE-KATCHUP-001');
    for (const anchor of GUIDANCE_ANCHORS) expect(fields.description).toContain(anchor);
  });

  test('the correlation id survives into the ticket', () => {
    for (const { defect, fields } of PAYLOADS) {
      const first = defect.evidenceRefs[0] ?? '';
      expect(fields.description).toContain('Correlation ID (search the application logs for it):');
      expect(fields.description, `${defect.canonicalDefectId} lost its evidence ref`).toContain(
        first,
      );
    }
  });

  test('every evidence reference is listed, not just the first', () => {
    const { defect, fields } = byId('CD-BE-005');
    for (const ref of defect.evidenceRefs) expect(fields.description).toContain(ref);
  });

  test('the reproduction, control and independent confirmation all travel', () => {
    const { defect, fields } = byId('CD-BE-005');
    for (const step of defect.reproduction) expect(fields.description).toContain(step);
    expect(fields.description).toContain('Independent confirmation:');
    expect(fields.description).toContain('Known-good control');
  });

  test('a runnable curl is present where the record supplies one', () => {
    for (const { defect, fields } of PAYLOADS) {
      expect(fields.description, `${defect.canonicalDefectId} has no curl`).toContain('curl -i');
      expect(fields.description, 'a real token must never be pasted into a ticket').not.toMatch(
        /Bearer\s+eyJ/,
      );
    }
  });

  test('the description fits Bugzilla and is not a stub', () => {
    for (const { defect, fields } of PAYLOADS) {
      expect(
        fields.description.length,
        `${defect.canonicalDefectId} is too thin to be a developer-ready ticket`,
      ).toBeGreaterThan(1500);
      expect(fields.description.length).toBeLessThanOrEqual(65_535);
    }
  });
});

test.describe('curated payload: the confirmed scope is never widened @framework', () => {
  test.describe.configure({ mode: 'default' });

  test('the AWS crash claims extension=null and the empty body, and nothing else', () => {
    const { fields } = byId('CD-A-CRASH-AWS-001');
    expect(fields.description).toContain('extension = null');
    expect(fields.description).toContain('NOT confirmed for fileName = null');
    expect(
      fields.description,
      'fileName = null was measured as ACCEPTED with 200 — claiming it is a defect would send the ' +
        'developer after working behaviour',
    ).toContain('Do not describe them as defects');
  });

  test('the kpostIdExist crash claims mobileNumber=null, and calls kpostID=null handled', () => {
    const { fields } = byId('CD-A-CRASH-SIGNUP-EXIST-001');
    expect(fields.description).toContain('mobileNumber = null');
    expect(fields.description).toContain('NOT confirmed for kpostID = null');
    expect(fields.description).toContain('HANDLED 500');
    expect(fields.description).toContain('Do not describe it as an unhandled crash');
  });

  test('the two signup-endpoint defects stay separate tickets', () => {
    const npe = byId('CD-A-NPE-SIGNUP-001');
    const suggest = byId('CD-A-CRASH-SUGGEST-001');
    expect(npe.candidate.id).not.toBe(suggest.candidate.id);
    expect(npe.fields.summary).not.toBe(suggest.fields.summary);
    // Each says why it was not merged, so nobody quietly merges them later.
    expect(suggest.fields.description).toContain('Deliberately NOT merged');
    expect(npe.fields.description).toContain('NOT merged');
  });

  test('every record that states a confirmed scope renders it above Expected', () => {
    expect(SCOPED.length, 'three records narrow their own claim').toBeGreaterThan(0);
    for (const { defect, fields } of SCOPED) {
      expect(fields.description).toContain(`Confirmed scope: ${String(defect.confirmedScope)}`);
      expect(fields.description.indexOf('Confirmed scope:')).toBeLessThan(
        fields.description.indexOf('Expected:'),
      );
    }
  });
});

test.describe('curated payload: evidence attachment and secrets @framework', () => {
  test.describe.configure({ mode: 'default' });

  test('the attachment carries the unabridged reviewed record', () => {
    const { defect, candidate } = byId('CD-BE-005');
    const body = buildEvidenceAttachment(candidate);
    expect(body).toContain(`Defect: ${candidate.id}`);
    expect(body).toContain(defect.independentConfirmation);
    for (const ref of defect.evidenceRefs) expect(body).toContain(ref);
  });

  test('nothing that would be sent contains a secret', () => {
    for (const { defect, candidate, fields } of PAYLOADS) {
      const leaks = [
        ...findSecrets(fields.summary),
        ...findSecrets(fields.description),
        ...findSecrets(buildEvidenceAttachment(candidate)),
      ];
      expect(leaks, `${defect.canonicalDefectId} would leak ${leaks.join(', ')}`).toEqual([]);
    }
  });

  test('the whole manifest maps without a single unresolved field', () => {
    expect(PAYLOADS).toHaveLength(manifest.defects.length);
    for (const { defect, candidate } of PAYLOADS) {
      expect(candidate.id, `${defect.canonicalDefectId} has no dedupe tag`).toBeTruthy();
      expect(candidate.classification).toBeTruthy();
      expect(candidate.baseURL).toContain('http');
    }
  });
});

/** Strips comments so a guard never trips on the prose explaining it. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}
