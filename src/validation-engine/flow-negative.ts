import type { RequestSpec } from '@api/client/request-builder';
import { apiRegistry } from '@api/definitions/index';
import { toJsonSchema, validateSchema } from '@api/schema/contract-schema';
import { getPath } from '@utils/json';
import { boundaryAcceptStrategy } from '@validators/request/boundary-accept.validator';
import { boundaryValueStrategy } from '@validators/request/boundary-value.validator';
import { expect, test } from '@fixtures';
import {
  applyCandidate,
  collectFields,
  REMOVE,
  schemaType,
  wrongTypeValue,
  type FieldInfo,
} from '@validators/request/request-mutation';
import type { EndpointExecutor, SendOptions } from './endpoint-executor';
import { ProductionSafetyError } from './production-guard';
import { resolveEndpoint } from './validation-policy';

/**
 * Negative input for a shared-state (`global`) write, sent by the flow that owns the record, never by
 * the engine (CLAUDE.md §3; owner, 2026-11-05: "yes" to covering these writes this way). Each case is
 * the flow's real request with one body field broken (removed, null, the wrong type, an empty
 * string), kept only when the contract itself rejects it, and sent with the flow's own options: its
 * principal, its per-call opt-in and the ids it minted, so every guard stays armed. The flow restores
 * its record afterwards, as it already does.
 *
 * A 5xx fails softly (and the executor files it as a flow finding); a 2xx is lenient acceptance,
 * recorded as an annotation like the engine's lenient cases; a 4xx is the right answer.
 * The test-type ledger credits every endpoint named in a `negativeInFlow(` call.
 */
export async function negativeInFlow(
  endpoints: EndpointExecutor,
  endpointId: string,
  spec: RequestSpec,
  options: SendOptions,
  maxCases = 12,
): Promise<void> {
  const endpoint = resolveEndpoint(apiRegistry.get(endpointId));
  const schema = endpoint.requestSchema;
  if (spec.multipart) return negativeUpload(endpoints, endpointId, spec, options);
  if (!schema || spec.body === undefined) {
    test.info().annotations.push({
      type: 'negative-in-flow',
      description: `${endpointId}: not sent (${schema ? 'the request has no JSON body' : 'no request schema to break'})`,
    });
    return;
  }
  const strategies = (field: FieldInfo, current: unknown): Array<[string, unknown]> => {
    const out: Array<[string, unknown]> = [];
    if (field.required) out.push(['removed', REMOVE]);
    out.push(['null', null]);
    const wrong = wrongTypeValue(schemaType(field.schema));
    if (wrong !== undefined)
      out.push([`${typeof wrong} instead of ${schemaType(field.schema)}`, wrong]);
    if (typeof current === 'string' && current !== '') out.push(['empty string', '']);
    return out;
  };

  const cases: Array<{ name: string; spec: RequestSpec }> = [];
  for (const field of collectFields(toJsonSchema(schema), 'body')) {
    if (field.isRoot) continue;
    const current: unknown = (spec.body as Record<string, unknown> | undefined)?.[field.path];
    for (const [label, value] of strategies(field, current)) {
      const mutated = applyCandidate(spec, field, value);
      // Only what the contract rejects: a loose schema must not turn into a false finding.
      if (!validateSchema(schema, mutated.body).length) continue;
      cases.push({ name: `body.${field.path}: ${label}`, spec: mutated });
    }
  }

  await sendCases(endpoints, endpointId, cases.slice(0, maxCases), options);
}

type FilePart = { name: string; mimeType: string; buffer: Buffer };

/** The upload with one part broken, as `request.multipart` does for the engine. */
async function negativeUpload(
  endpoints: EndpointExecutor,
  endpointId: string,
  spec: RequestSpec,
  options: SendOptions,
): Promise<void> {
  const parts = spec.multipart ?? {};
  const fileKey = Object.keys(parts).find((key) => {
    const part = parts[key];
    return typeof part === 'object' && Buffer.isBuffer(part.buffer);
  });
  const cases: Array<{ name: string; spec: RequestSpec }> = [];
  const withParts = (next: typeof parts): RequestSpec => ({ ...spec, multipart: next });
  if (fileKey) {
    const file = parts[fileKey] as FilePart;
    const { [fileKey]: _dropped, ...withoutFile } = parts;
    cases.push(
      { name: `no "${fileKey}" part`, spec: withParts(withoutFile) },
      {
        name: `an empty "${fileKey}"`,
        spec: withParts({ ...parts, [fileKey]: { ...file, buffer: Buffer.alloc(0) } }),
      },
    );
    if (file.mimeType.startsWith('image/'))
      cases.push({
        name: `a text file where "${fileKey}" must be an image`,
        spec: withParts({
          ...parts,
          [fileKey]: {
            name: 'qa-bench-not-an-image.txt',
            mimeType: 'text/plain',
            buffer: Buffer.from('QA bench: not an image'),
          },
        }),
      });
  }
  const text = parts.text;
  if (typeof text === 'string' && text.trim().startsWith('{'))
    cases.push({
      name: 'a broken JSON "text" part',
      spec: withParts({ ...parts, text: text.slice(0, -1) }),
    });
  await sendCases(endpoints, endpointId, cases, options);
}

/**
 * Boundary values for a shared-state write, sent by the flow that owns the record (owner,
 * 2026-11-05: "Yes, continue"). The same edge values the engine's boundary validators would send
 * (`boundaryValueStrategy` just outside each cited limit, `boundaryAcceptStrategy` exactly at it),
 * with the flow's own principal, opt-in and owned ids, so every guard stays armed. Just outside must
 * be refused without a 5xx (a 2xx is lenient, recorded); exactly at must be taken without a 5xx. An
 * at-limit value really lands, so the flow's own restore runs afterwards, as it already does.
 * The test-type ledger credits every endpoint named in a `boundaryInFlow(` call.
 */
export async function boundaryInFlow(
  endpoints: EndpointExecutor,
  endpointId: string,
  spec: RequestSpec,
  options: SendOptions,
): Promise<void> {
  const endpoint = resolveEndpoint(apiRegistry.get(endpointId));
  const schema = endpoint.requestSchema;
  if (!schema || spec.body === undefined) {
    test.info().annotations.push({
      type: 'boundary-in-flow',
      description: `${endpointId}: not sent (${schema ? 'the request has no JSON body' : 'no request schema'})`,
    });
    return;
  }
  const outside: Array<{ name: string; spec: RequestSpec }> = [];
  const at: Array<{ name: string; spec: RequestSpec }> = [];
  for (const field of collectFields(toJsonSchema(schema), 'body', '', true, true)) {
    const current = field.isRoot ? spec.body : getPath(spec.body, field.path);
    for (const c of boundaryValueStrategy(field, current))
      outside.push({
        name: `body.${field.path}: ${c.label}`,
        spec: applyCandidate(spec, field, c.value),
      });
    for (const c of boundaryAcceptStrategy(field, current))
      at.push({
        name: `body.${field.path}: ${c.label}`,
        spec: applyCandidate(spec, field, c.value),
      });
  }
  test.info().annotations.push({
    type: 'boundary-in-flow',
    description: `${endpointId}: ${outside.length} just-outside and ${at.length} at-limit case(s)`,
  });
  await sendCases(endpoints, endpointId, outside, options, 'reject', 'boundary');
  await sendCases(endpoints, endpointId, at, options, 'accept', 'boundary');
  // An accepted at-limit value really landed: the flow's own normal request puts its state back
  // before the flow goes on (as request.boundary-accept does for the engine).
  if (at.length)
    await endpoints
      .sendTo(endpointId, spec, { ...options, label: `${options.label}:boundary:restore` })
      .catch(() => undefined);
}

async function sendCases(
  endpoints: EndpointExecutor,
  endpointId: string,
  cases: Array<{ name: string; spec: RequestSpec }>,
  options: SendOptions,
  /** `reject`: the value is invalid (a 2xx is lenient); `accept`: it is valid (only a 5xx counts). */
  kind: 'reject' | 'accept' = 'reject',
  /** The battery's name in labels and annotations. */
  battery: 'negative' | 'boundary' = 'negative',
): Promise<void> {
  const lenient: string[] = [];
  const send = (c: { name: string; spec: RequestSpec }, pass: number) =>
    endpoints.sendTo(endpointId, c.spec, {
      ...options,
      label: `${options.label}:${battery}:${c.name}${pass ? `:repeat-${pass}` : ''}`,
    });
  const refused: string[] = [];
  // Which cases this flow sent, so a battery that built none is visible rather than silently green.
  if (battery === 'negative')
    test.info().annotations.push({
      type: 'negative-in-flow',
      description: cases.length
        ? `${endpointId}: ${cases.length} bad-input case(s): ${cases.map((c) => c.name).join('; ')}`
        : `${endpointId}: no bad-input case (the contract rejects none of the mutations)`,
    });
  for (const c of cases) {
    let answer;
    try {
      answer = await send(c, 0);
    } catch (error) {
      // The QA guard kept this case from being sent (it names a record we do not own): not a finding.
      if (!(error instanceof ProductionSafetyError)) throw error;
      refused.push(c.name);
      continue;
    }
    // A crash is believed only when it reproduces (3/3), as the engine's reproduction gate does.
    for (let pass = 1; pass < 3 && answer.status >= 500; pass += 1) {
      const again = await send(c, pass);
      if (again.status < 500) answer = again;
    }
    expect
      .soft(
        answer.status,
        kind === 'reject'
          ? `${endpointId} refuses ${c.name} without a server error (3 tries)`
          : `${endpointId} takes ${c.name} without a server error (3 tries)`,
      )
      .toBeLessThan(500);
    if (kind === 'reject' && answer.status < 300) lenient.push(`${c.name} -> ${answer.status}`);
  }
  if (lenient.length)
    test.info().annotations.push({
      type: 'lenient-acceptance',
      description: `${endpointId} accepted bad input: ${lenient.join('; ')}`,
    });
  if (refused.length)
    test.info().annotations.push({
      type: 'negative-not-sent',
      description: `${endpointId}: the QA guard kept ${refused.join('; ')} from being sent`,
    });
}
