import { JPEG_1X1 } from '@api/definitions/kpost/profile/image.api';
import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';
import { gotoKatchup, parkPointerAwayFromSideMenu } from './support/katchup';

/**
 * Group creation — **group photo select and crop** (FR-GC-004, FR-GC-005; Group FRD §6 "Group Photo
 * Selection — Photo Picker Sheet" / "Group Photo Editor").
 *
 * Read from source (`bubble/ContactList/ContactList.js`, `common/ImageCropper/ImageCropper.js`,
 * 2026-10-11): the Katchup list's Contacts tab has a "Create New Group" icon
 * (`.icon-KP_112-Group-Add` → `createGrp.modal`); the modal shows the photo placeholder
 * (`img.grpImg_Circle`, default icon) over a hidden `input#ImgInput[type=file][accept="image/*"]`
 * (`handleCreateGrpImg` → `readFile` → `setCropper(true)`); the "Image Cropper" modal (react-easy-crop,
 * `aspect={1}`, Cancel / Done) returns a cropped JPEG `File` via `getCroppedPic` → `createGrp.grpImg`,
 * which the placeholder then shows through `URL.createObjectURL` (a `blob:` src).
 *
 * The group is never created: the modal is closed after the photo is set, so nothing is written.
 */
test.describe(
  'KPost Katchup · create group photo select + crop (FR-GC-004/005)',
  { tag: ['@ui', '@group', '@regression'] },
  () => {
    test.skip(
      !testData.kpostId || testData.kpostId.includes('qa.bench'),
      'needs a real live account (QA_KPOST_ID)',
    );

    test('the photo placeholder takes a picked image, the cropper opens, and Done applies the cropped photo @ui', async ({
      page,
    }) => {
      await gotoKatchup(page);
      await parkPointerAwayFromSideMenu(page);
      await page
        .getByRole('tab', { name: 'Contacts' })
        .or(page.getByText('Contacts', { exact: true }))
        .first()
        .click();
      const createIcon = page.locator('.icon-KP_112-Group-Add').first();
      await expect(createIcon, 'the Contacts tab offers Create Group').toBeVisible({
        timeout: 15_000,
      });
      await createIcon.click();

      const modal = page.getByRole('dialog').filter({ hasText: /Create New Group/i });
      await expect(modal, 'the Create New Group modal opens').toBeVisible({ timeout: 15_000 });
      const placeholder = modal.locator('img.grpImg_Circle').first();
      await expect(placeholder, 'the group photo placeholder renders').toBeVisible();
      const before = (await placeholder.getAttribute('src')) ?? '';
      expect(before.startsWith('blob:'), 'the placeholder starts as the default icon').toBe(false);

      // FR-GC-004: pick an image through the placeholder's file input (the photo picker sheet).
      const input = modal.locator('input#ImgInput[type="file"]');
      await expect(input, 'the picker input accepts images only').toHaveAttribute(
        'accept',
        'image/*',
      );
      await input.setInputFiles({
        name: 'qa-group-photo.jpg',
        mimeType: 'image/jpeg',
        buffer: Buffer.from(JPEG_1X1, 'base64'),
      });

      // FR-GC-005: the photo editor opens with a crop area and Done applies it.
      const cropper = page.getByRole('dialog').filter({ hasText: /Image Cropper/i });
      await expect(cropper, 'the Image Cropper opens for the picked photo').toBeVisible({
        timeout: 15_000,
      });
      await expect(cropper.locator('.crop-container'), 'it shows a crop area').toBeVisible();
      await expect(
        cropper.getByRole('button', { name: /^Cancel$/i }),
        'offers Cancel',
      ).toBeVisible();
      await cropper.getByRole('button', { name: /^Done$/i }).click();
      await expect(cropper, 'Done closes the editor').toBeHidden({ timeout: 15_000 });
      await expect
        .poll(async () => (await placeholder.getAttribute('src')) ?? '', {
          message: 'the cropped photo replaces the placeholder (object URL)',
          timeout: 15_000,
        })
        .toMatch(/^blob:/);

      // Leave without creating the group.
      // ModalComponent's header close is a react-icons `AiOutlineClose` svg with class `Icon_Style`.
      await modal.locator('.modal-header svg.Icon_Style').first().click();
      await expect(modal, 'the modal closes; no group was created').toBeHidden({ timeout: 10_000 });
    });
  },
);
