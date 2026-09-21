/**
 * Flow Execution — turning a declared business flow into an executed one (master plan §8).
 *
 * ## Where this sits
 *
 *     FlowDefinition            src/flows/          declarative; executes nothing
 *            ↓
 *     FlowExecutionEngine       HERE                walks the steps, records outcomes
 *            ↓
 *     StepAction                HERE (contract)     the adapter a caller registers
 *            ↓
 *     EndpointExecutor / UI     existing            the only thing that touches the product
 *            ↓
 *     Evidence · State Observation · Business Invariants
 *
 * A separate module from `src/flows/` on purpose. That layer states, in its own header, that it "is
 * not a workflow engine: it executes nothing" — putting an executor inside it would force the
 * declarative model to import the validation engine and would make a business description depend on
 * the machinery meant to carry it out. So execution depends on flows; flows know nothing of
 * execution, and a framework guard asserts that direction.
 *
 * ## Nothing here is a second anything
 *
 * No account pool, no resource ledger, no requirement registry, no state observation engine, no
 * endpoint executor, no evidence system, no validation engine. The engine is generic over the
 * executor and the cleanup coordinator precisely so it cannot construct either: it receives them,
 * passes them to an action, and never calls them itself.
 */

export {
  FlowExecutionEngine,
  observableSteps,
  summarise,
  type FlowExecutionOptions,
  type FlowExecutionResult,
  type StepExecution,
} from './engine';

export {
  StepActionRegistry,
  StepActionRegistryError,
  produced,
  type ProducedArtifact,
  type StepAction,
  type StepActionContext,
  type StepActionResult,
} from './step-action';
