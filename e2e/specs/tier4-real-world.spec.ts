import { expect, test } from '@playwright/test';
import {
  attachRuntimeMonitor,
  expectBrandPaletteAndWcagContrast,
  expectHealthyLogoAndImages,
  expectNoHorizontalOverflow,
  expectNoLeakedSecrets,
  extractAndAssertOrderMath,
} from '../helpers/assertions';
import {
  closeAiPanelIfOpen,
  getCartButton,
  getCartItemRow,
  getCategoryCardLink,
  getContactFormFields,
  getProductLinkByTitle,
  navigateStorefront,
  openCartDrawer,
} from '../helpers/selectors';
import {
  addProductToCartFromCatalog,
  applyAiAppCheckDebugToken,
  askAiAssistant,
  createProductViaAdmin,
  deleteProductViaAdmin,
  ensureStarterCatalogReady,
  makeAdminTestProduct,
  makeRunId,
  requireAdminCredsOrSkip,
  signInAdmin,
  STARTER_PRODUCTS,
  submitOrderAndReadConfirmation,
  VALID_NORWEGIAN_CUSTOMER,
} from '../helpers/testdata';

test.describe('Tier 4 — Real-World Norwegian E-Commerce Journeys', () => {
  test.beforeAll(async ({ browser }) => {
    await ensureStarterCatalogReady(browser);
  });

  test.beforeEach(async ({ page }) => {
    await applyAiAppCheckDebugToken(page);
  });

  test('T4-01 Desktop Discovery -> Multi-Item Purchase via Vipps', async ({ page }) => {
    const monitor = attachRuntimeMonitor(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');

    // Discover Pergola in Seveno outdoor
    await getCategoryCardLink(page, /Seveno outdoor/i, 'seveno-outdoor').click();
    await getProductLinkByTitle(page, STARTER_PRODUCTS.pergola.title).click();
    await page.getByRole('button', { name: /legg i handlekurv/i }).first().click();
    await expect(getCartButton(page)).toContainText(/1/);

    // Discover Army sekk in Seveno living
    await addProductToCartFromCatalog(page, STARTER_PRODUCTS.armySekk);
    await expect(getCartButton(page)).toContainText(/2/);

    // Increment Army sekk to qty 2 in Cart Drawer
    const drawer = await openCartDrawer(page);
    await getCartItemRow(drawer, STARTER_PRODUCTS.armySekk.title)
      .getByRole('button', { name: /^\+$|øk/i })
      .first()
      .click();

    await expect(getCartButton(page)).toContainText(/3/);
    await drawer.getByRole('button', { name: /lukk handlekurv/i }).first().click();
    await expect(drawer).toBeHidden();

    const { orderNumber, confirmationText } = await submitOrderAndReadConfirmation(
      page,
      'vipps',
      VALID_NORWEGIAN_CUSTOMER,
    );
    expect(orderNumber).toMatch(/^SEV-\d{4}-[A-Z0-9]{4}$/);
    expect(confirmationText).toMatch(/Vipps/i);
    expect(confirmationText).toContain(STARTER_PRODUCTS.pergola.title);
    expect(confirmationText).toContain(STARTER_PRODUCTS.armySekk.title);

    // Verify cart resets to empty
    await expect(getCartButton(page)).toContainText(/0/);
    await page.reload();
    const reopened = await openCartDrawer(page);
    await expect(reopened).toContainText(/tom|ingen varer/i);

    monitor.assertClean();
  });

  test('T4-02 Mobile Shopper (390x844) -> AI Inquiry -> Klarna Checkout', async ({ page }) => {
    test.setTimeout(75_000);
    const monitor = attachRuntimeMonitor(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');

    await navigateStorefront(page, /Seveno home/i);
    await expect(page).toHaveURL(/\/kategori\/seveno-home/);
    await expect(page.locator('[aria-busy="true"]')).toHaveCount(0, { timeout: 15_000 });
    await expectNoHorizontalOverflow(page);
    await expectHealthyLogoAndImages(page);

    await getProductLinkByTitle(page, STARTER_PRODUCTS.skobeholder.title).click();
    await expectNoHorizontalOverflow(page);

    const { replyDelta } = await askAiAssistant(
      page,
      'Hvor mange sko eller hvilken skostørrelse passer i akryl skobeholder?',
    );
    expect(replyDelta).toMatch(/sko|akryl|beholder|størrelse|par/i);
    await closeAiPanelIfOpen(page);

    await page.getByRole('button', { name: /legg i handlekurv/i }).first().click();
    await expect(getCartButton(page)).toContainText(/1/);
    const { orderNumber, confirmationText } = await submitOrderAndReadConfirmation(page, 'klarna');
    expect(orderNumber).toMatch(/^SEV-\d{4}-[A-Z0-9]{4}$/);
    expect(confirmationText).toMatch(/Klarna/i);

    monitor.assertClean();
  });

  test('T4-03 Pre-Purchase Inquiry Recovery (/kontakt) + AI Product Comparison', async ({
    page,
  }) => {
    test.setTimeout(75_000);
    const monitor = attachRuntimeMonitor(page);
    await page.goto('/kontakt');

    const contact = getContactFormFields(page);
    await contact.name.fill('Maren Solheim');
    await contact.email.fill('ikke-gyldig');
    await contact.subject.fill('Produktspørsmål');
    await contact.message.fill('Lurer på forskjellen på Army sekk og Pergola.');
    await contact.submit.click();

    await expect(contact.email).toHaveAttribute('aria-invalid', 'true');
    await expect(
      page.getByText(/takk for din henvendelse|meldingen er sendt/i),
    ).toHaveCount(0);

    // Recover with valid Norwegian email
    await contact.email.fill('maren.solheim@example.no');
    await contact.submit.click();
    await expect(
      page.getByText(/takk for din henvendelse|meldingen er sendt|mottatt/i).first(),
    ).toBeVisible({ timeout: 15_000 });

    const { replyDelta } = await askAiAssistant(
      page,
      'Hva er forskjellen på Army sekk og Pergola i pris og bruk?',
    );
    expect(replyDelta).toMatch(/Army sekk/i);
    expect(replyDelta).toMatch(/Pergola/i);

    monitor.assertClean();
  });

  test('T4-04 Store Admin Live Catalog Publication -> Storefront & AI Verification + Cleanup', async ({
    page,
  }, testInfo) => {
    test.setTimeout(75_000);
    const monitor = attachRuntimeMonitor(page);
    const adminCreds = await requireAdminCredsOrSkip(testInfo);
    const runId = makeRunId();
    const product = makeAdminTestProduct(runId, {
      title: `Nordisk ullpledd ${runId}`,
      priceNok: 1290,
      stock: 10,
      imageUrl: '',
    });

    await signInAdmin(page, adminCreds);
    try {
      await createProductViaAdmin(page, product);

      await navigateStorefront(page, /Seveno living/i);
      await expect(getProductLinkByTitle(page, product.title)).toBeVisible();
      await expectHealthyLogoAndImages(page);

      const { replyDelta } = await askAiAssistant(
        page,
        `Selger dere ${product.title}, og hva koster den?`,
      );
      expect(replyDelta).toContain(product.title);
      expect(replyDelta).toMatch(/1[\s\u00a0\u202f]*290/);
    } finally {
      await deleteProductViaAdmin(page, product.title).catch(() => {});
    }

    monitor.assertClean();
  });

  test('T4-05 Multi-Category Gift Shopper -> Cart Mutations, Reload Persistence & MVA Math', async ({
    page,
  }) => {
    const monitor = attachRuntimeMonitor(page);
    await page.setViewportSize({ width: 1440, height: 900 });

    await addProductToCartFromCatalog(page, STARTER_PRODUCTS.armySekk);
    await expect(getCartButton(page)).toContainText(/1/);
    await addProductToCartFromCatalog(page, STARTER_PRODUCTS.skobeholder);
    await expect(getCartButton(page)).toContainText(/2/);
    await addProductToCartFromCatalog(page, STARTER_PRODUCTS.pergola);
    await expect(getCartButton(page)).toContainText(/3/);

    const drawer = await openCartDrawer(page);
    const armyRow = getCartItemRow(drawer, STARTER_PRODUCTS.armySekk.title);
    await armyRow.getByRole('button', { name: /^\+$|øk/i }).first().click();
    await expect(getCartButton(page)).toContainText(/4/);
    await armyRow.getByRole('button', { name: /^-|−$|reduser/i }).first().click();
    await expect(getCartButton(page)).toContainText(/3/);

    await getCartItemRow(drawer, STARTER_PRODUCTS.pergola.title)
      .getByRole('button', { name: /fjern/i })
      .first()
      .click();

    await expect(getCartButton(page)).toContainText(/2/);
    await page.reload();
    await expect(getCartButton(page)).toContainText(/2/);

    const { orderNumber, confirmationText } = await submitOrderAndReadConfirmation(
      page,
      'test_order',
    );
    expect(orderNumber).toMatch(/^SEV-\d{4}-[A-Z0-9]{4}$/);

    extractAndAssertOrderMath(confirmationText);
    monitor.assertClean();
  });

  test('T4-06 Desktop & Mobile Visual, Brand, Contrast & Secret-Hygiene Audit Across All Public Routes', async ({
    page,
  }) => {
    test.slow();
    const monitor = attachRuntimeMonitor(page);
    const capturedPayloads: Array<{ source: string; content: string }> = [];
    const seenUrls = new Set<string>();

    page.on('response', async (res) => {
      const url = res.url();
      if (seenUrls.has(url)) return;
      const ct = res.headers()['content-type'] || '';
      if (
        res.status() === 200 &&
        (/\.js($|\?)/i.test(url) || ct.includes('javascript') || ct.includes('text/html'))
      ) {
        seenUrls.add(url);
        const text = await res.text().catch(() => '');
        if (text) {
          capturedPayloads.push({ source: url, content: text });
        }
      }
    });

    const publicRoutes = [
      '/',
      '/kategori/alle',
      '/kategori/seveno-living',
      '/kategori/seveno-home',
      '/kategori/seveno-outdoor',
      `/produkt/${STARTER_PRODUCTS.armySekk.slug}`,
      '/utsjekk',
      '/kontakt',
    ];

    for (const vp of [
      { width: 1440, height: 900 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(vp);
      for (const route of publicRoutes) {
        await page.goto(route);
        await expect(page.locator('[aria-busy="true"]')).toHaveCount(0, { timeout: 15_000 });
        await expectHealthyLogoAndImages(page);
        await expectNoHorizontalOverflow(page);
        await expectBrandPaletteAndWcagContrast(page);
      }
    }

    expectNoLeakedSecrets(capturedPayloads);
    monitor.assertClean();
  });
});
