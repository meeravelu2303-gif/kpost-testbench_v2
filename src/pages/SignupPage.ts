import type { Page } from '@playwright/test';
import { BasePage } from './BasePage';

/**
 * The signup screen, as far as the bench drives it: account-type selection and the domain control.
 *
 * **It never submits.** Registration is OTP-gated with a global side effect and this environment's
 * mail server is live, so the page object deliberately exposes no `submit()` — the only way to
 * misuse it is to add one.
 *
 * ## Why the react-select handling lives here
 *
 * The form is built from `react-select`, whose menu is a detached portal that mounts on click and
 * unmounts on commit. Driving it needs a small settle between the click and the read, which is
 * exactly the kind of mechanical detail a page object exists to absorb — a spec asserting "Personal
 * offers one domain" should not also be responsible for knowing how the widget mounts.
 *
 * Selectors are taken from the live screen: the controls are `input[id^="react-select"]` in form
 * order (Country, Language, KPOST Domain) and options carry a `-option` class suffix. Addressing
 * them by ORDER rather than by the generated `react-select-N-input` ids is deliberate — those
 * numbers are per mounted instance and shift whenever another select appears anywhere on the page,
 * which would silently point this at the wrong control.
 */
export class SignupPage extends BasePage {
  readonly path = '/signup';

  /** Any open react-select menu's options. */
  private readonly options = this.page.locator(
    '[id^="react-select"][id$="-option"], [class*="-option"]',
  );

  constructor(page: Page) {
    super(page);
  }

  /** The account-type chooser is the screen's first step, so its presence means "loaded". */
  async expectLoaded(): Promise<void> {
    await this.page
      .getByText(/Select Account Option for Signup/i)
      .first()
      .waitFor({ state: 'visible', timeout: 30_000 });
  }

  /** Chooses an account type from "Select Account Option for Signup". */
  async chooseAccountType(type: 'Personal' | 'Business'): Promise<void> {
    await this.page
      .getByText(new RegExp(`^${type}$`, 'i'))
      .first()
      .click();
  }

  /**
   * The domain options offered for the currently selected account type.
   *
   * Country and language are chosen first because the domain list depends on the country — reading
   * it beforehand returns an empty list and would assert nothing.
   */
  async domainOptions(country: string, language: string): Promise<string[]> {
    await this.chooseFromSelect(0, country);
    await this.chooseFromSelect(1, language);

    await this.openSelect(2);
    const texts = await this.options.allInnerTexts();
    return texts.map((value) => value.trim()).filter(Boolean);
  }

  /** Opens the nth select and commits the option matching `filter`. */
  private async chooseFromSelect(index: number, filter: string): Promise<void> {
    await this.openSelect(index);
    /*
     * Typed, then Enter. react-select commits the *highlighted* option, and with no filter text
     * nothing is highlighted — Enter then does nothing, the menu stays open, and it swallows the
     * click meant for the next control.
     */
    await this.page.keyboard.type(filter);
    await this.settle();
    await this.page.keyboard.press('Enter');
    await this.settle();
  }

  private async openSelect(index: number): Promise<void> {
    const input = this.page.locator('input[id^="react-select"]').nth(index);
    await input.waitFor({ state: 'attached', timeout: 20_000 });
    await input.click({ force: true });
    await this.settle();
  }

  /**
   * A short pause for the menu to mount or unmount.
   *
   * A deliberate exception to "never sleep in a test": the thing being waited for is the *absence*
   * of a race inside a third-party widget, and every state-based alternative was tried and was
   * worse — waiting for options to appear fails when the click was swallowed, and waiting for them
   * to disappear fails when the previous menu is still animating. Confined to the page object so no
   * spec has to know about it.
   */
  private async settle(): Promise<void> {
    await this.page.waitForTimeout(700);
  }
}
