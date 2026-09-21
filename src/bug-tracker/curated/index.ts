/**
 * Curated Bugzilla filing — the manifest is the only allowlist.
 *
 *     canonical-defect  ──writes──►  MANIFEST  ──reads──►  bug-tracker
 *
 * The broad filer derives its population from the run; this one cannot. A finding that is not in
 * `reports/bugs/KPOST-API-FILING-MANIFEST.json` with status `READY_FOR_BUGZILLA` has no code path
 * to Bugzilla here — and the module contains no resolve, close or reopen capability at all, so
 * automatic resolution is impossible rather than merely switched off.
 *
 * The ticket itself is rendered by `src/bug-tracker/bug-builder.ts`, the same builder the broad
 * `kpost:file` path uses. This module deliberately exports no description or summary renderer of
 * its own: a second generator is what filed bugs 493–500 with a thin body and a defaulted severity.
 * `renderEnrichment` below is not one — it renders a COMMENT for an already-filed bug, which exists
 * only because Bugzilla cannot edit a description after creation.
 */

export {
  FILEABLE_STATUS,
  filingManifestSchema,
  findSecrets,
  isApprovedForFiling,
  manifestDefectSchema,
  parseFilingManifest,
  ManifestError,
  type FilingManifest,
  type ManifestDefect,
} from './manifest';

export {
  FILING_OPERATIONS,
  checkFilingGates,
  fileCuratedDefects,
  summariseCuratedFiling,
  type BugRef,
  type CuratedBugzillaClient,
  type CuratedFilerOptions,
  type CuratedFilingEntry,
  type CuratedFilingResult,
  type FilingOperation,
} from './curated-filer';

export {
  CuratedAdapterError,
  adapterProblems,
  categoryAxis,
  contextOf,
  manifestToCandidate,
  severityBand,
  splitEnvironment,
  suiteForProduct,
  type AdapterProblem,
  type CuratedContext,
} from './manifest-to-candidate';

export {
  alreadyEnriched,
  enrichmentMarker,
  enrichmentSecrets,
  renderEnrichment,
  type EnrichableDefect,
  type EnrichmentBlock,
} from './enrichment';
