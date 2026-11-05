import type { ApiRequest } from '@api/client/request-builder';
import { ApiResponseWrapper } from '@api/client/response-wrapper';
import { isRawBodyContract, rawBodyVerdict } from '@api/schema/raw-body-contract';
import { expect, test } from '@fixtures';

/**
 * Non-JSON contracts (a file's bytes, a bare text answer), as the backend-source entries write them.
 * The same rule serves `response.schema` and the flow check, so a file endpoint can be confirmed live.
 */
const JPEG = { contentEncoding: 'binary', contentMediaType: 'image/png|image/jpeg' };
const FILE = { description: 'binary file bytes; Content-Type from S3 metadata' };
const PUBLIC_KEY = { type: 'string', pattern: '^MIIB[A-Za-z0-9+/]+=*$', minLength: 8 };

const answer = (status: number, contentType: string, body: string, prefixHex?: string) =>
  new ApiResponseWrapper(
    {} as ApiRequest,
    status,
    { 'content-type': contentType },
    body,
    5,
    undefined,
    'primary',
    prefixHex,
  );

test.describe('non-JSON response contracts @framework', () => {
  test('a binary or text contract is recognised; a JSON object schema is not', () => {
    expect(isRawBodyContract(JPEG)).toBe(true);
    expect(isRawBodyContract(FILE)).toBe(true);
    expect(isRawBodyContract(PUBLIC_KEY)).toBe(true);
    expect(isRawBodyContract({ type: 'object', properties: {} })).toBe(false);
  });

  test('a real JPEG labelled image/jpeg matches', () => {
    const verdict = rawBodyVerdict(JPEG, answer(200, 'image/jpeg', 'ÿØ...', 'ffd8ffe0'));
    expect(verdict).toMatchObject({ applies: true, issues: [] });
  });

  test('bytes that disagree with their Content-Type, or a type the source does not allow, fail', () => {
    const mislabelled = rawBodyVerdict(JPEG, answer(200, 'image/png', 'x', 'ffd8ffe0'));
    expect(mislabelled.applies && mislabelled.issues.join()).toMatch(/Content-Type is image\/png/);
    const pdf = rawBodyVerdict(JPEG, answer(200, 'application/pdf', 'x', '25504446'));
    expect(pdf.applies && pdf.issues.join()).toMatch(/source code says image\/png or image\/jpeg/);
  });

  test('a text file labelled as an image fails (defect #617: every download says image/jpeg)', () => {
    const verdict = rawBodyVerdict(FILE, answer(200, 'image/jpeg', 'QA bench content', '5141'));
    expect(verdict.applies && verdict.issues.join()).toMatch(/not an image/);
    expect(rawBodyVerdict(FILE, answer(200, 'text/plain', 'QA bench content', '5141'))).toMatchObject({
      applies: true,
      issues: [],
    });
  });

  test('a JSON body where the source promises raw bytes fails', () => {
    const verdict = rawBodyVerdict(FILE, answer(200, 'application/json', '{"status":"SUCCESS"}'));
    expect(verdict.applies && verdict.issues.join()).toMatch(/JSON body/);
  });

  test('a bare text answer is checked against its pattern', () => {
    expect(rawBodyVerdict(PUBLIC_KEY, answer(200, 'text/plain', 'MIIBabc+/='))).toMatchObject({
      applies: true,
      issues: [],
    });
    const wrong = rawBodyVerdict(PUBLIC_KEY, answer(200, 'text/plain', 'not a key'));
    expect(wrong.applies && wrong.issues.length).toBeGreaterThan(0);
  });

  test('204, an error or an empty body is no content to compare, never a pass', () => {
    expect(rawBodyVerdict(JPEG, answer(204, 'image/jpeg', '')).applies).toBe(false);
    expect(rawBodyVerdict(JPEG, answer(404, 'text/plain', 'not found')).applies).toBe(false);
  });
});
