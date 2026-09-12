import { apiConfig, type Pagination } from '@config/api.config';
import { defineValidator } from '@engine/validator';
import { fromChecks, outcome, type CheckDetail } from '@engine/validation-result';
import { getPath, isPlainObject } from '@utils/json';

const check = (name: string, ok: boolean, expected: unknown, actual: unknown): CheckDetail => ({
  name,
  status: ok ? 'PASSED' : 'FAILED',
  expected,
  actual,
});

export const paginationValidator = defineValidator({
  name: 'response.pagination',
  category: 'RESPONSE',
  severity: 'MEDIUM',
  description: 'Paginated responses carry consistent pagination metadata',
  toggle: 'pagination',
  dependsOn: ['response.status-code'],
  appliesTo: ({ endpoint }) => (endpoint.pagination ? true : 'endpoint is not paginated'),
  check: ({ primary, request }) => {
    const parsed = primary.json();
    if (!parsed.ok) return outcome.failed(parsed.reason);
    const data = getPath(parsed.value, 'data');
    const pagination = getPath(parsed.value, 'metadata.pagination');
    if (!isPlainObject(pagination)) return outcome.failed('metadata.pagination is missing');
    const { page, pageSize, totalItems, totalPages } = pagination as Pagination;
    const items = Array.isArray(data) ? data.length : -1;
    const requestedPage = request.query?.page;

    return fromChecks(
      [
        check('data is an array', Array.isArray(data), 'array', typeof data),
        check('items <= pageSize', items >= 0 && items <= pageSize, `<= ${pageSize}`, items),
        check(
          'pageSize <= max',
          pageSize <= apiConfig.pagination.maxPageSize,
          `<= ${apiConfig.pagination.maxPageSize}`,
          pageSize,
        ),
        check(
          'totalPages consistent',
          totalPages === Math.ceil(totalItems / pageSize),
          Math.ceil(totalItems / pageSize),
          totalPages,
        ),
        check(
          'page within range',
          page >= 1 && page <= Math.max(totalPages, 1),
          `1..${Math.max(totalPages, 1)}`,
          page,
        ),
        ...(requestedPage === undefined
          ? []
          : [
              check(
                'page echoes request',
                page === Number(requestedPage),
                Number(requestedPage),
                page,
              ),
            ]),
      ],
      'pagination checks',
    );
  },
});
