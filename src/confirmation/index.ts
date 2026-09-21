/**
 * Independent confirmation (master plan §13).
 *
 *     detection      a check failed
 *     confirmation   the behaviour is still there when observed by someone else, somewhere else
 *
 * Two questions, kept apart on purpose: a detection that confirms itself cannot distinguish a
 * product defect from a bench mistake, because the same code produced both answers.
 *
 * The layer is pure. It observes nothing — a spec makes the observations and hands in what it saw —
 * so every safety control stays where it already is, and nothing here can send a request, repeat a
 * write or reach a live host.
 */

export {
  OBSERVATION_SURFACES,
  assessIndependence,
  describe as describeChannel,
  independenceStrength,
  type IndependenceVerdict,
  type ObservationChannel,
  type ObservationSurface,
} from './channel';

export {
  CONFIRMATION_OUTCOMES,
  confirm,
  summariseConfirmations,
  type ConfirmationOutcome,
  type ConfirmationRecord,
  type ConfirmationRequest,
  type ConfirmingObservation,
} from './confirm';
