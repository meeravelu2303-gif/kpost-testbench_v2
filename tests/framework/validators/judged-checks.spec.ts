import { judgedCheckReason } from '../../../src/bug-tracker/gates/known-false-positives';
import { expect, test } from '@fixtures';
import { forbiddenValidator } from '@validators/authorization/forbidden.validator';
import { idValidator } from '@validators/common/id.validator';
import { urlValidator } from '@validators/common/url.validator';
import { fakeContext, fixtureEndpoint, verdict } from './support/validator-harness';

/**
 * Findings a person ruled "not a defect": a wrong check is fixed in the validator; a product decision
 * on one endpoint skips that exact sanity check, strictly.
 */
test.describe('judged findings · validators and sanity', { tag: '@framework' }, () => {
  const respond = (body: unknown) =>
    fakeContext({ endpoint: fixtureEndpoint(), primary: { status: 200, body } });

  test('common.id: an emailId holds an e-mail address, not an id (#210/#665)', async () => {
    const judged = await verdict(
      idValidator,
      respond({ data: { personalData: { emailId: 'qa.bench+otp@kpost.in' } } }),
    );
    expect(judged.status, 'emailId is not held to the id format').not.toBe('FAILED');

    const real = await verdict(idValidator, respond({ data: { recordId: 'not an id!' } }));
    expect(real.status, 'a real *Id field with a bad value still fails').toBe('FAILED');
  });

  test('common.url: an empty optional URL is unset, not malformed (#630)', async () => {
    const empty = await verdict(urlValidator, respond({ data: { photoUrl: '' } }));
    expect(empty.status, 'an empty URL is not a failure').not.toBe('FAILED');

    const bad = await verdict(urlValidator, respond({ data: { photoUrl: 'not a url' } }));
    expect(bad.status, 'a malformed URL still fails').toBe('FAILED');
  });

  test('a whole-check ruling matches only its exact symptom (#943 msStatus)', () => {
    const path = '/v2/common/msStatus/';
    expect(
      judgedCheckReason(
        path,
        'response.structure',
        [],
        'response body is not valid JSON (Unexpected token \'S\', "SUCCESS" is not valid JSON)',
      ),
    ).toContain('#943');
    // A different structure failure on the same endpoint is not what was ruled.
    expect(
      judgedCheckReason(path, 'response.structure', [], 'response body is not valid JSON (<html>)'),
    ).toBeUndefined();
  });

  test('sanity skips a check only when EVERY failing field is the judged one (#830)', () => {
    const uuid = '04b6666d-2dc3-4b68-9001-52e414980fee';
    const path = '/testkmail/v2/common/getInstantReply/';
    expect(
      judgedCheckReason(path, 'common.id', [
        { name: 'data.4.id', actual: uuid },
        { name: 'data.5.id', actual: uuid.replace('04', '05') },
      ]),
    ).toContain('#830');
    // One failing value that is not a UUID → not what was judged → still a failure.
    expect(
      judgedCheckReason(path, 'common.id', [
        { name: 'data.4.id', actual: uuid },
        { name: 'data.6.id', actual: 'garbage' },
      ]),
    ).toBeUndefined();
    // Same check on another endpoint, or another check on this one → not judged.
    expect(
      judgedCheckReason('/v2/katchup/x', 'common.id', [{ name: 'data.0.id', actual: uuid }]),
    ).toBeUndefined();
    expect(
      judgedCheckReason(path, 'common.url', [{ name: 'data.0.id', actual: uuid }]),
    ).toBeUndefined();
    expect(
      judgedCheckReason(path, 'common.id', []),
      'nothing failed → nothing to judge',
    ).toBeUndefined();
  });

  test('authorization.forbidden: KPost has no error-code field, so a clean 403 passes; leaked data still fails', async () => {
    const endpoint = (responseContract: 'kpost' | 'standard') =>
      fixtureEndpoint({
        responseContract,
        authentication: { required: true },
        authorization: { roles: ['COMPANY_ADMIN'] },
      });
    // The permission probe a personal user sent, as the engine labels it.
    const refusedWith = async (responseContract: 'kpost' | 'standard', body: unknown) => {
      const context = fakeContext({
        endpoint: endpoint(responseContract),
        server: () => ({ status: 403, body }),
      });
      await context.send({}, { label: 'authorization.permission:USER' });
      return verdict(forbiddenValidator, context);
    };
    const springRefusal = {
      timestamp: '2026-10-29',
      status: 403,
      error: 'Forbidden',
      path: '/admin/x',
    };
    expect(
      (await refusedWith('kpost', springRefusal)).status,
      'a clean KPost 403 is no finding',
    ).toBe('PASSED');
    expect(
      (await refusedWith('kpost', { status: 'FAILURE', data: { companyID: 242 } })).status,
      'a refusal that still carries the record is',
    ).toBe('FAILED');
    expect(
      (await refusedWith('standard', springRefusal)).status,
      'an API that promises error codes is still held to them',
    ).toBe('FAILED');
  });
});
