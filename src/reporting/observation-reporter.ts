import path from 'node:path';
import type { Reporter, TestCase, TestResult } from '@playwright/test/reporter';
import { observationsFromReport, type Observation } from '../failure-analysis/observation';
import type { FailureClass } from '../failure-analysis/classification';
import type { ExchangeEvidence } from '../failure-analysis/evidence';
import type { ValidationReport } from '../validation-engine/validation-result';
import { DEFAULT_OBSERVATION_FILE, FileObservationJournal } from './observation-journal';
import { EXCHANGE_EVIDENCE_ATTACHMENT, VALIDATION_REPORT_ATTACHMENT } from './report-attachment';

/**
 * Classifies this run's failures and persists them to `reports/observations.jsonl` — **in shadow**.
 *
 * ## What shadow means here, precisely
 *
 * The existing pipeline is untouched. Candidates are still built from `ValidationReport.results` by
 * the Bugzilla reporter, still gated by the existing validity gate, and still filed or not filed
 * exactly as before. This reporter only reads the same attachments a second time and writes a
 * parallel artifact. It calls nothing in `src/bug-tracker/`, and nothing reads its output back.
 *
 * The point of the phase is measurement: before a classification is allowed to suppress or promote
 * anything, we need a run's worth of evidence that the rules classify real traffic the way a human
 * would. The divergence line printed at the end is that measurement — it says what the classifier
 * WOULD have said about the same failures the existing pipeline turned into candidates, and changes
 * nothing.
 */
export default class ObservationReporter implements Reporter {
  private readonly observations: Observation[] = [];
  private malformed = 0;

  onTestEnd(_test: TestCase, result: TestResult): void {
    /*
     * Two passes over THIS test's attachments. A flow-finding report is hand-built from a lifecycle
     * 5xx and carries no evidence of its own, but the exchange it describes was captured and
     * attached separately by the same fixture — so the evidence is gathered first and offered to
     * every report that lacks its own. Without this, precisely the failures a lifecycle spec exists
     * to find would classify as having no evidence.
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
        this.observations.push(...observationsFromReport(report, { evidence }));
      } catch {
        this.malformed += 1;
      }
    }
  }

  onEnd(): void {
    if (this.observations.length === 0 && this.malformed === 0) return;

    const journal = new FileObservationJournal(path.join(process.cwd(), DEFAULT_OBSERVATION_FILE));
    for (const observation of this.observations) journal.append(observation);

    const byClass = new Map<FailureClass, number>();
    for (const observation of this.observations) {
      byClass.set(observation.classification, (byClass.get(observation.classification) ?? 0) + 1);
    }
    const distribution = [...byClass.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => `${name} ${count}`)
      .join(' · ');

    /*
     * Every FAILED result is what the existing pipeline turns into one candidate, so this count is a
     * like-for-like shadow comparison — how many of today's candidates the classifier would call an
     * application defect. Reported only. Nothing is suppressed, delayed or altered.
     */
    const appDefects = byClass.get('APP_DEFECT') ?? 0;
    console.log(
      `\n[observations] SHADOW — ${this.observations.length} classified failure(s): ${distribution}` +
        `\n[observations] the classifier would call ${appDefects} of ${this.observations.length} ` +
        'an APP_DEFECT; Bugzilla filing is unchanged by this phase.',
    );

    if (journal.failed > 0) {
      console.log(
        `[observations] ${journal.failed} record(s) could not be persisted — ${journal.errors.join('; ')}`,
      );
    }
    if (this.malformed > 0) {
      console.log(`[observations] ${this.malformed} attachment(s) could not be parsed`);
    }
  }
}
