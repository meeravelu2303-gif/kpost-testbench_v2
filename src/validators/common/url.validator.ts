import { apiConfig } from '@config/api.config';
import { createFieldConventionValidator } from './field-convention';

export const urlValidator = createFieldConventionValidator({
  name: 'common.url',
  noun: 'URL',
  description: 'URL fields contain absolute http(s) URLs',
  field: apiConfig.dataConventions.url.field,
  check: (value) => {
    // An empty string is an optional URL left unset, not a malformed one (Bugzilla #630, closed
    // INVALID 2026-09-28: KMail signature photoUrl / bannerUrl / website). Same rule as `common.id`'s
    // "" = no reference.
    if (value === '') return undefined;
    if (typeof value !== 'string' || !URL.canParse(value)) return 'not an absolute URL';
    return ['http:', 'https:'].includes(new URL(value).protocol)
      ? undefined
      : 'URL scheme is not http(s)';
  },
});
