import { expect, test } from '@playwright/test';
import {
  attachRuntimeMonitor,
  expectHealthyLogoAndImages,
  expectNoHorizontalOverflow,
  extractAndAssertOrderMath,
  parseNok,
} from '../helpers/assertions';
import {
  closeAiPanelIfOpen,
  closeMobileMenuIfOpen,
  getAiLauncher,
  getAiPanel,
  getCartButton,
  getCartDrawer,
  getCartItemRow,
  getCategoryCardLink,
  getCheckoutFormFields,
  getContactFormFields,
  getMobileMenuButton,
  getProductCardByTitle,
  getProductLinkByTitle,
  getVisibleAdminProductRows,
  navigateStorefront,
  openCartDrawer,
  type PaymentProviderChoice,
} from '../helpers/selectors';
import {
  addProductToCartFromCatalog,
  applyAiAppCheckDebugToken,
  askAiAssistant,
  createProductViaAdmin,
  deleteProductViaAdmin,
  ensureStarterCatalogReady,
  fillCheckoutCustomer,
  makeAdminTestProduct,
  makeRunId,
  requireAdminCredsOrSkip,
  signInAdmin,
  STARTER_PRODUCTS,
  submitOrderAndReadConfirmation,
  VALID_NORWEGIAN_CUSTOMER,
} from '../helpers/testdata';

test.describe('Tier 3 — Cross-Feature Pairwise Combinations (T3-01 through T3-14)', () => {
  test.beforeAll(async ({ browser }) => {
    await ensureStarterCatalogReady(browser);
  });

  test.beforeEach(async ({ page }) => {
    await applyAiAppCheckDebugToken(page);
  });

  test('T3-01 Category Showcase -> Product Detail -> Cart Drawer Sync', async ({ page }) => {
    await page.goto('/');
    await getCategoryCardLink(page, /Seveno outdoor/i, 'seveno-outdoor').click();
    await expect(page).toHaveURL(/\/kategori\/seveno-outdoor/);

    await getProductLinkByTitle(page, STARTER_PRODUCTS.pergola.title).click();
    await expect(page).toHaveURL(/\/produkt\//);

    const priceText = await page.locator('main').innerText();
    const expectedPrice = parseNok(priceText.match(/\d[\d\s\u00a0\u202f]*\s*kr/i)?.[0] ?? '0');

    const addBtn = page.getByRole('button', { name: /legg i handlekurv/i }).first();
    await expect(addBtn).toBeEnabled();
    await addBtn.click();

    await expect(getCartButton(page)).toContainText(/1/);
    const drawer = await openCartDrawer(page);
    await expect(drawer).toContainText(STARTER_PRODUCTS.pergola.title);
    expect(parseNok((await drawer.innerText()).match(/\d[\d\s\u00a0\u202f]*\s*kr/i)?.[0] ?? '0')).toBeGreaterThanOrEqual(
      expectedPrice,
    );
  });

  test('T3-02 Cart Persistence Across SPA Routes & Hard Reload', async ({ page }) => {
    await addProductToCartFromCatalog(page, STARTER_PRODUCTS.armySekk);
    const drawer = await openCartDrawer(page);
    await getCartItemRow(drawer, STARTER_PRODUCTS.armySekk.title)
      .getByRole('button', { name: /^\+$|øk/i })
      .first()
      .click();
    await expect(getCartButton(page)).toContainText(/2/);
    await drawer.getByRole('button', { name: /lukk|×/i }).first().click();
    await expect(drawer).toBeHidden();

    await navigateStorefront(page, /seveno home/i);
    await expect(page).toHaveURL(/\/kategori\/seveno-home/);
    await navigateStorefront(page, /kontakt/i);
    await expect(page).toHaveURL(/\/kontakt/);

    await page.goto('/utsjekk');
    await page.reload();

    await expect(getCartButton(page)).toContainText(/2/);
    await expect(page.locator('main')).toContainText(STARTER_PRODUCTS.armySekk.title, {
      timeout: 15_000,
    });
  });

  test('T3-03 Multi-Source Add Merge & Stock Cap Enforcement', async ({ page }, testInfo) => {
    const adminCreds = await requireAdminCredsOrSkip(testInfo);
    const product = makeAdminTestProduct(makeRunId(), {
      title: `KomboLager ${makeRunId()}`,
      stock: 3,
      priceNok: 690,
    });

    await signInAdmin(page, adminCreds);
    try {
      await createProductViaAdmin(page, product);

      // Source 1: add from category card if card has button, else detail
      await addProductToCartFromCatalog(page, {
        title: product.title,
        categorySlug: product.categorySlug,
      });

      // Source 2: add again from product detail view
      await page.goto(`/kategori/${product.categorySlug}`);
      await getProductLinkByTitle(page, product.title).click();
      await page.getByRole('button', { name: /legg i handlekurv/i }).first().click();

      const drawer = await openCartDrawer(page);
      await expect(drawer.getByRole('button', { name: /fjern/i })).toHaveCount(1);
      await expect(drawer.getByText(product.title)).toHaveCount(1);
      await expect(getCartButton(page)).toContainText(/2/);

      // Increment to stock cap (3) and verify cannot exceed 3
      const incBtn = getCartItemRow(drawer, product.title)
        .getByRole('button', { name: /^\+$|øk/i })
        .first();
      await incBtn.click();
      if (await incBtn.isEnabled().catch(() => false)) {
        await incBtn.click();
      }
      await expect(getCartButton(page)).toContainText(/3/);
      await expect(getCartButton(page)).not.toContainText(/4/);
    } finally {
      await deleteProductViaAdmin(page, product.title).catch(() => {});
    }
  });

  test('T3-04 Payment Provider Selection Matrix (Vipps vs Klarna vs Testordre) -> Ordrebekreftelse', async ({
    page,
  }) => {
    const providers: PaymentProviderChoice[] = ['vipps', 'klarna', 'test_order'];

    for (const provider of providers) {
      await addProductToCartFromCatalog(page, STARTER_PRODUCTS.skobeholder);
      const { orderNumber, confirmationText } = await submitOrderAndReadConfirmation(page, provider);

      expect(orderNumber).toMatch(/^SEV-\d{4}-[A-Z0-9]{4}$/);
      if (provider === 'vipps') expect(confirmationText).toMatch(/Vipps/i);
      if (provider === 'klarna') expect(confirmationText).toMatch(/Klarna/i);
      if (provider === 'test_order') expect(confirmationText).toMatch(/test/i);

      await page.reload();
      const drawer = await openCartDrawer(page);
      await expect(drawer).toContainText(/tom|ingen varer/i);
    }
  });

  test('T3-05 Checkout Empty-Cart Guard, Norwegian Postal Validation & Live Cart Mutation', async ({
    page,
  }) => {
    await page.goto('/utsjekk');
    await expect(page.locator('main')).toContainText(/tom|ingen varer|handlekurven/i);

    await addProductToCartFromCatalog(page, STARTER_PRODUCTS.armySekk);
    await addProductToCartFromCatalog(page, STARTER_PRODUCTS.skobeholder);

    await page.goto('/utsjekk');
    await fillCheckoutCustomer(page, { ...VALID_NORWEGIAN_CUSTOMER, postalCode: '123' });
    await getCheckoutFormFields(page).submit.click();
    await expect(
      page.getByRole('heading', { name: /ordrebekreftelse|takk for din bestilling/i }),
    ).toHaveCount(0);
    await expect(page.locator('#checkout-postal-code')).toHaveAttribute('aria-invalid', 'true');

    // Mutate cart via drawer before submitting valid order
    const drawer = await openCartDrawer(page);
    await getCartItemRow(drawer, STARTER_PRODUCTS.skobeholder.title)
      .getByRole('button', { name: /fjern/i })
      .first()
      .click();
    await expect(drawer.getByText(STARTER_PRODUCTS.skobeholder.title)).toHaveCount(0);
    await drawer.getByRole('button', { name: /lukk|×/i }).first().click();
    await expect(drawer).toBeHidden();

    const { orderNumber, confirmationText } = await submitOrderAndReadConfirmation(
      page,
      'test_order',
      VALID_NORWEGIAN_CUSTOMER,
    );
    expect(orderNumber).toMatch(/^SEV-\d{4}-[A-Z0-9]{4}$/);
    expect(confirmationText).toContain(STARTER_PRODUCTS.armySekk.title);
    expect(confirmationText).not.toContain(STARTER_PRODUCTS.skobeholder.title);
  });

  test('T3-06 Admin Product Creation -> Immediate Category Visibility & Fallback Image', async ({
    page,
  }, testInfo) => {
    const adminCreds = await requireAdminCredsOrSkip(testInfo);
    const product = makeAdminTestProduct(makeRunId(), {
      title: `Nordisk Testpute ${makeRunId()}`,
      priceNok: 890,
      stock: 5,
      imageUrl: '',
    });

    await signInAdmin(page, adminCreds);
    try {
      await createProductViaAdmin(page, product);

      await page.goto('/kategori/seveno-living');
      const card = getProductCardByTitle(page, product.title);
      await expect(card).toBeVisible();
      await expect(card).toContainText(/890\s*kr/i);
      await expectHealthyLogoAndImages(page);
    } finally {
      await deleteProductViaAdmin(page, product.title).catch(() => {});
    }
  });

  test('T3-07 Admin Stock/Price Edit -> Storefront & Cart Boundary Sync', async ({
    page,
  }, testInfo) => {
    const adminCreds = await requireAdminCredsOrSkip(testInfo);
    const product = makeAdminTestProduct(makeRunId(), {
      title: `PrisLagerSync ${makeRunId()}`,
      priceNok: 990,
      stock: 5,
    });

    await signInAdmin(page, adminCreds);
    try {
      await createProductViaAdmin(page, product);

      await page.goto(`/kategori/${product.categorySlug}`);
      await expect(getProductCardByTitle(page, product.title)).toContainText(/990\s*kr/i);

      await page.goto('/admin');
      const row = getVisibleAdminProductRows(page, product.title)
        .filter({ has: page.getByRole('button', { name: /rediger/i }) })
        .first();
      await expect(row).toBeVisible({ timeout: 15_000 });
      await row.getByRole('button', { name: /rediger/i }).first().click();

      const editDialog = page
        .getByRole('dialog')
        .filter({ has: page.getByLabel(/pris/i).or(page.getByPlaceholder(/pris/i)) })
        .first();
      const editFormInMain = page
        .locator('main form')
        .filter({
          has: page
            .getByLabel(/pris/i)
            .or(page.getByPlaceholder(/pris/i)),
        })
        .last();
      await expect(editDialog.or(editFormInMain).first()).toBeVisible({ timeout: 10_000 });

      const editScope = (await editDialog.isVisible().catch(() => false))
        ? editDialog
        : editFormInMain;
      const priceField = editScope
        .locator('input, textarea, select')
        .and(editScope.getByLabel(/pris/i).or(editScope.getByPlaceholder(/pris/i)))
        .first();
      const stockField = editScope
        .locator('input, textarea, select')
        .and(
          editScope
            .getByLabel(/lager|beholdning|antall/i)
            .or(editScope.getByPlaceholder(/lager|beholdning/i)),
        )
        .first();
      const saveBtn = editScope
        .locator('button[type="submit"]')
        .or(editScope.getByRole('button', { name: /lagre endringer|oppdater|lagre/i }))
        .first();

      await priceField.fill('1190');
      await stockField.fill('0');
      await saveBtn.click();

      const updatedRow = getVisibleAdminProductRows(page, product.title)
        .filter({ hasText: /1[\s\u00a0\u202f.]*190/ })
        .first();
      await expect(updatedRow).toBeVisible({ timeout: 15_000 });

      await page.goto(`/kategori/${product.categorySlug}`);
      await page.reload();
      await getProductLinkByTitle(page, product.title).click();
      await expect(page.locator('main')).toContainText(/1[\s\u00a0\u202f]*190\s*kr/i);
      await expect(page.locator('main')).toContainText(/utsolgt|ikke på lager/i);

      const addBtn = page.getByRole('button', { name: /legg i handlekurv|utsolgt/i }).first();
      if ((await addBtn.count()) > 0) {
        await expect(addBtn).toBeDisabled();
      }
    } finally {
      await deleteProductViaAdmin(page, product.title).catch(() => {});
    }
  });

  test('T3-08 Admin Product Creation -> Immediate AI Assistant Live Catalog Grounding', async ({
    page,
  }, testInfo) => {
    test.setTimeout(75_000);
    const adminCreds = await requireAdminCredsOrSkip(testInfo);
    const runId = makeRunId();
    const product = makeAdminTestProduct(runId, {
      title: `Testlampe Bronse ${runId}`,
      priceNok: 4567,
      stock: 8,
    });

    await signInAdmin(page, adminCreds);
    try {
      await createProductViaAdmin(page, product);
      await navigateStorefront(page, /^alle$|alle produkter/i);

      const { replyDelta } = await askAiAssistant(
        page,
        `Har dere ${product.title} og hva koster den?`,
      );
      expect(replyDelta).toContain(product.title);
      expect(replyDelta).toMatch(/4[\s\u00a0\u202f]*567/);
    } finally {
      await deleteProductViaAdmin(page, product.title).catch(() => {});
    }
  });

  test('T3-09 Desktop (1440x900) vs Mobile (390x844) Overlay & Viewport Integrity', async ({
    page,
  }) => {
    for (const vp of [
      { width: 1440, height: 900 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(vp);
      await page.goto('/kategori/alle');
      await expectNoHorizontalOverflow(page);

      if (vp.width <= 480) {
        const menuBtn = getMobileMenuButton(page);
        await expect(menuBtn).toBeVisible();
        await menuBtn.click();
        await closeMobileMenuIfOpen(page);
      }

      const drawer = await openCartDrawer(page);
      await expect(drawer).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await drawer.getByRole('button', { name: /lukk|×/i }).first().click();

      await getAiLauncher(page).click();
      const aiPanel = getAiPanel(page);
      await expect(aiPanel).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await aiPanel.getByRole('button', { name: /lukk|minimer|×/i }).first().click();
    }
  });

  test('T3-10 Contact Form Submission + AI Chat + Cart Continuity', async ({ page }) => {
    test.setTimeout(75_000);
    await addProductToCartFromCatalog(page, STARTER_PRODUCTS.pergola);
    await page.goto('/kontakt');

    const contact = getContactFormFields(page);
    await contact.name.fill('Astrid Solberg');
    await contact.email.fill('astrid@example.no');
    await contact.subject.fill(`Levering ${makeRunId()}`);
    await contact.message.fill('Sender spørsmål før bestilling.');
    await contact.submit.click();

    await expect(
      page.getByText(/takk for din henvendelse|meldingen er sendt|mottatt/i).first(),
    ).toBeVisible({ timeout: 15_000 });

    const { replyDelta } = await askAiAssistant(page, 'Hvilke kategorier har Seveno?');
    expect(replyDelta).toMatch(/living|home|outdoor/i);
    await closeAiPanelIfOpen(page);

    await expect(getCartButton(page)).toContainText(/1/);
    const drawer = await openCartDrawer(page);
    await expect(drawer).toContainText(STARTER_PRODUCTS.pergola.title);
  });

  test('T3-11 Direct Deep-Link & Refresh on Category and Product Routes', async ({ browser }) => {
    const routes = [
      { url: '/kategori/seveno-home', expected: /Akryl gjennomsiktig skobeholder/i },
      { url: '/kategori/alle', expected: /Pergola/i },
      { url: `/produkt/${STARTER_PRODUCTS.skobeholder.slug}`, expected: /Akryl gjennomsiktig skobeholder/i },
    ];

    for (const r of routes) {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      try {
        await page.goto(r.url);
        await expect(page.locator('main')).toContainText(r.expected);
        await page.reload();
        await expect(page.locator('main')).toContainText(r.expected);
        await expectHealthyLogoAndImages(page);
      } finally {
        await ctx.close();
      }
    }
  });

  test('T3-12 Admin Auth Boundary vs Guest Customer Checkout Isolation', async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    try {
      await page.goto('/admin');
      await expect(page.getByRole('button', { name: /logg inn/i }).first()).toBeVisible();
      await expect(page.getByRole('button', { name: /opprett produkt|slett/i })).toHaveCount(0);

      // Same unauthenticated visitor completes guest customer checkout
      await addProductToCartFromCatalog(page, STARTER_PRODUCTS.armySekk);
      const { orderNumber } = await submitOrderAndReadConfirmation(page, 'test_order');
      expect(orderNumber).toMatch(/^SEV-\d{4}-[A-Z0-9]{4}$/);
    } finally {
      await ctx.close();
    }
  });

  test('T3-13 NOK Subtotal, Shipping Threshold & 25% MVA Consistency', async ({ page }) => {
    // Low-value order (Skobeholder)
    await addProductToCartFromCatalog(page, STARTER_PRODUCTS.skobeholder);
    await page.goto('/utsjekk');
    await expect(page.locator('main')).toContainText(/Delsum/i, { timeout: 15_000 });
    await expect(page.locator('main')).toContainText(/Totalt/i, { timeout: 15_000 });
    const lowText = await page.locator('main').innerText();
    const lowTotals = extractAndAssertOrderMath(lowText);
    expect(lowTotals.shippingNok).toBe(99);

    // High-value order (Pergola)
    await addProductToCartFromCatalog(page, STARTER_PRODUCTS.pergola);
    const { confirmationText } = await submitOrderAndReadConfirmation(page, 'test_order');
    const highTotals = extractAndAssertOrderMath(confirmationText);
    expect(highTotals.shippingNok).toBe(0);
  });

  test('T3-14 Admin Product Deletion -> Storefront Removal & Clean Teardown', async ({
    page,
  }, testInfo) => {
    const adminCreds = await requireAdminCredsOrSkip(testInfo);
    const product = makeAdminTestProduct(makeRunId(), {
      title: `Slettetest ${makeRunId()}`,
    });

    await signInAdmin(page, adminCreds);
    try {
      await createProductViaAdmin(page, product);

      await page.goto(`/kategori/${product.categorySlug}`);
      await expect(getProductLinkByTitle(page, product.title)).toBeVisible();

      await deleteProductViaAdmin(page, product.title);

      await page.goto(`/kategori/${product.categorySlug}`);
      await expect(getProductLinkByTitle(page, STARTER_PRODUCTS.armySekk.title)).toBeVisible({
        timeout: 15_000,
      });
      await expect(getProductLinkByTitle(page, product.title)).toHaveCount(0);

      await page.goto('/kategori/alle');
      await expect(getProductLinkByTitle(page, STARTER_PRODUCTS.armySekk.title)).toBeVisible({
        timeout: 15_000,
      });
      await expect(getProductLinkByTitle(page, product.title)).toHaveCount(0);
    } finally {
      await deleteProductViaAdmin(page, product.title).catch(() => {});
    }
  });

  void getCartDrawer;
  void attachRuntimeMonitor;
});
