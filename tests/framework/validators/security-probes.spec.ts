import { expect, test } from '@fixtures';
import { injectionValidator } from '@validators/security/injection.validator';
import { xssValidator } from '@validators/security/xss.validator';
import {
  LEAKY_ERRORS,
  NUMERIC_ONLY_SCHEMA,
  SEND_SCHEMA,
  VALID_NUMERIC,
  VALID_SEND,
} from './support/fixtures';
import {
  acceptsEverything,
  always,
  crashesOnEverything,
  echoesBody,
  fakeContext,
  fixtureEndpoint,
  probeBody,
  rejectsEverything,
  throttlesEverything,
  verdict,
  type FakeServer,
} from './support/validator-harness';

/**
 * The payload-probe security validators (`payload-probes.ts`): every attack string goes into each
 * free-text field, one fresh valid request per case. A 5xx, a leaked internal, an accepted payload
 * where rejection is required, or (XSS) a browser-renderable reflection is a finding.
 */

const VALID_BODY = VALID_SEND.body as Record<string, unknown>;

const attackContext = (server: FakeServer, security: { injectionMustBeRejected?: boolean } = {}) =>
  fakeContext({
    endpoint: fixtureEndpoint({ method: 'POST', requestSchema: SEND_SCHEMA, security }),
    request: VALID_SEND,
    server,
  });

/** String fields attacked for SEND_SCHEMA: free text, capped at 3 (thresholds.security). */
const TARGETS = ['subject', 'actualMessage', 'note'];

test.describe('validator unit · security.injection', { tag: '@framework' }, () => {
  test.describe('known-good → PASSED', () => {
    test('clean 400 rejections of every SQL/NoSQL payload pass', async () => {
      const context = attackContext(rejectsEverything);
      const result = await verdict(injectionValidator, context);
      expect(result.status).toBe('PASSED');
      expect(result.message).toBe('15 injection cases passed'); // 3 fields × 5 payloads
    });

    test('accepting the payload as plain data passes unless the endpoint requires rejection', async () => {
      const result = await verdict(injectionValidator, attackContext(acceptsEverything));
      expect(result.status).toBe('PASSED');
    });

    test('each payload lands in exactly one target field, the rest of the body stays valid', async () => {
      const context = attackContext(rejectsEverything);
      await verdict(injectionValidator, context);
      const hits = context.sent.map((_, i) => {
        const body = probeBody(context, i);
        const changed = Object.keys(VALID_BODY).filter(
          (k) => JSON.stringify(body[k]) !== JSON.stringify(VALID_BODY[k]),
        );
        expect(changed, `probe ${i}`).toHaveLength(1);
        return changed[0];
      });
      expect([...new Set(hits)]).toEqual(TARGETS);
      expect(probeBody(context, 0).subject).toBe("' OR '1'='1' --");
      // NoSQL operators go in as real JSON objects in a body, not as strings.
      expect(probeBody(context, 3).subject).toEqual({ $ne: null });
    });
  });

  test.describe('known-bad → FAILED', () => {
    test('a 5xx on an injection payload fails', async () => {
      const result = await verdict(injectionValidator, attackContext(crashesOnEverything));
      expect(result.status).toBe('FAILED');
      expect(result.message).toMatch(/^15\/15 injection cases failed/);
    });

    test('a leaked MySQL error fails even behind a polite 400', async () => {
      const result = await verdict(injectionValidator, attackContext(always(LEAKY_ERRORS.mysql)));
      expect(result.status).toBe('FAILED');
      expect(result.details?.[0]?.message).toBe('response leaks SQL error');
    });

    test('a leaked Java stack trace fails', async () => {
      const result = await verdict(
        injectionValidator,
        attackContext(always(LEAKY_ERRORS.stackTrace)),
      );
      expect(result.status).toBe('FAILED');
      expect(result.details?.[0]?.message).toBe('response leaks stack trace');
    });

    test('acceptance fails when the endpoint declares injectionMustBeRejected', async () => {
      const result = await verdict(
        injectionValidator,
        attackContext(acceptsEverything, { injectionMustBeRejected: true }),
      );
      expect(result.status).toBe('FAILED');
      expect(result.details?.[0]?.message).toBe('payload was accepted (HTTP 200)');
    });

    test('only the payload that broke the server is reported, with its request', async () => {
      const crashOnTautology: FakeServer = (spec, options) =>
        Object.values(spec.body as Record<string, unknown>).includes("' OR '1'='1' --")
          ? crashesOnEverything(spec, options)
          : rejectsEverything(spec, options);
      const result = await verdict(injectionValidator, attackContext(crashOnTautology));
      expect(result.status).toBe('FAILED');
      const failed = result.details?.filter((d) => d.status === 'FAILED') ?? [];
      expect(failed.map((d) => d.name)).toEqual([
        'body.subject: SQL tautology',
        'body.actualMessage: SQL tautology',
        'body.note: SQL tautology',
      ]);
      expect(failed[0]?.request?.body).toEqual({ ...VALID_BODY, subject: "' OR '1'='1' --" });
    });
  });

  test.describe('no response / nothing to judge → SKIPPED', () => {
    test('a body with no string field is skipped, nothing sent', async () => {
      const context = fakeContext({
        endpoint: fixtureEndpoint({ method: 'POST', requestSchema: NUMERIC_ONLY_SCHEMA }),
        request: VALID_NUMERIC,
      });
      const result = await verdict(injectionValidator, context);
      expect(result.status).toBe('SKIPPED');
      expect(result.message).toBe('no string fields to attack');
      expect(context.sent).toHaveLength(0);
    });

    test('an endpoint with no request contract is skipped', async () => {
      const result = await verdict(
        injectionValidator,
        fakeContext({ endpoint: fixtureEndpoint({ method: 'POST' }), request: VALID_SEND }),
      );
      expect(result.status).toBe('SKIPPED');
    });

    test('throttled probes are inconclusive', async () => {
      const result = await verdict(injectionValidator, attackContext(throttlesEverything));
      expect(result.status).toBe('SKIPPED');
    });
  });
});

test.describe('validator unit · security.xss', { tag: '@framework' }, () => {
  const html = (spec: Parameters<FakeServer>[0]) =>
    `<html><body><p>${Object.values(spec.body as Record<string, unknown>).join(' ')}</p></body></html>`;

  test.describe('known-good → PASSED', () => {
    test('a server that does not reflect the payload passes', async () => {
      const result = await verdict(xssValidator, attackContext(rejectsEverything));
      expect(result.status).toBe('PASSED');
      expect(result.message).toBe('9 xss cases passed'); // 3 fields × 3 payloads
    });

    test('reflection inside JSON with X-Content-Type-Options: nosniff passes', async () => {
      const result = await verdict(
        xssValidator,
        attackContext(
          echoesBody({ 'content-type': 'application/json', 'x-content-type-options': 'nosniff' }),
        ),
      );
      expect(result.status).toBe('PASSED');
    });
  });

  test.describe('known-bad → FAILED', () => {
    test('reflection in an HTML response fails', async () => {
      const reflectsAsHtml: FakeServer = (spec) => ({
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
        body: html(spec),
      });
      const result = await verdict(xssValidator, attackContext(reflectsAsHtml));
      expect(result.status).toBe('FAILED');
      expect(result.details?.[0]?.message).toBe(
        'payload reflected with Content-Type text/html; charset=utf-8',
      );
    });

    test('reflection in JSON without nosniff fails (a browser may sniff it as HTML)', async () => {
      const result = await verdict(
        xssValidator,
        attackContext(echoesBody({ 'content-type': 'application/json' })),
      );
      expect(result.status).toBe('FAILED');
      expect(result.details?.[0]?.message).toBe(
        'payload reflected without X-Content-Type-Options: nosniff',
      );
    });

    test('reflection with no Content-Type at all fails', async () => {
      const result = await verdict(xssValidator, attackContext(echoesBody({})));
      expect(result.status).toBe('FAILED');
      expect(result.details?.[0]?.message).toBe('payload reflected with Content-Type (missing)');
    });

    test('a 5xx on an XSS payload fails', async () => {
      const result = await verdict(xssValidator, attackContext(crashesOnEverything));
      expect(result.status).toBe('FAILED');
    });

    test('the event-handler payload is detected through JSON escaping', async () => {
      const result = await verdict(
        xssValidator,
        attackContext(echoesBody({ 'content-type': 'application/json' })),
      );
      const names = result.details?.filter((d) => d.status === 'FAILED').map((d) => d.name);
      expect(names).toContain('body.subject: event handler');
    });
  });

  test.describe('no response / nothing to judge → SKIPPED', () => {
    test('a body with no string field is skipped', async () => {
      const result = await verdict(
        xssValidator,
        fakeContext({
          endpoint: fixtureEndpoint({ method: 'POST', requestSchema: NUMERIC_ONLY_SCHEMA }),
          request: VALID_NUMERIC,
        }),
      );
      expect(result.status).toBe('SKIPPED');
      expect(result.message).toBe('no string fields to attack');
    });

    test('throttled probes are inconclusive', async () => {
      const result = await verdict(xssValidator, attackContext(throttlesEverything));
      expect(result.status).toBe('SKIPPED');
    });
  });
});
