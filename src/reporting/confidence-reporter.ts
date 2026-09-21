import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Reporter, TestCase, TestResult } from '@playwright/test/reporter';
import { candidatesFromReport } from '../bug-tracker/bug-candidate';
import { candidateRejection } from '../bug-tracker/validity-gate';
import { readBugzillaConfig } from '../config/bugzilla.config';
import { suiteFor } from '../config/ownership.config';
import { CLASSIFIER_VERSION } from '../failure-analysis/classification';
import { GATE_VERSION, type ConfidenceDecisionRecord } from '../failure-analysis/confidence';
import { decisionsFromReport } from '../failure-analysis/confidence-decision';
import type { ExchangeEvidence } from '../failure-analysis/evidence';
import type { ValidationReport } from '../validation-engine/validation-result';
import {
  buildDivergenceReport,
  divergenceRow,
  renderDivergenceConsole,
  type DivergenceRow,
} from './confidence-divergence';
import {
  DEFAULT_CONFIDENCE_FILE,
  DEFAULT_DIVERGENCE_FILE,
  FileConfidenceJournal,
} from './confidence-journal';
import { EXCHANGE_EVIDENCE_ATTACHMENT, VALIDATION_REPORT_ATTACHMENT } from './report-attachment';

/**
 * Runs the Phase 3.4 confidence gate over this run's classified failures — **in shadow** — and
 * measures it against the existing Bugzilla candidate pipeline.
 *
 * ## What shadow means here, precisely
 *
 * Nothing in `src/bug-tracker/` is modified, and nothing this reporter produces is read back by
 * anything. The Bugzilla reporter still builds its candidates from `ValidationReport.results`, still
 * applies its own validity gate, still merges, consolidates, fingerprints, files and auto-resolves
 * exactly as before — this reporter is not even registered before it.
 *
 * Two bug-tracker functions ARE imported, and both are pure and read-only:
 * `candidatesFromReport` (which builds candidate objects in memory) and `candidateRejection` (which
 * inspects one). Neither performs I/O, neither reaches Bugzilla, and calling them changes nothing.
 * They are called here so the divergence report compares against the REAL existing rules rather than
 * a re-implementation of them that could drift.
 *
 * ## Why this reporter re-derives observations
 *
 * Classification is pure, so running it a second time yields byte-identical results and costs only
 * CPU. Paying that keeps the approved Phase 3.3 reporter untouched: the two read the same
 * attachments independently, and neither can perturb the other.
 *
 * ## Failure policy
 *
 * Observational, so it must never change a verdict. Every persistence step is best-effort and every
 * parse is guarded; problems are counted and printed at the end of the run, never thrown.
 */
export default class ConfidenceReporter implements Reporter {
  private readonly decisions: ConfidenceDecisionRecord[] = [];
  private readonly rows: DivergenceRow[] = [];
  private readonly config = readBugzillaConfig();
  private malformed = 0;

  onTestEnd(_test: TestCase, result: TestResult): void {
    /*
     * Two passes over this test's attachments, mirroring the observation reporter. A flow-finding
     * report is hand-built from a lifecycle 5xx and carries no evidence of its own, but the exchange
     * it describes was captured and attached separately by the same fixture — so evidence is
     * gathered first and offered to every report that lacks its own.
     */
    const evidence: ExchangeEvidence[] = [];
    for (const attachment of result.attachments) {
      if (attachment.name !== EXCHANGE_EVIDENCE_ATTACHMENT || !attachment.body) continue;
      try {
        evidence.push(...(JSON.parse(attachment.body.toString('utf8')) as ExchangeEvidence[]));
      } catch {
        this.malformed += 1;
      }
    }

    for (const attachment of result.attachments) {
      if (attachment.name !== VALIDATION_REPORT_ATTACHMENT || !attachment.body) continue;
      try {
        const report = JSON.parse(attachment.body.toString('utf8')) as ValidationReport;
        this.assess(report, evidence);
      } catch {
        this.malformed += 1;
      }
    }
  }

  /** Assesses one report and pairs each decision with the existing pipeline's own verdict. */
  private assess(report: ValidationReport, evidence: readonly ExchangeEvidence[]): void {
    const decisions = decisionsFromReport(report, { evidence });
    this.decisions.push(...decisions);

    const existing = this.existingVerdicts(report);
    for (const decision of decisions) {
      const verdict = existing.get(decision.validatorName);
      this.rows.push(
        divergenceRow(decision, {
          /*
           * A failure the existing pipeline produced no candidate for is counted as not a candidate.
           * That cannot happen today — both pipelines filter the same FAILED results — but assuming
           * it away would make a future divergence in the two filters silently invisible.
           */
          candidate: verdict?.rejection === undefined && verdict !== undefined,
          ...(verdict?.rejection ? { rejection: verdict.rejection } : {}),
        }),
      );
    }
  }

  /**
   * What the EXISTING pipeline decides about each FAILED result in this report, by validator name.
   *
   * Measured at the per-result level, before `mergeCandidates` and `consolidateCascades`, because
   * those collapse several failures into one ticket and would break the one-to-one mapping with
   * observations. The divergence artifact records that caveat alongside the numbers.
   */
  private existingVerdicts(
    report: ValidationReport,
  ): Map<string, { rejection: string | undefined }> {
    const verdicts = new Map<string, { rejection: string | undefined }>();
    try {
      const candidates = candidatesFromReport(
        report,
        { baseURL: suiteFor(report.suite).baseUrl },
        this.config,
      );
      for (const candidate of candidates) {
        // `classification` on a candidate is the validator name — the same key the decisions use.
        verdicts.set(candidate.classification, { rejection: candidateRejection(candidate) });
      }
    } catch {
      // The divergence side is best-effort: a failure here leaves the rows marked non-candidate and
      // is surfaced as a malformed count, never as a test failure.
      this.malformed += 1;
    }
    return verdicts;
  }

  onEnd(): void {
    if (this.decisions.length === 0 && this.malformed === 0) return;

    const journal = new FileConfidenceJournal(path.join(process.cwd(), DEFAULT_CONFIDENCE_FILE));
    for (const decision of this.decisions) journal.append(decision);

    const report = buildDivergenceReport(this.rows, {
      gateVersion: GATE_VERSION,
      classifierVersion: CLASSIFIER_VERSION,
      generatedAt: new Date().toISOString(),
    });

    const divergenceFile = path.join(process.cwd(), DEFAULT_DIVERGENCE_FILE);
    try {
      mkdirSync(path.dirname(divergenceFile), { recursive: true });
      writeFileSync(divergenceFile, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    } catch (error) {
      console.log(
        `[confidence] divergence report could not be written: ${(error as Error).message}`,
      );
    }

    console.log(renderDivergenceConsole(report));

    if (journal.failed > 0) {
      console.log(
        `[confidence] ${journal.failed} decision(s) could not be persisted — ${journal.errors.join('; ')}`,
      );
    }
    if (this.malformed > 0) {
      console.log(`[confidence] ${this.malformed} attachment(s) could not be parsed or compared`);
    }
  }
}
