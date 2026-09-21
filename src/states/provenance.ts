/**
 * Provenance — where a state claim comes from, and how strongly the repository actually supports it.
 *
 * Phase 4B. Every record in this module carries one of these. The rule the whole module exists to
 * enforce is that **an inference never becomes a documented fact**: the discovery phase found the
 * repository already claiming coverage it did not have (a mail send tagged as satisfying "read
 * receipts", a UI catalogue marking "open state" as built), and those claims were possible precisely
 * because nothing forced the evidence to travel with the assertion.
 */

/**
 * How well a claim is supported.
 *
 * Deliberately NOT a numeric score, matching the vocabulary the rest of this repository already uses
 * for closed judgement sets (`APPLICATION | EDGE | NO_RESPONSE | UNKNOWN`, `PRESENT | ABSENT |
 * UNKNOWN`, `AUTHORITATIVE | SECONDARY | …`): UPPER_SNAKE, closed, with an explicit `UNKNOWN` rather
 * than a default guess.
 *
 *  - `DOCUMENTED` — stated by an authoritative source (the generated types contract, a documented
 *    response example, or module flow documentation).
 *  - `OBSERVED`   — recorded in this repository as seen against a real host. **Weaker than it sounds:**
 *    every current instance is a human note in a decision log, not an automated assertion.
 *  - `DERIVED`    — the repository infers it from something else (an "edited" message has no field;
 *    it is inferred from `messageType: 6`). Marked so it is never mistaken for DOCUMENTED.
 *  - `UNKNOWN`    — the term exists but its meaning is not stated anywhere.
 *  - `CONFLICTED` — sources disagree. The record still exists; the disagreement is carried in a
 *    `StateConflict` and the claim must not be relied on until it is resolved.
 */
export const EVIDENCE_STATUSES = [
  'DOCUMENTED',
  'OBSERVED',
  'DERIVED',
  'UNKNOWN',
  'CONFLICTED',
] as const;
export type EvidenceStatus = (typeof EVIDENCE_STATUSES)[number];

/**
 * One citation.
 *
 * `citation` is a location a reviewer can open — a repository path with a line or a named section, or
 * a generated artefact plus the key inside it. It is required and must not be empty: a state record
 * whose evidence cannot be checked is exactly the kind of claim this module exists to prevent.
 */
export interface Provenance {
  readonly status: EvidenceStatus;
  /** Where to look. e.g. `contracts/kpost-types.json → katchupStatus."2"`. */
  readonly citation: string;
  /** Anything a reader must know before trusting the claim — especially a limit on it. */
  readonly note?: string;
}

export function isEvidenceStatus(value: string): value is EvidenceStatus {
  return (EVIDENCE_STATUSES as readonly string[]).includes(value);
}

/** Whether a provenance record is usable: a real status and a non-empty citation. */
export function hasUsableProvenance(provenance: Provenance): boolean {
  return isEvidenceStatus(provenance.status) && provenance.citation.trim().length > 0;
}
