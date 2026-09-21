/**
 * Curated Bugzilla filing — the manifest is the only allowlist.
 *
 *     canonical-defect  ──writes──►  MANIFEST  ──reads──►  bug-tracker
 *
 * The broad filer derives its population from the run; this one cannot. A finding that is not in
 * `reports/bugs/KPOST-API-FILING-MANIFEST.json` with status `READY_FOR_BUGZILLA` has no code path
 * to Bugzilla here — and the module contains no resolve, close or reopen capability at all, so
 * automatic resolution is impossible rather than merely switched off.
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
  renderDescription,
  renderSummary,
  summariseCuratedFiling,
  type BugRef,
  type CuratedBugzillaClient,
  type CuratedFilerOptions,
  type CuratedFilingEntry,
  type CuratedFilingResult,
  type FilingOperation,
} from './curated-filer';

export {
  alreadyEnriched,
  enrichmentMarker,
  enrichmentSecrets,
  renderEnrichment,
  type EnrichableDefect,
  type EnrichmentBlock,
} from './enrichment';
