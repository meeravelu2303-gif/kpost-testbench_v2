import type { RequestSpec } from '@api/client/request-builder';
import { apiConfig } from '@config/api.config';
import { runProbes, type ProbeCase } from '@engine/probe';
import { PROFILE_SETS } from '@engine/validation-policy';
import { defineValidator } from '@engine/validator';

type Multipart = NonNullable<RequestSpec['multipart']>;
type FilePart = { name: string; mimeType: string; buffer: Buffer };

const isFile = (part: Multipart[string]): part is FilePart =>
  typeof part === 'object' && Buffer.isBuffer(part.buffer);

/** Every case a broken upload can be refused for; a lenient 2xx is recorded, a 5xx is a crash. */
const REFUSED = [...new Set([...apiConfig.invalidRequestStatus, 415])];

/**
 * Negative cases for a multipart upload (a profile picture, a signature, an attachment): the JSON
 * fuzzers never reach these endpoints, whose body is form data. Each case changes one part of the
 * endpoint's real upload: the file is dropped, empty, or not an image where an image is required, or
 * the JSON `text` part is broken. Every file is a few bytes (the 64 KB upload cap applies).
 */
export const multipartValidator = defineValidator({
  name: 'request.multipart',
  category: 'REQUEST',
  severity: 'HIGH',
  description:
    'A broken upload (no file, an empty file, the wrong file type, a broken JSON part) is refused cleanly',
  toggle: 'request',
  profiles: PROFILE_SETS.DEEP,
  stage: 'probe',
  appliesTo: ({ request }) =>
    request.multipart && Object.values(request.multipart).some(isFile)
      ? true
      : 'endpoint takes no file upload',
  check: async (context) => {
    const base = await context.nextRequest();
    const parts = base.multipart ?? {};
    const fileKey = Object.keys(parts).find((key) => isFile(parts[key]!));
    const file = fileKey ? (parts[fileKey] as FilePart) : undefined;
    const withParts = (next: Multipart): RequestSpec => ({ ...base, multipart: next });
    const cases: ProbeCase[] = [];
    if (fileKey && file) {
      const { [fileKey]: _dropped, ...withoutFile } = parts;
      cases.push(
        { name: `no "${fileKey}" part`, spec: withParts(withoutFile), expectedStatus: REFUSED },
        {
          name: `an empty "${fileKey}" (0 bytes)`,
          spec: withParts({ ...parts, [fileKey]: { ...file, buffer: Buffer.alloc(0) } }),
          expectedStatus: REFUSED,
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
          expectedStatus: REFUSED,
        });
    }
    const text = parts.text;
    if (typeof text === 'string' && text.trim().startsWith('{'))
      cases.push({
        name: 'a broken JSON "text" part',
        spec: withParts({ ...parts, text: text.slice(0, -1) }),
        expectedStatus: REFUSED,
      });
    const outcome = await runProbes(context, 'request.multipart', cases, 'broken-upload cases');
    // A server that accepted an empty or wrong file stored it (a blank cover): put the endpoint's own
    // normal upload back, as the JSON fuzzers' restoreAfter does. Best effort; the verdict is decided.
    if (context.endpoint.destructive && cases.length)
      await context
        .send(await context.nextRequest(), { label: 'request.multipart:restore' })
        .catch(() => undefined);
    return outcome;
  },
});
