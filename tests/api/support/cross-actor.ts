import type { Principal } from '@config/auth.config';
import type { EndpointExecutor } from '@engine/endpoint-executor';
import type { ActorRoleId } from '../../../src/actors/index';
import { observeExchange, type StateObservation } from '../../../src/state-observation/index';

/**
 * Observing one resource through a NAMED ACTOR'S OWN SESSION (master plan §10).
 *
 * ## Why a helper rather than a plain `sendTo`
 *
 * A cross-actor claim is only as good as the perspective attached to it. "The message exists" is not
 * a finding; "the confidential-copy recipient can see the message, and the copy recipient cannot see
 * that they were copied" is. Those are different observations of the same resource, and collapsing
 * them into one assertion is exactly what the master plan forbids.
 *
 * So every observation made through this helper carries the role that made it, the account it was
 * made as, the endpoint, the correlation id and the Phase 4C observations — and the account is
 * identified by its POOL KEY, never by a username or a credential. A report can then say which actor
 * saw what without ever naming a real login.
 *
 * It constructs nothing: the executor, the observation extractor and the principals all come from
 * the caller.
 */
export interface ActorView {
  readonly role: ActorRoleId;
  /** The account's pool key (`personal`, `victim`, …). Never a username, never a credential. */
  readonly account: string;
  readonly endpointId: string;
  readonly status: number;
  readonly body: Record<string, unknown>;
  /** The raw response text, for an absence check the documented fields cannot express. */
  readonly text: string;
  readonly observations: readonly StateObservation[];
  readonly correlationId: string;
}

export interface ObserveAsOptions {
  readonly role: ActorRoleId;
  readonly as: Principal;
  readonly endpointId: string;
  readonly body?: Record<string, unknown>;
  readonly label: string;
  /** A Phase 4B observation definition to extract with, when the resource has one. */
  readonly observationId?: string;
  /** Authorises a read of a resource this run owns — never a write. See `production-guard.ts`. */
  readonly allowLiveRead?: boolean;
}

/** Reads an endpoint as one actor, keeping the perspective attached to the result. */
export async function observeAs(
  endpoints: EndpointExecutor,
  options: ObserveAsOptions,
): Promise<ActorView> {
  const exchange = await endpoints.sendTo(
    options.endpointId,
    options.body ? { body: options.body } : {},
    {
      label: options.label,
      auth: { principal: options.as },
      ...(options.allowLiveRead ? { allowLiveRead: true } : {}),
    },
  );
  const parsed = exchange.json();
  return {
    role: options.role,
    account: options.as.key,
    endpointId: options.endpointId,
    status: exchange.status,
    body: (parsed.ok ? parsed.value : {}) as Record<string, unknown>,
    text: exchange.bodyText ?? '',
    observations: options.observationId
      ? observeExchange(exchange, {
          observationId: options.observationId,
          label: options.label,
          actorId: `${options.role}#0`,
        })
      : [],
    correlationId: exchange.correlationId,
  };
}

/** The `data` rows of a response, or an empty list. Shapes data; judges nothing. */
export function rowsOf(body: Record<string, unknown>, key = 'data'): Record<string, unknown>[] {
  const rows = body[key];
  return Array.isArray(rows) ? (rows as Record<string, unknown>[]) : [];
}

/** Whether an actor's view contains a row whose `field` equals `value`. */
export function viewContains(
  view: ActorView,
  field: string,
  value: unknown,
  key = 'data',
): boolean {
  return rowsOf(view.body, key).some((row) => row[field] === value);
}

/** One line per actor view, for an execution report. Carries no credential. */
export function describeViews(views: readonly ActorView[]): string[] {
  return views.map(
    (view) =>
      `${view.role.padEnd(30)} as ${view.account.padEnd(12)} ${view.endpointId} → ` +
      `${String(view.status)} (${String(view.observations.length)} observations, ${view.correlationId})`,
  );
}
