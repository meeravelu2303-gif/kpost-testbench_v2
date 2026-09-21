import { apiRegistry } from '@api/definitions/index';
import type { EndpointDefinition } from '@api/registry/endpoint-definition';
import { FR_IDS, LEGACY_REQUIREMENTS, NFR_IDS } from '@config/frd-requirements';
import { expect, test } from '@fixtures';
import {
  CONFLICT_KINDS,
  CONFLICT_STATUSES,
  DOCUMENTED_CONFLICTS,
  REQUIREMENT_STATUSES,
  SOURCE_AUTHORITIES,
  SOURCE_DOCUMENTS,
  SOURCE_TYPES,
  TEST_CASE_TRACEABILITY_GAP,
  allRequirements,
  conflictsForRequirement,
  endpointsByRequirement,
  hasRequirement,
  isOrphanedRequirement,
  provenanceSummary,
  requirement,
  requirementsFromSource,
  requirementsWithStatus,
  sourceDocument,
  sourceIds,
  traceEndpoint,
  untracedRequirementIds,
} from '../../src/requirements/index';

/**
 * Guards for Phase 1 — the Requirement Source Registry.
 *
 * ## What these prove
 *
 * That the registry is a faithful PROVENANCE layer: it covers exactly the ids the bench already
 * knows, attributes each to a real source, never invents a source or a successor, records conflicts
 * without resolving them, and stays structurally separated from execution.
 *
 * ## What they deliberately do NOT assert
 *
 * They do not pin how many requirements are ACTIVE, conflicted or un-texted. Those counts measure
 * the state of the DOCUMENTATION and should move when the documentation is corrected — pinning them
 * would turn a documentation improvement into a build failure. They are reported instead.
 */

const endpoints = apiRegistry.all().filter((d: EndpointDefinition) => !d.mockFixture);

test.describe('requirement source registry — coverage and drift @framework', () => {
  test('the registry covers exactly the canonical id set, in both directions', () => {
    /*
     * THE anti-duplication guard. `src/config/frd-requirements.ts` owns the canonical ids and is
     * enforced against every endpoint by requirements-traceability.spec.ts. This registry derives
     * from it, so the two can never disagree — and if someone ever re-lists ids here by hand, this
     * fails immediately.
     */
    const canonical = [...FR_IDS, ...NFR_IDS, ...LEGACY_REQUIREMENTS].sort();
    const registered = allRequirements()
      .map((record) => record.requirementId)
      .sort();

    expect(registered).toEqual(canonical);
    expect(new Set(registered).size, 'no duplicate requirement records').toBe(registered.length);
  });

  test('every canonical id resolves to a record', () => {
    const missing = [...FR_IDS, ...NFR_IDS, ...LEGACY_REQUIREMENTS].filter(
      (id) => !hasRequirement(id),
    );
    expect(missing, `ids with no provenance record:\n${missing.join('\n')}`).toEqual([]);
  });

  test('an unregistered id resolves to undefined rather than a default record', () => {
    expect(requirement('FR-DOES-NOT-EXIST-999')).toBeUndefined();
    expect(hasRequirement('FR-DOES-NOT-EXIST-999')).toBe(false);
  });
});

test.describe('requirement source registry — provenance integrity @framework', () => {
  test('every record names a source that is either registered or explicitly UNKNOWN', () => {
    const dangling = allRequirements()
      .filter((r) => r.sourceId !== 'UNKNOWN' && !sourceDocument(r.sourceId))
      .map((r) => `${r.requirementId} → ${r.sourceId}`);
    expect(
      dangling,
      `records naming a source that does not exist:\n${dangling.join('\n')}`,
    ).toEqual([]);
  });

  test('a record with no established source is UNVERIFIED, never silently attributed', () => {
    const unsourced = allRequirements().filter((record) => record.sourceId === 'UNKNOWN');
    expect(unsourced.length, 'the NFR scheme has no named document today').toBeGreaterThan(0);

    for (const record of unsourced) {
      expect(record.status, record.requirementId).toBe('UNVERIFIED');
      expect(record.authority, record.requirementId).toBe('UNKNOWN');
      expect(
        (record.provenanceNotes ?? []).join(' '),
        `${record.requirementId} must say WHY its source is unknown`,
      ).not.toBe('');
    }
  });

  test('the NFR scheme is recorded as unverified — its defining document is not named anywhere', () => {
    // A deliberate, honest gap: CLAUDE.md §4 lists the NFRs and the validators they map onto, but
    // names no document or section. Attributing them to the BRD/SRS would be a guess.
    for (const id of NFR_IDS) {
      const record = requirement(id);
      expect(record, id).toBeDefined();
      expect(record?.status, id).toBe('UNVERIFIED');
      expect(record?.sourceId, id).toBe('UNKNOWN');
    }
  });

  test('every vocabulary value used is inside its closed set', () => {
    for (const record of allRequirements()) {
      expect(REQUIREMENT_STATUSES, record.requirementId).toContain(record.status);
      expect(SOURCE_AUTHORITIES, record.requirementId).toContain(record.authority);
      expect(SOURCE_TYPES, record.requirementId).toContain(record.sourceType);
    }
    for (const doc of SOURCE_DOCUMENTS) {
      expect(SOURCE_TYPES, doc.sourceId).toContain(doc.sourceType);
      expect(SOURCE_AUTHORITIES, doc.sourceId).toContain(doc.authority);
    }
  });

  test('source documents are unique, reasoned, and cross-reference real sources', () => {
    const ids = sourceIds();
    expect(new Set(ids).size, 'duplicate sourceId').toBe(ids.length);
    for (const doc of SOURCE_DOCUMENTS) {
      expect(
        doc.authorityReason.length,
        `${doc.sourceId} must justify its authority`,
      ).toBeGreaterThan(20);
      for (const successor of doc.supersededBy ?? []) {
        expect(
          sourceDocument(successor),
          `${doc.sourceId} supersededBy ${successor}`,
        ).toBeDefined();
      }
      for (const predecessor of doc.supersedes ?? []) {
        expect(
          sourceDocument(predecessor),
          `${doc.sourceId} supersedes ${predecessor}`,
        ).toBeDefined();
      }
    }
  });

  test('the six per-module FRDs supersede the Full Suite FRD, and the dates support it', () => {
    const fullSuite = sourceDocument('SRC-FULLSUITE-FRD');
    expect(fullSuite?.sourceDate).toBe('2026-09-05');
    expect(fullSuite?.supersededBy?.length).toBe(6);

    for (const successorId of fullSuite?.supersededBy ?? []) {
      const successor = sourceDocument(successorId);
      expect(successor?.sourceType, successorId).toBe('MODULE_FRD');
      expect(successor?.sourceDate, successorId).toBe('2026-09-16');
      expect(successor?.supersedes, successorId).toContain('SRC-FULLSUITE-FRD');
    }
  });
});

test.describe('requirement source registry — supersession and orphans @framework', () => {
  test('legacy ids are SUPERSEDED, sourced to the Full Suite FRD, and claim no successor', () => {
    for (const id of LEGACY_REQUIREMENTS) {
      const record = requirement(id);
      expect(record, id).toBeDefined();
      expect(record?.status, id).toBe('SUPERSEDED');
      expect(record?.sourceId, id).toBe('SRC-FULLSUITE-FRD');
      // The repository states these have no clean equivalent; inventing one would be a false mapping.
      expect(record?.supersededBy, `${id} must not claim an invented successor`).toEqual([]);
      expect(isOrphanedRequirement(record!), id).toBe(true);
    }
  });

  test('no record claims a successor or predecessor that is not itself registered', () => {
    for (const record of allRequirements()) {
      for (const id of record.supersededBy ?? []) {
        expect(hasRequirement(id), `${record.requirementId} supersededBy ${id}`).toBe(true);
      }
      for (const id of record.supersedes ?? []) {
        expect(hasRequirement(id), `${record.requirementId} supersedes ${id}`).toBe(true);
      }
    }
  });
});

test.describe('requirement source registry — documented conflicts @framework', () => {
  test('every conflict has at least two sides, each naming a registered source', () => {
    expect(DOCUMENTED_CONFLICTS.length).toBeGreaterThan(0);
    for (const c of DOCUMENTED_CONFLICTS) {
      expect(
        c.sides.length,
        `${c.conflictId} needs two sides to be a conflict`,
      ).toBeGreaterThanOrEqual(2);
      for (const side of c.sides) {
        expect(
          sourceDocument(side.sourceId),
          `${c.conflictId} side ${side.sourceId}`,
        ).toBeDefined();
        expect(side.claim.length, `${c.conflictId} side must state its claim`).toBeGreaterThan(10);
      }
      expect(CONFLICT_KINDS, c.conflictId).toContain(c.kind);
      expect(CONFLICT_STATUSES, c.conflictId).toContain(c.status);
      expect(
        c.recordedIn.length,
        `${c.conflictId} must cite where the repo records it`,
      ).toBeGreaterThan(0);
    }
  });

  test('no conflict is silently resolved — every one is UNRESOLVED and asks a question', () => {
    /*
     * The core discipline of this phase: the registry records BOTH claims and picks no winner.
     * If a conflict is ever marked RESOLVED it must carry the decision, which this guard will then
     * require to be added deliberately rather than by default.
     */
    for (const c of DOCUMENTED_CONFLICTS) {
      expect(c.status, `${c.conflictId} must not be resolved by the registry`).toBe('UNRESOLVED');
      expect(c.openQuestion, `${c.conflictId} must state what would settle it`).toBeTruthy();
    }
  });

  test('conflict ids are unique and every affected requirement is registered', () => {
    const ids = DOCUMENTED_CONFLICTS.map((c) => c.conflictId);
    expect(new Set(ids).size, 'duplicate conflictId').toBe(ids.length);
    for (const c of DOCUMENTED_CONFLICTS) {
      for (const id of c.affectedRequirementIds ?? []) {
        expect(hasRequirement(id), `${c.conflictId} affects unregistered ${id}`).toBe(true);
      }
    }
  });

  test('an affected requirement is marked CONFLICTED and links back to its conflict', () => {
    // KDirectory is the worked example: BRD §4.2 excludes the module, its own FRD defines it.
    for (const id of ['FR-KD-001', 'FR-KD-006']) {
      const record = requirement(id);
      expect(record?.status, id).toBe('CONFLICTED');
      expect(record?.conflictsWith, id).toContain('CONF-SCOPE-KDIRECTORY');
      expect(
        conflictsForRequirement(id).map((c) => c.conflictId),
        id,
      ).toContain('CONF-SCOPE-KDIRECTORY');
    }
  });

  test('the KDirectory source itself records disputed authority rather than picking a side', () => {
    const doc = sourceDocument('SRC-FRD-KDIRECTORY');
    expect(doc?.authority).toBe('CONFLICTED');
    expect(doc?.authorityReason).toContain('BRD');
  });
});

test.describe('requirement source registry — traceability @framework', () => {
  test('the existing endpoint → requirement mapping resolves through the registry', () => {
    const tagged = endpoints.filter((e) => (e.requirements?.length ?? 0) > 0);
    expect(tagged.length, 'endpoints already carry requirement tags').toBeGreaterThan(0);

    const unresolved: string[] = [];
    for (const endpoint of tagged) {
      const trace = traceEndpoint(endpoint);
      expect(trace.endpointId).toBe(endpoint.id);
      expect(trace.requirements.length + trace.unresolved.length).toBe(
        endpoint.requirements?.length ?? 0,
      );
      for (const id of trace.unresolved) unresolved.push(`${endpoint.id} → ${id}`);
    }
    expect(
      unresolved,
      `endpoint requirement tags with no provenance record:\n${unresolved.join('\n')}`,
    ).toEqual([]);
  });

  test('the reverse index maps a requirement back to the endpoints that reference it', () => {
    const index = endpointsByRequirement(endpoints);
    expect(index.size).toBeGreaterThan(0);
    for (const [requirementId, endpointIds] of index) {
      expect(hasRequirement(requirementId), requirementId).toBe(true);
      expect(endpointIds.length, requirementId).toBeGreaterThan(0);
    }
  });

  test('traceEndpoint is read-only and safe on an endpoint with no tags', () => {
    const trace = traceEndpoint({ id: 'untagged-endpoint' });
    expect(trace).toEqual({ endpointId: 'untagged-endpoint', requirements: [], unresolved: [] });
  });

  test('the testCaseId → requirementId gap is documented, not filled with a guess', () => {
    expect(TEST_CASE_TRACEABILITY_GAP.supported).toBe(false);
    expect(TEST_CASE_TRACEABILITY_GAP.availableAnchors.length).toBeGreaterThan(0);
    expect(TEST_CASE_TRACEABILITY_GAP.reason).toContain('invented mapping');
    expect(TEST_CASE_TRACEABILITY_GAP.openDecision).toBeTruthy();
  });
});

test.describe('requirement source registry — boundary and reporting @framework', () => {
  test('the registry is pure data — repeated reads are identical', () => {
    expect(JSON.stringify(allRequirements())).toBe(JSON.stringify(allRequirements()));
    expect(JSON.stringify(provenanceSummary())).toBe(JSON.stringify(provenanceSummary()));
  });

  test('the provenance layer carries no execution, validation or defect vocabulary', () => {
    /*
     * The architectural boundary, asserted rather than trusted: a requirement record must never
     * grow a field that belongs to the engine, the confidence gate or the Bugzilla pipeline.
     */
    const serialised = JSON.stringify(allRequirements());
    for (const forbidden of [
      'endpointId',
      'validator',
      'testCaseId',
      'severity',
      'correlationId',
      'classification',
      'confidence',
      'bugzilla',
      'fingerprint',
    ]) {
      expect(serialised.includes(`"${forbidden}"`), `no ${forbidden} field belongs here`).toBe(
        false,
      );
    }
  });

  test('report provenance health (measurement, not an assertion)', () => {
    const summary = provenanceSummary();
    const untraced = untracedRequirementIds(endpoints, [...FR_IDS]);

    console.log(
      `requirement registry: ${summary.total} requirements — ` +
        Object.entries(summary.byStatus)
          .filter(([, n]) => n > 0)
          .map(([status, n]) => `${status} ${n}`)
          .join(' · ') +
        `\n  sources ${SOURCE_DOCUMENTS.length} · documented conflicts ${summary.conflicts}` +
        `\n  without an established source: ${summary.withoutSource}` +
        `\n  without concise text in this repository: ${summary.withoutText}` +
        `\n  superseded with no successor (orphaned): ${summary.orphaned}` +
        `\n  current FR ids not referenced by any endpoint tag: ${untraced.length}/${FR_IDS.length}` +
        ' (most are UI-flow requirements mapped to specs in docs/requirements-frd.md, not to an endpoint)',
    );

    expect(summary.total).toBe(FR_IDS.length + NFR_IDS.length + LEGACY_REQUIREMENTS.length);
    expect(requirementsWithStatus('ACTIVE').length).toBeGreaterThan(0);
    expect(requirementsFromSource('SRC-FULLSUITE-FRD')).toHaveLength(LEGACY_REQUIREMENTS.length);
  });
});
