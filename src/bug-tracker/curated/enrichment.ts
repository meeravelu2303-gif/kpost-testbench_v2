import { findSecrets, type ManifestDefect } from './manifest';

/**
 * Evidence enrichment for a bug that has ALREADY been filed.
 *
 * ## Why this is a comment and not a rewritten description
 *
 * Bugzilla's REST API cannot edit comment 0. A bug's description is fixed the moment it is created,
 * which is why `CLAUDE.md` records the same limitation for bug #339. So a filed ticket can only be
 * improved by ADDING to it, and this renders the block that gets added.
 *
 * That constraint is worth designing around rather than fighting: the added comment is
 * self-contained, so a developer reading it never has to reconcile it against the original.
 *
 * ## Structure
 *
 * Follows the format the existing high-quality KPost tickets use (bug 492 is the reference):
 * classification and category first, then the plain-language What / Why / How, then the
 * expected-versus-actual pair, then reproduction and evidence. The STRUCTURE is borrowed; every
 * statement is rendered from this defect's own manifest record, never copied from another ticket.
 *
 * ## What it must not do
 *
 * Overstate scope. Two of these defects are confirmed for ONE field and explicitly not for their
 * siblings, so `confirmedScope` and `affectedScope` are rendered prominently rather than tucked
 * away — a developer who reads only the top of the comment must still get the boundary right.
 */

export interface EnrichmentBlock {
  classification: string;
  category: string;
  whatThisMeans: string;
  whyItMatters: string;
  developerGuidance: string;
  occurrences: string;
  curl: string;
  controlCurl?: string;
  controlResult?: string;
  affectedScope: string;
  contractNote?: string;
}

/** A manifest defect that has been filed and carries its enrichment content. */
export type EnrichableDefect = ManifestDefect & {
  bugzillaId?: number;
  enrichment?: EnrichmentBlock;
};

/**
 * The marker that makes enrichment idempotent.
 *
 * A rerun must not post the same block twice, and matching on a marker is more reliable than
 * comparing rendered text that may have been reformatted. It carries the canonical id so a bug can
 * never accidentally absorb another defect's evidence.
 */
export function enrichmentMarker(defect: EnrichableDefect): string {
  return `[evidence:${defect.canonicalDefectId}]`;
}

/** Whether this bug already carries this defect's evidence block. */
export function alreadyEnriched(defect: EnrichableDefect, comments: readonly string[]): boolean {
  const marker = enrichmentMarker(defect);
  return comments.some((body) => body.includes(marker));
}

const section = (title: string, body: string): string[] => ['', title, body];

/**
 * The evidence comment.
 *
 * Deliberately verbose where verbosity is information — a developer opening this ticket should not
 * have to ask the bench anything. Deliberately silent where the evidence is silent: guidance
 * describes the observable failure and the kind of correction the evidence supports, and never
 * prescribes an implementation the bench cannot see.
 */
export function renderEnrichment(defect: EnrichableDefect): string {
  const e = defect.enrichment;
  if (!e) throw new Error(`${defect.canonicalDefectId} has no enrichment block`);

  const lines: string[] = [
    `${enrichmentMarker(defect)} Full evidence — added by the KPost test bench.`,
    '',
    'The original description above is a summary. This comment carries the complete, reproducible',
    'evidence for the same defect. (Bugzilla cannot edit a description after creation, so the detail',
    'is added here rather than merged into it.)',
    '',
    '════════════════════════════════════════════════════════════════════',
    `Classification: ${e.classification}`,
    `Category: ${e.category}`,
    `Canonical defect: ${defect.canonicalDefectId}`,
    `Endpoint: ${defect.method} ${defect.endpoint}`,
    `Module: ${defect.module} · Component: ${defect.component}`,
    `Environment: ${defect.environment}`,
    '════════════════════════════════════════════════════════════════════',
  ];

  if (defect.confirmedScope) {
    lines.push(
      ...section('CONFIRMED SCOPE — please read before reproducing', `  ${defect.confirmedScope}`),
    );
  }

  lines.push(
    ...section('WHAT THIS MEANS', `  ${e.whatThisMeans}`),
    ...section('WHY IT MATTERS', `  ${e.whyItMatters}`),
    ...section('EXPECTED', `  ${defect.expected}`),
    ...section('ACTUAL', `  ${defect.actual}`),
  );

  lines.push('', 'REPRODUCE');
  defect.reproduction.forEach((step, i) => lines.push(`  ${String(i + 1)}. ${step}`));

  if (e.controlCurl) {
    lines.push(
      '',
      'KNOWN-GOOD CONTROL — run this first; it should succeed',
      ...e.controlCurl.split('\n').map((l) => `  ${l}`),
    );
    if (e.controlResult) lines.push('', `  → ${e.controlResult}`);
  }

  lines.push(
    '',
    'THE FAILING REQUEST',
    ...e.curl.split('\n').map((l) => `  ${l}`),
    '',
    `  → ${defect.actual}`,
  );

  lines.push(
    ...section(
      'INDEPENDENT CONFIRMATION',
      `  ${defect.independentConfirmation}\n\n  This is evidence from a source other than the check that raised the finding — the\n  validator's own assertion is not treated as confirmation of itself.`,
    ),
    ...section('DEVELOPER GUIDANCE', `  ${e.developerGuidance}`),
    ...section('AFFECTED SCOPE', `  ${e.affectedScope}`),
  );

  if (e.contractNote) lines.push(...section('CONTRACT NOTE', `  ${e.contractNote}`));
  if (defect.relatedTo) lines.push(...section('RELATED', `  ${defect.relatedTo}`));
  if (defect.bugzillaAdjacency)
    lines.push(...section('EXISTING BUGZILLA CONTEXT', `  ${defect.bugzillaAdjacency}`));

  lines.push(
    '',
    'REPRODUCTION HISTORY',
    `  ${e.occurrences}`,
    '',
    'EVIDENCE REFERENCES (correlation ids — searchable in the application logs)',
    ...defect.evidenceRefs.map((ref) => `  ${ref}`),
    `  Source run: ${defect.sourceRun}`,
  );

  if (defect.benchSeverity) {
    lines.push(
      '',
      'SEVERITY',
      `  Bench classification: ${defect.benchSeverity}`,
      `  Product severity: ${defect.productSeverity ?? 'to be determined by the product/backend team'}`,
      '  The bench value describes how serious the CHECK class is. It is not a product-triage',
      '  decision and should not be treated as one.',
    );
  }

  lines.push(
    '',
    `Owner: ${defect.ownerName} <${defect.assignee}> — ${defect.assignmentSource}`,
    'Filed by: kpost-testbench_v2 curated filing path (manifest-approved defects only).',
    'No credential, token, cookie or personal identifier appears above; account identifiers are',
    'placeholders or masked.',
  );

  return lines.join('\n');
}

/**
 * Secrets in a rendered enrichment.
 *
 * Checked on the final text for the same reason the filer checks descriptions: a comment is
 * permanent and visible to everyone with access to the bug, so a leak is refused rather than
 * redacted.
 */
export function enrichmentSecrets(defect: EnrichableDefect): string[] {
  return findSecrets(renderEnrichment(defect));
}
