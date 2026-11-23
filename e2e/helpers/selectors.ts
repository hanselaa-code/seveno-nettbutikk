import { expect, type Locator, type Page } from '@playwright/test';

export function getHeader(page: Page): Locator {
  return page.getByRole('banner').first();
}

export function getFooter(page: Page): Locator {
  return page.getByRole('contentinfo').first();
}

export function getLogoLink(page: Page): Locator {
  return getHeader(page).getByRole('link', { name: /seveno/i }).first();
}

export function getLogoImage(page: Page): Locator {
  return getHeader(page).locator('img').first();
}

export function getMobileMenuButton(page: Page): Locator {
  return getHeader(page)
    .getByRole('button', { name: /meny|navigasjon|åpne meny|lukk meny/i })
    .first();
}

export function getNavLink(page: Page, nameRegex: RegExp): Locator {
  return getHeader(page).getByRole('navigation').getByRole('link', { name: nameRegex }).first();
}

export function getMobileNavDrawer(page: Page, linkRegex?: RegExp): Locator {
  const nonAiDialog = page
    .getByRole('dialog')
    .filter({ hasNot: page.locator('textarea, input[type="text"]') });
  const headerNav = page.locator('header nav');
  const base = nonAiDialog.or(headerNav);
  const filtered = linkRegex
    ? base.filter({ has: page.getByRole('link', { name: linkRegex }) })
    : base;
  return filtered.locator('visible=true').first();
}

export async function isMobileMenuVisible(page: Page): Promise<boolean> {
  const btn = getMobileMenuButton(page);
  return (await btn.count()) > 0 && (await btn.isVisible());
}

export async function openMobileMenuIfNeeded(page: Page): Promise<boolean> {
  if (!(await isMobileMenuVisible(page))) return false;
  const btn = getMobileMenuButton(page);
  const expanded = await btn.getAttribute('aria-expanded');
  if (expanded !== 'true') {
    await btn.click();
  }
  return true;
}

export async function closeMobileMenuIfOpen(page: Page): Promise<void> {
  const btn = getMobileMenuButton(page);
  if ((await btn.count()) > 0 && (await btn.isVisible())) {
    const expanded = await btn.getAttribute('aria-expanded');
    if (expanded === 'true') {
      const closeBtn = getMobileNavDrawer(page).getByRole('button', { name: /lukk meny/i }).first();
      if ((await closeBtn.count()) > 0 && (await closeBtn.isVisible().catch(() => false))) {
        await closeBtn.click();
      } else {
        await page.keyboard.press('Escape');
      }
    }
  }
}

export async function navigateStorefront(page: Page, linkRegex: RegExp): Promise<void> {
  const openedDrawer = await openMobileMenuIfNeeded(page);
  if (openedDrawer) {
    const drawer = getMobileNavDrawer(page, linkRegex);
    const drawerLink = drawer.getByRole('link', { name: linkRegex }).first();
    await expect(drawerLink).toBeVisible();
    await drawerLink.click();
    return;
  }

  const navLink = getNavLink(page, linkRegex);
  await expect(navLink).toBeVisible();
  await navLink.click();
}

export function getCategoryCardLink(
  page: Page,
  categoryNameRegex: RegExp,
  slug?: string,
): Locator {
  if (slug) {
    return page
      .locator(`main a[href="/kategori/${slug}"]`)
      .filter({ hasText: categoryNameRegex })
      .first();
  }
  return page.locator('main').getByRole('link', { name: categoryNameRegex }).first();
}

export function getProductLinkByTitle(page: Page, title: string | RegExp): Locator {
  return page.locator('a[href^="/produkt/"]').filter({ hasText: title }).first();
}

export function getProductCardByTitle(page: Page, title: string | RegExp): Locator {
  const headingOrLink = page
    .locator('main a[href^="/produkt/"]')
    .filter({ hasText: title })
    .first();
  const semanticCard = headingOrLink.locator('xpath=ancestor::*[self::article or self::li][1]');
  const divCardWithImgAndBtn = headingOrLink.locator(
    'xpath=ancestor::div[.//button and .//img and not(descendant::article or descendant::li) and not(ancestor::article or ancestor::li)][1]',
  );
  const divCardWithBtn = headingOrLink.locator(
    'xpath=ancestor::div[.//button and not(.//img) and not(descendant::article or descendant::li) and not(ancestor::article or ancestor::li)][1]',
  );
  return semanticCard.or(divCardWithImgAndBtn).or(divCardWithBtn).or(headingOrLink).first();
}

export function getAllProductLinks(page: Page): Locator {
  return page.locator('main a[href^="/produkt/"]');
}

export function getCartButton(page: Page): Locator {
  return getHeader(page)
    .getByRole('button', { name: /handlekurv/i })
    .or(page.getByRole('button', { name: /handlekurv/i }))
    .first();
}

export function getCartDrawer(page: Page): Locator {
  return page
    .getByRole('dialog')
    .filter({ has: page.getByRole('heading', { name: /handlekurv/i }) })
    .or(
      page
        .getByRole('complementary')
        .filter({ has: page.getByRole('heading', { name: /handlekurv/i }) }),
    )
    .first();
}

export async function openCartDrawer(page: Page): Promise<Locator> {
  const drawer = getCartDrawer(page);
  if ((await drawer.count()) > 0 && (await drawer.isVisible())) {
    return drawer;
  }
  const cartBtn = getCartButton(page);
  await expect(cartBtn).toBeVisible();
  await cartBtn.click();
  await expect(drawer).toBeVisible();
  return drawer;
}

export function getCartItemRow(drawer: Locator, title: string | RegExp): Locator {
  return drawer
    .locator('li, article, div')
    .filter({ hasText: title })
    .filter({ has: drawer.page().getByRole('button', { name: /fjern/i }) })
    .last();
}

function fieldControl(scope: Locator, labelRegex: RegExp, placeholderRegex?: RegExp): Locator {
  const controls = scope.locator('input, textarea, select');
  const byLabel = controls.and(scope.getByLabel(labelRegex));
  if (!placeholderRegex) return byLabel.first();
  const byPlaceholder = controls.and(scope.getByPlaceholder(placeholderRegex));
  return byLabel.or(byPlaceholder).first();
}

export function getCheckoutFormFields(page: Page) {
  const main = page.locator('main');
  return {
    name: fieldControl(main, /fullt navn|^navn/i, /navn/i),
    email: fieldControl(main, /e-?post/i, /e-?post/i),
    phone: fieldControl(main, /telefon|mobil/i, /telefon|mobil|\+47/i),
    street: fieldControl(main, /^gateadresse$/i, /storgata/i),
    postalCode: fieldControl(main, /postnummer|postnr/i, /postnummer|0150/i),
    city: fieldControl(main, /poststed|sted|by/i, /poststed|oslo/i),
    submit: main
      .getByRole('button', { name: /fullfør|send bestilling|bekreft bestilling|bestill/i })
      .first(),
  };
}

export type PaymentProviderChoice = 'test_order' | 'klarna' | 'vipps';

export function getPaymentOption(page: Page, provider: PaymentProviderChoice): Locator {
  const regex =
    provider === 'klarna'
      ? /klarna/i
      : provider === 'vipps'
        ? /vipps/i
        : /testbestilling|testordre|test_order/i;

  const main = page.locator('main');
  return main
    .getByRole('radio', { name: regex })
    .or(main.locator('label').filter({ hasText: regex }))
    .or(main.getByRole('button', { name: regex }))
    .first();
}

export function getContactFormFields(page: Page) {
  const main = page.locator('main');
  return {
    name: fieldControl(main, /navn/i, /navn/i),
    email: fieldControl(main, /e-?post/i, /e-?post/i),
    subject: fieldControl(main, /emne/i, /emne/i),
    message: fieldControl(main, /melding|beskjed/i, /melding|beskjed/i),
    submit: main
      .getByRole('button', { name: /send henvendelse|send melding|^send$/i })
      .first(),
  };
}

export function getAdminLoginFields(page: Page) {
  const main = page.locator('main');
  return {
    email: fieldControl(main, /e-?post/i, /e-?post/i),
    password: fieldControl(main, /passord/i, /passord/i),
    submit: main.getByRole('button', { name: /^(?!.*google).*logg inn/i }).first(),
  };
}

export async function openAdminTab(page: Page, tabRegex: RegExp): Promise<void> {
  const tab = page.getByRole('tab', { name: tabRegex }).first();
  await expect(tab).toBeVisible({ timeout: 15_000 });
  const selected = await tab.getAttribute('aria-selected');
  if (selected !== 'true') {
    await tab.click();
  }
  await expect(tab).toHaveAttribute('aria-selected', 'true');
}

export function getVisibleAdminProductRows(page: Page, title?: string | RegExp): Locator {
  let rows = page
    .locator('main tr, main li, main article')
    .filter({ has: page.getByRole('button', { name: /rediger|slett/i }) })
    .locator('visible=true');
  if (title !== undefined) {
    rows = rows.filter({ hasText: title });
  }
  return rows;
}

export function getAdminProductFormFields(page: Page) {
  const main = page.locator('main');
  const productForm = main
    .locator('form')
    .filter({
      has: page
        .getByLabel(/produkttittel|tittel|produktnavn/i)
        .or(page.getByPlaceholder(/tittel|produktnavn/i)),
    })
    .first();

  return {
    title: fieldControl(productForm, /produkttittel|tittel|produktnavn/i, /tittel|produktnavn/i),
    category: fieldControl(productForm, /kategori/i),
    price: fieldControl(productForm, /pris/i, /pris/i),
    stock: fieldControl(productForm, /lager|beholdning|antall/i, /lager|beholdning/i),
    description: fieldControl(productForm, /beskrivelse/i, /beskrivelse/i),
    specs: fieldControl(productForm, /spesifikasjoner|egenskaper/i, /spesifikasjoner/i),
    imageUrl: fieldControl(productForm, /bilde-?url|bildeadresse|bildelenke/i, /https?:\/\/|bilde-?url/i),
    submit: productForm
      .locator('button[type="submit"]')
      .or(
        productForm.getByRole('button', {
          name: /opprett produkt|lagre produkt|lagre endringer|oppdater|lagre/i,
        }),
      )
      .first(),
  };
}

export function getAiLauncher(page: Page): Locator {
  return page
    .getByRole('button', {
      name: /seveno.*ai|ai-?assistent|ai-?hjelp|hjelpebot|spør.*ai|spør.*seveno|åpne.*chat|chat/i,
    })
    .first();
}

export function getAiPanel(page: Page): Locator {
  const chatTextbox = page.locator('textarea, input[type="text"]');
  const byDialogName = page.getByRole('dialog', {
    name: /seveno|ai|assistent|hjelp|chat/i,
  });
  const byDialogContent = page
    .getByRole('dialog')
    .filter({ has: chatTextbox })
    .filter({ hasText: /seveno|ai|assistent|hjelp/i });
  const byContainer = page
    .locator('section, aside, div[role="region"], [role="complementary"]')
    .filter({ has: chatTextbox })
    .filter({ has: page.getByRole('button', { name: /lukk|minimer|avslutt|×/i }) })
    .filter({ hasText: /seveno|ai|assistent|hjelp/i });

  return byDialogName.or(byDialogContent).or(byContainer).first();
}

export function getAiInput(panel: Locator): Locator {
  return panel.getByRole('textbox').or(panel.locator('textarea, input[type="text"]')).first();
}

export function getAiSendButton(panel: Locator): Locator {
  return panel.getByRole('button', { name: /send|spør/i }).first();
}

export async function closeAiPanelIfOpen(page: Page): Promise<void> {
  const panel = getAiPanel(page);
  if ((await panel.count()) > 0 && (await panel.isVisible().catch(() => false))) {
    const closeBtn = panel.getByRole('button', { name: /lukk|minimer|avslutt|×|x/i }).first();
    if ((await closeBtn.count()) > 0 && (await closeBtn.isVisible().catch(() => false))) {
      await closeBtn.click();
      await expect(panel).toBeHidden();
    }
  }
}
