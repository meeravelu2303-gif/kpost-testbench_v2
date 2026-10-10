import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { expect, request, test } from '@playwright/test';
import { ApiClient } from '../../src/api/client/api-client';
import type { ApiRequest } from '../../src/api/client/request-builder';

/**
 * Regression: the malformed-JSON and empty-body probes must send exactly the bytes they name.
 * Playwright rewrites a non-JSON STRING body under a JSON content-type into a quoted (valid) JSON
 * string, so the probes were never malformed and correct servers were reported as defects.
 */
test.describe('raw request bodies reach the server verbatim @framework', () => {
  let server: Server;
  let base = '';
  let received: { body: string; length: string | undefined } = { body: '', length: undefined };

  test.beforeAll(async () => {
    server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        received = {
          body: Buffer.concat(chunks).toString('utf8'),
          length: req.headers['content-length'],
        };
        res.statusCode = 200;
        res.end('{}');
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  test.afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  const send = async (rawBody: string) => {
    const context = await request.newContext({ baseURL: base });
    const log = { debug() {}, info() {}, warn() {}, error() {} } as never;
    const apiRequest: ApiRequest = {
      method: 'POST',
      pathTemplate: '/x',
      url: '/x',
      headers: { 'Content-Type': 'application/json' },
      rawBody,
      correlationId: 'raw-body-test',
      timeoutMs: 5000,
    };
    await new ApiClient(context, log).execute(apiRequest);
    await context.dispose();
  };

  for (const broken of ['{"field": ', '{"field": 1,}', "{'field': 1}"]) {
    test(`broken JSON ${broken} is sent as-is, not wrapped in quotes`, async () => {
      await send(broken);
      expect(received.body).toBe(broken);
    });
  }

  test('an empty raw body is sent empty, not as ""', async () => {
    await send('');
    expect(received.body).toBe('');
  });

  test('a raw body REPLACES multipart parts: the probe must not deliver the valid upload', async () => {
    const context = await request.newContext({ baseURL: base });
    const log = { debug() {}, info() {}, warn() {}, error() {} } as never;
    const apiRequest = {
      method: 'POST',
      pathTemplate: '/upload',
      url: '/upload',
      headers: {},
      multipart: { text: '{"receiver":"valid"}' },
      rawBody: '{"field": ',
      correlationId: 'raw-body-multipart-test',
      timeoutMs: 5000,
    } as unknown as ApiRequest;
    await new ApiClient(context, log).execute(apiRequest);
    await context.dispose();

    expect(received.body, 'the malformed bytes, not the multipart envelope').toBe('{"field": ');
    expect(received.body).not.toContain('valid');
  });

  test('without a raw body, multipart parts are still sent', async () => {
    const context = await request.newContext({ baseURL: base });
    const log = { debug() {}, info() {}, warn() {}, error() {} } as never;
    const apiRequest = {
      method: 'POST',
      pathTemplate: '/upload',
      url: '/upload',
      headers: {},
      multipart: { text: 'hello-part' },
      correlationId: 'multipart-test',
      timeoutMs: 5000,
    } as unknown as ApiRequest;
    await new ApiClient(context, log).execute(apiRequest);
    await context.dispose();

    expect(received.body).toContain('hello-part');
    expect(received.body).toMatch(/content-disposition/i);
  });
});
