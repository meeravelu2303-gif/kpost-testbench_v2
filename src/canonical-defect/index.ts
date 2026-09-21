/**
 * Canonical defects and duplicate detection (master plan §14).
 *
 *     detection       a check failed
 *     confirmation    it is still there when observed independently
 *     HERE            how many DISTINCT faults are these findings?
 *     filing          which of them reach a developer
 *
 * Four questions, kept apart. This one answers only the third, and it answers it from evidence —
 * module, feature, action, resource kind, actor relationship, failure category and the observable
 * behaviour — never from a status code, a title or a rendered message.
 *
 * It changes no bug fingerprint, so nothing already filed can be orphaned or duplicated by it.
 */

export {
  DEFECT_VARIANTS,
  IDENTIFYING_DIMENSIONS,
  canonicalKey,
  dimensionValue,
  type DefectIdentity,
  type DefectVariant,
  type IdentifyingDimension,
} from './identity';

export {
  EQUIVALENCE_VERDICTS,
  equivalence,
  groupDefects,
  summariseDefects,
  type CanonicalDefect,
  type EquivalenceResult,
  type EquivalenceVerdict,
} from './equivalence';
