import path from 'node:path';
import type { Reporter, TestCase, TestResult } from '@playwright/test/reporter';
import {
  DEFAULT_EVIDENCE_FILE,
  FileEvidenceJournal,
  type ExchangeEvidence,
} from '../failure-analysis/index';
import type { ValidationReport } from '../validation-engine/validation-result';
import { EXCHANGE_EVIDENCE_ATTACHMENT, VALIDATION_REPORT_ATTACHMENT } from './report-attachment';

/**
 * Persists this run's exchange evidence (Phase 3.2) to `reports/evidence.jsonl`.
 *
 * ## Why this is its own reporter
 *
 * Evidence is a **test-execution** artifact, not a Bugzilla artifact. It was briefly written by the
 * Bugzilla reporter, which worked but was conceptually wrong: it made a record of what the
 * application did depend on the component that files defects. Evidence must exist when Bugzilla is
 * unconfigured, when filing is a dry run, when there are no candidates, and when the Bugzilla
 * reporter is not registered at all — so it owns its own persistence.
 *
 * Nothing here reads, writes or influences anything Bugzilla does. It is a pure sink.
 *
 * ## Where evidence comes from
 *
 * Two attachments, because two kinds of traffic produce it:
 *
 *  - **engine traffic** rides on the `ValidationReport` (`report.evidence`), which the engine already
 *    attaches for every validated endpoint; and
 *  - **lifecycle traffic** — a feature spec's own calls, and everything in the `cleanup` phase — is
 *    attached directly by the `endpoints` fixture, because those exchanges never pass through the
 *    engine and so appear in no `ValidationReport`.
 *
 * Deduplicated by correlation id, which is unique per exchange, so an exchange that somehow reached
 * both paths is written once.
 */
export default class EvidenceReporter implements Reporter {
  private readonly evidence = new Map<string, ExchangeEvidence>();
  private malformed = 0;

  onTestEnd(_test: TestCase, result: TestResult): void {
    for (const attachment of result.attachments) {
      if (!attachment.body) continue;
      if (attachment.name === EXCHANGE_EVIDENCE_ATTACHMENT) {
        this.collect(attachment.body, (parsed) => parsed as ExchangeEvidence[]);
      } else if (attachment.name === VALIDATION_REPORT_ATTACHMENT) {
        this.collect(attachment.body, (parsed) => (parsed as ValidationReport).evidence ?? []);
      }
    }
  }

  onEnd(): void {
    if (this.evidence.size === 0 && this.malformed === 0) return;
    const journal = new FileEvidenceJournal(path.join(process.cwd(), DEFAULT_EVIDENCE_FILE));
    for (const record of this.evidence.values()) journal.append(record);

    // A persistence problem must be loud, never silent — but it must not fail the run either.
    if (journal.failed > 0) {
      console.log(
        `[evidence] ${journal.failed} of ${this.evidence.size} record(s) could not be persisted — ` +
          journal.errors.join('; '),
      );
    }
    if (this.malformed > 0) {
      console.log(`[evidence] ${this.malformed} attachment(s) could not be parsed`);
    }
  }

  private collect(body: Buffer, extract: (parsed: unknown) => ExchangeEvidence[]): void {
    try {
      for (const record of extract(JSON.parse(body.toString('utf8')))) {
        this.evidence.set(record.correlationId, record);
      }
    } catch {
      // A malformed attachment is counted and reported; it must not take the reporter down.
      this.malformed += 1;
    }
  }
}
