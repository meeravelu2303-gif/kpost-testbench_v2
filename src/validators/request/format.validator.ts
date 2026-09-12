import { createRequestValidator } from './request-mutation';

/** One invalid sample per JSON Schema format — covers invalid email, URL, ID and date inputs. */
const INVALID_FORMAT_SAMPLES: Record<string, string> = {
  email: 'not-an-email',
  uri: 'not a url',
  url: 'not a url',
  uuid: 'not-a-uuid',
  'date-time': '2024-13-45T25:61:00Z',
  date: '2024-02-30T',
  time: '25:61:00',
  ipv4: '999.1.1.1',
  hostname: '-invalid-host-',
};
const PATTERN_MISMATCH = '!! does-not-match-pattern !!';

export const formatValidator = createRequestValidator({
  name: 'request.format',
  description: 'Values violating format (email, url, uuid, date, ...) or pattern are rejected',
  sections: ['body', 'query', 'path'],
  strategy: (field) => {
    if (field.isRoot) return [];
    const format = typeof field.schema.format === 'string' ? field.schema.format : undefined;
    const sample = format ? INVALID_FORMAT_SAMPLES[format] : undefined;
    if (sample !== undefined) return [{ label: `invalid ${format}`, value: sample }];
    return typeof field.schema.pattern === 'string'
      ? [{ label: 'pattern mismatch', value: PATTERN_MISMATCH }]
      : [];
  },
});
