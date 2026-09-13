import { describeEndpointCases } from '@engine/endpoint-cases';
import { test } from '@fixtures';

/**
 * WHAT is tested: the KMail reads — dashboards, counts, lists, subjects, drafts, settings,
 * translation. HOW is owned by the central validation engine. The parameterless GETs and
 * contact-scoped reads run on live (our own account); the id-keyed reads skip (`needs-id`).
 */
test.describe('KPost KMail · reads', () => {
  describeEndpointCases({ tags: ['kmail-read'] }, { allowEmpty: true });
});
