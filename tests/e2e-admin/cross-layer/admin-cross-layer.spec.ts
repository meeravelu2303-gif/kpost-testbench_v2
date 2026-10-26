import { testData } from '@config/test-data.config';
import { openAdminMongoReader } from '@database/admin-mongo';
import { expect, test } from '@fixtures';
import { ObjectId, type Document } from 'mongodb';
import { requireAdminUiSession } from '../support/admin-screen';
import {
  adminApiAsPage,
  confirmDelete,
  drawer,
  expectNoLiveWrites,
  guardAdminHosts,
  nextAdminCall,
  openAdd,
  openAdminScreen,
  openList,
  openTab,
  qaName,
  requireAdminUiWrites,
  requireTestAdminApi,
  rowAction,
  savedId,
  stage,
  tableRow,
} from '../support/admin-workflow';

/**
 * CROSS-LAYER (UI → API → DB) for **Admin / HR-Setup**: a workplace tier is created on the real Work Place
 * Setup screen, the request the screen sent and the answer it got are captured, and the Admin backend's
 * MongoDB document (`admin_enterprise.table_admin_tier_attribute`, `AdminTierAttributeEntity`) must hold
 * exactly that name for the signed-in company; after the delete on screen, the document must be gone
 * (hard `deleteById`). The database is only READ, through `src/database/admin-mongo.ts` (find/findOne only).
 * Host-guarded like every Admin write test. Matrix: docs/reference/cross-layer-matrix.md.
 */
interface TierDoc extends Document {
  _id: ObjectId;
  company_id?: string;
  attribute_name?: string;
}

test.describe(
  'Admin cross-layer · Work Place tier (UI → API → MongoDB)',
  { tag: '@admin-ui' },
  () => {
    test.describe.configure({ timeout: 180_000 });
    requireAdminUiSession();
    requireAdminUiWrites();

    test(
      'a tier made on screen is stored for the company, and a delete on screen removes it @ui',
      {
        annotation: [
          {
            type: 'cross-layer',
            description:
              'Admin: Work Place Setup tier create + delete on screen → adminTierAttribute/save, /delete → MongoDB table_admin_tier_attribute',
          },
        ],
      },
      async ({ page }) => {
        const mongo = await openAdminMongoReader();
        test.skip(
          !mongo,
          'ADMIN_MONGO_URI is not configured (read-only) — needed to judge the Admin document',
        );
        const guard = await guardAdminHosts(page);
        const name = qaName('xlayer tier');
        let id: string | undefined;
        let deleted = false;
        try {
          await openAdminScreen(page, '/workplace-setup', /Work Place Setup/);
          await openTab(page, 'Tier');
          await openList(page);
          await expect
            .poll(() => guard.adminHosts.size, {
              message: 'the screen loaded its data',
              timeout: 20_000,
            })
            .toBeGreaterThan(0);
          requireTestAdminApi(guard);

          await stage(
            'UI + API: the tier is saved from the drawer',
            async () => {
              await openAdd(page);
              await drawer(page).getByPlaceholder('Enter Name of the Tier').fill(name);
              const sent = page.waitForRequest((r) => r.url().includes('/adminTierAttribute/save'));
              const saved = await nextAdminCall(page, '/adminTierAttribute/save', () =>
                drawer(page).locator('button.savebutton').click(),
              );
              const body = (await sent).postDataJSON() as Array<{ attributeName?: string }>;
              expect(body?.[0]?.attributeName, 'the screen sent the typed name').toBe(name);
              expect(saved.status, 'the API answers 200').toBe(200);
              expect(saved.body.status, 'with SUCCESS').toBe('SUCCESS');
              id = savedId(saved.body.value);
              expect(id, 'and the new id').toMatch(/^[0-9a-f]{24}$/);
            },
            { blocker: true },
          );

          await stage('DB: the document holds the name, for the signed-in company', async () => {
            let doc: TierDoc | null = null;
            await expect
              .poll(
                async () => {
                  doc = await mongo!.findOne<TierDoc>('table_admin_tier_attribute', {
                    _id: new ObjectId(id),
                  });
                  return doc !== null;
                },
                { message: 'the tier document exists', timeout: 20_000 },
              )
              .toBe(true);
            test.info().annotations.push({
              type: 'observed',
              description: `document: ${JSON.stringify({ company_id: doc!.company_id, attribute_name: doc!.attribute_name })}`,
            });
            expect(doc!.attribute_name, 'attribute_name = the name typed on screen').toBe(name);
            expect(
              String(doc!.company_id),
              'company_id = the signed-in company (from the token)',
            ).toBe(String(testData.businessMCompanyId));
          });

          await stage('UI → DB: a delete on screen removes the document', async () => {
            await openList(page);
            await rowAction(page, await tableRow(page, name), 'Delete');
            const removed = await nextAdminCall(page, '/adminTierAttribute/delete', () =>
              confirmDelete(page),
            );
            expect(removed.body.status, 'the delete answers SUCCESS').toBe('SUCCESS');
            deleted = true;
            await expect
              .poll(
                () =>
                  mongo!.findOne<TierDoc>('table_admin_tier_attribute', { _id: new ObjectId(id) }),
                { message: 'the tier document is gone', timeout: 20_000 },
              )
              .toBeNull();
          });

          expectNoLiveWrites(guard);
        } finally {
          if (id && !deleted)
            await adminApiAsPage(page, '/adminTierAttribute/delete', { id }).catch(() => undefined);
          await mongo?.close();
        }
      },
    );
  },
);
