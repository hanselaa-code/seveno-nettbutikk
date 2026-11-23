import { expect, test } from '@playwright/test';
import {
  attachRuntimeMonitor,
  computeContrastRatio,
  expectBrandPaletteAndWcagContrast,
  expectHealthyLogoAndImages,
  expectNoHorizontalOverflow,
  extractAndAssertOrderMath,
  extractNokAmount,
} from '../helpers/assertions';
import {
  closeAiPanelIfOpen,
  getAdminProductFormFields,
  getAiInput,
  getAiLauncher,
  getAiPanel,
  getAiSendButton,
  getAllProductLinks,
  getCartButton,
  getCartDrawer,
  getCartItemRow,
  getCategoryCardLink,
  getCheckoutFormFields,
  getContactFormFields,
  getFooter,
  getHeader,
  getLogoImage,
  getLogoLink,
  getMobileMenuButton,
  getMobileNavDrawer,
  getNavLink,
  getPaymentOption,
  getProductCardByTitle,
  getProductLinkByTitle,
  getVisibleAdminProductRows,
  navigateStorefront,
  openAdminTab,
  openCartDrawer,
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
} from '../helpers/testdata';

test.describe('Tier 1 — Feature Coverage (F-01 through F-10)', () => {
  test.beforeEach(async ({ page }) => {
    await applyAiAppCheckDebugToken(page);
  });

  test.describe('F-01: Brand Header, Nav & Footer Shell', () => {
    test('T1-F01-01 Norwegian document language, title, and storefront copy', async ({ page }) => {
      const monitor = attachRuntimeMonitor(page);
      await page.goto('/');

      await expect(page.locator('html')).toHaveAttribute('lang', /^nb/i);
      await expect(page).toHaveTitle(/Seveno/i);

      const bodyText = await page.locator('body').innerText();
      expect(bodyText).toMatch(/Seveno living/i);
      expect(bodyText).toMatch(/Seveno home/i);
      expect(bodyText).toMatch(/Seveno outdoor/i);
      expect(bodyText).not.toMatch(/Lorem ipsum|Welcome to React|Vite App/i);

      monitor.assertClean();
    });

    test('T1-F01-02 Header SEVENO logo rendering, clean framing, and home link', async ({ page }) => {
      await page.goto('/kontakt');

      const header = getHeader(page);
      await expect(header).toBeVisible();
      const logoImg = getLogoImage(page);
      await expect(logoImg).toBeVisible();

      const logoState = await logoImg.evaluate((el) => {
        const img = el as HTMLImageElement;
        return {
          src: img.currentSrc || img.getAttribute('src') || '',
          complete: img.complete,
          naturalWidth: img.naturalWidth,
          renderedHeight: img.getBoundingClientRect().height,
        };
      });
      expect(logoState.complete && logoState.naturalWidth > 0).toBe(true);
      expect(logoState.src).toMatch(/seveno-logo/i);
      expect(logoState.renderedHeight).toBeLessThanOrEqual(96);

      const headerBox = await header.boundingBox();
      expect(headerBox).not.toBeNull();
      expect(headerBox!.height).toBeLessThanOrEqual(112);

      await getLogoLink(page).click();
      await expect(page).toHaveURL(/\/$/);
    });

    test('T1-F01-03 Desktop navigation links & route transitions', async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto('/');

      const routes: Array<{ label: RegExp; expectedUrl: RegExp }> = [
        { label: /^alle$|alle produkter/i, expectedUrl: /\/kategori\/alle/ },
        { label: /seveno living/i, expectedUrl: /\/kategori\/seveno-living/ },
        { label: /seveno home/i, expectedUrl: /\/kategori\/seveno-home/ },
        { label: /seveno outdoor/i, expectedUrl: /\/kategori\/seveno-outdoor/ },
        { label: /kontakt/i, expectedUrl: /\/kontakt/ },
        { label: /admin/i, expectedUrl: /\/admin/ },
      ];

      for (const route of routes) {
        const link = getNavLink(page, route.label);
        await expect(link).toBeVisible();
        await link.click();
        await expect(page).toHaveURL(route.expectedUrl);
      }
    });

    test('T1-F01-04 Mobile navigation drawer open, navigate & close', async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto('/');

      const menuBtn = getMobileMenuButton(page);
      await expect(menuBtn).toBeVisible();
      await menuBtn.click();

      const drawer = getMobileNavDrawer(page, /Seveno outdoor/i);
      await expect(drawer).toBeVisible();
      const outdoorLink = drawer.getByRole('link', { name: /Seveno outdoor/i }).first();
      await expect(outdoorLink).toBeVisible();
      await outdoorLink.click();

      await expect(page).toHaveURL(/\/kategori\/seveno-outdoor/);
      await expect(drawer).toBeHidden();
      await expectNoHorizontalOverflow(page);
    });

    test('T1-F01-05 Header cart trigger & numeric badge persist across routes', async ({ page }) => {
      await addProductToCartFromCatalog(page, STARTER_PRODUCTS.armySekk);

      for (const route of ['/', '/kategori/alle', '/kontakt', '/utsjekk']) {
        await page.goto(route);
        const cartBtn = getCartButton(page);
        await expect(cartBtn).toBeVisible();
        await expect(cartBtn).toContainText(/1/);
      }
    });

    test('T1-F01-06 Persistent Norwegian footer shell across routes', async ({ page }) => {
      for (const route of ['/', '/kategori/alle']) {
        await page.goto(route);
        const footer = getFooter(page);
        await footer.scrollIntoViewIfNeeded();
        await expect(footer).toBeVisible();
        const footerText = await footer.innerText();
        expect(footerText).toMatch(/Seveno/i);
        expect(footerText).toMatch(/Kontakt|Seveno living|Seveno home|Seveno outdoor/i);
        await expect(footer.getByRole('link', { name: /kontakt/i }).first()).toBeVisible();
      }
    });
  });

  test.describe('F-02: Nordic Hero & Category Showcase', () => {
    test('T1-F02-01 Nordic Hero typography & CTA routing', async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto('/');

      const h1 = page.locator('main h1').first();
      await expect(h1).toBeVisible();
      const heroFonts = await page.evaluate(() => {
        const h1El = document.querySelector('main h1');
        const pEl = document.querySelector('main p');
        return {
          headingFont: h1El ? getComputedStyle(h1El).fontFamily : '',
          bodyFont: pEl ? getComputedStyle(pEl).fontFamily : '',
        };
      });
      expect(heroFonts.headingFont).toMatch(/Cormorant|Georgia|serif/i);
      expect(heroFonts.bodyFont).toMatch(/Jakarta|sans-serif|system-ui/i);

      const heroCta = page
        .locator('main a[href^="/kategori/"], main button')
        .filter({ hasText: /utforsk|se produkter|handle|kolleksjon|alle produkter/i })
        .first();
      await expect(heroCta).toBeVisible();
      await heroCta.click();
      await expect(page).toHaveURL(/\/kategori\//);
    });

    test('T1-F02-02 All 3 category showcase cards rendered with imagery', async ({ page }) => {
      await page.goto('/');

      for (const starter of Object.values(STARTER_PRODUCTS)) {
        const card = getCategoryCardLink(page, new RegExp(starter.categoryName, 'i'), starter.categorySlug);
        await expect(card).toBeVisible();
      }
      await expectHealthyLogoAndImages(page);
    });

    test('T1-F02-03 Category card routing & filtered catalog landing', async ({ page }) => {
      await page.goto('/');

      for (const starter of Object.values(STARTER_PRODUCTS)) {
        const card = getCategoryCardLink(page, new RegExp(starter.categoryName, 'i'), starter.categorySlug);
        await card.click();
        await expect(page).toHaveURL(new RegExp(`/kategori/${starter.categorySlug}`));
        await expect(getProductLinkByTitle(page, starter.title)).toBeVisible();
        await page.goto('/');
      }
    });

    test('T1-F02-04 Warm ivory canvas, espresso ink & bronze CTA palette', async ({ page }) => {
      await page.goto('/');
      await expectBrandPaletteAndWcagContrast(page);

      const ctaStyles = await page.evaluate(() => {
        const btn = document.querySelector('main a[href^="/kategori/"], main button');
        if (!btn) return null;
        const s = getComputedStyle(btn);
        return { bg: s.backgroundColor, color: s.color };
      });
      expect(ctaStyles).not.toBeNull();
    });

    test('T1-F02-05 WCAG 2.1 AA contrast check on desktop and mobile', async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto('/');
      await expectBrandPaletteAndWcagContrast(page);

      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto('/');
      await expectBrandPaletteAndWcagContrast(page);

      const navRatio = await page.evaluate(() => {
        const link = document.querySelector('header nav a, header a');
        if (!link) return null;
        return {
          fg: getComputedStyle(link).color,
          bg: getComputedStyle(document.querySelector('header') || document.body).backgroundColor,
        };
      });
      if (navRatio && navRatio.bg !== 'rgba(0, 0, 0, 0)') {
        const ratio = computeContrastRatio(navRatio.fg, navRatio.bg);
        if (ratio !== null) {
          expect(ratio).toBeGreaterThanOrEqual(4.5);
        }
      }
    });
  });

  test.describe('F-03: Product Catalog Grid & Detail View', () => {
    test('T1-F03-01 Catalog grid cards show title, NOK formatting, stock badge & image', async ({
      page,
    }) => {
      await page.goto('/kategori/alle');

      const armyCard = getProductCardByTitle(page, STARTER_PRODUCTS.armySekk.title);
      await expect(armyCard).toBeVisible();
      const cardText = await armyCard.innerText();
      expect(cardText).toMatch(/\d[\d\s\u00a0\u202f]*\s*kr/i);
      expect(cardText).toMatch(/på lager|lager|utsolgt/i);
      await expectHealthyLogoAndImages(page);
    });

    test('T1-F03-02 Category route filtering isolation', async ({ page }) => {
      await page.goto('/kategori/seveno-living');
      await expect(getProductLinkByTitle(page, STARTER_PRODUCTS.armySekk.title)).toBeVisible();
      await expect(getProductLinkByTitle(page, STARTER_PRODUCTS.pergola.title)).toHaveCount(0);

      await page.goto('/kategori/seveno-home');
      await expect(getProductLinkByTitle(page, STARTER_PRODUCTS.skobeholder.title)).toBeVisible();
      await expect(getProductLinkByTitle(page, STARTER_PRODUCTS.armySekk.title)).toHaveCount(0);

      await page.goto('/kategori/seveno-outdoor');
      await expect(getProductLinkByTitle(page, STARTER_PRODUCTS.pergola.title)).toBeVisible();
      await expect(getProductLinkByTitle(page, STARTER_PRODUCTS.skobeholder.title)).toHaveCount(0);
    });

    test('T1-F03-03 Non-broken images across catalog and product detail views', async ({ page }) => {
      await page.goto('/kategori/alle');
      await expectHealthyLogoAndImages(page);

      for (const starter of Object.values(STARTER_PRODUCTS)) {
        await page.goto(`/kategori/${starter.categorySlug}`);
        await getProductLinkByTitle(page, starter.title).click();
        await expect(page).toHaveURL(/\/produkt\//);
        await expectHealthyLogoAndImages(page);
      }
    });

    test('T1-F03-04 Product detail page completeness', async ({ page }) => {
      await page.goto('/kategori/alle');
      await getProductLinkByTitle(page, STARTER_PRODUCTS.armySekk.title).click();
      await expect(page).toHaveURL(/\/produkt\//);

      const main = page.locator('main');
      await expect(main.getByRole('heading', { name: /Army sekk/i }).first()).toBeVisible();
      const text = await main.innerText();
      expect(text).toMatch(/Seveno living/i);
      expect(text).toMatch(/\d[\d\s\u00a0\u202f]*\s*kr/i);
      expect(text).toMatch(/på lager|lager/i);
      expect(text.length).toBeGreaterThan(80);
      await expectHealthyLogoAndImages(page);
    });

    test('T1-F03-05 Add-to-cart action from product detail view', async ({ page }) => {
      await page.goto('/kategori/seveno-outdoor');
      await getProductLinkByTitle(page, STARTER_PRODUCTS.pergola.title).click();
      await expect(page).toHaveURL(/\/produkt\//);

      const addBtn = page.getByRole('button', { name: /legg i handlekurv/i }).first();
      await expect(addBtn).toBeEnabled();
      await addBtn.click();

      await expect(getCartButton(page)).toContainText(/1/);
      const drawer = await openCartDrawer(page);
      await expect(drawer).toContainText(/Pergola/i);
    });

    test('T1-F03-06 Switching from filtered category back to Alle', async ({ page }) => {
      await page.goto('/kategori/seveno-home');
      await navigateStorefront(page, /^alle$|alle produkter/i);
      await expect(page).toHaveURL(/\/kategori\/alle/);

      for (const starter of Object.values(STARTER_PRODUCTS)) {
        await expect(getProductLinkByTitle(page, starter.title)).toBeVisible();
      }
    });
  });

  test.describe('F-04: Seeded Starter Catalog & Assets', () => {
    test('T1-F04-01 Seeded starter product: Army sekk in Seveno living', async ({ page }) => {
      await page.goto('/kategori/seveno-living');
      await getProductLinkByTitle(page, STARTER_PRODUCTS.armySekk.title).click();
      await expect(page.locator('main')).toContainText(/Army sekk/i);
      await expect(page.locator('main')).toContainText(/\d[\d\s\u00a0\u202f]*\s*kr/i);
      await expectHealthyLogoAndImages(page);
    });

    test('T1-F04-02 Seeded starter product: Akryl gjennomsiktig skobeholder in Seveno home', async ({
      page,
    }) => {
      await page.goto('/kategori/seveno-home');
      await getProductLinkByTitle(page, STARTER_PRODUCTS.skobeholder.title).click();
      await expect(page.locator('main')).toContainText(/Akryl gjennomsiktig skobeholder/i);
      await expect(page.locator('main')).toContainText(/\d[\d\s\u00a0\u202f]*\s*kr/i);
      await expectHealthyLogoAndImages(page);
    });

    test('T1-F04-03 Seeded starter product: Pergola in Seveno outdoor', async ({ page }) => {
      await page.goto('/kategori/seveno-outdoor');
      await getProductLinkByTitle(page, STARTER_PRODUCTS.pergola.title).click();
      await expect(page.locator('main')).toContainText(/Pergola/i);
      await expect(page.locator('main')).toContainText(/\d[\d\s\u00a0\u202f]*\s*kr/i);
      await expectHealthyLogoAndImages(page);
    });

    test('T1-F04-04 Combined starter catalog presence on /kategori/alle', async ({ page }) => {
      await page.goto('/kategori/alle');
      for (const starter of Object.values(STARTER_PRODUCTS)) {
        await expect(getProductLinkByTitle(page, starter.title)).toBeVisible();
      }
    });

    test('T1-F04-05 No duplicate seeded starter products across reloads', async ({ page }) => {
      await page.goto('/kategori/alle');
      await page.reload();
      await page.reload();

      for (const starter of Object.values(STARTER_PRODUCTS)) {
        const matches = getAllProductLinks(page).filter({ hasText: starter.title });
        await expect(matches).toHaveCount(1);
      }
    });
  });

  test.describe('F-05: Contact Form & Backend Persistence', () => {
    test('T1-F05-01 Contact form fields & Norwegian labels at /kontakt', async ({ page }) => {
      await page.goto('/kontakt');
      await expect(page.getByRole('heading', { name: /kontakt/i }).first()).toBeVisible();

      const fields = getContactFormFields(page);
      await expect(fields.name).toBeVisible();
      await expect(fields.email).toBeVisible();
      await expect(fields.subject).toBeVisible();
      await expect(fields.message).toBeVisible();
      await expect(fields.submit).toBeEnabled();
    });

    test('T1-F05-02 Valid contact form submission & Norwegian confirmation', async ({ page }) => {
      const monitor = attachRuntimeMonitor(page);
      await page.goto('/kontakt');

      const fields = getContactFormFields(page);
      await fields.name.fill('Ola Nordmann');
      await fields.email.fill('ola@example.no');
      await fields.subject.fill(`Spørsmål om pergola ${makeRunId()}`);
      await fields.message.fill('Hva er leveringstiden til Oslo?');
      await fields.submit.click();

      await expect(
        page.getByText(/takk for din henvendelse|meldingen er sendt|mottatt/i).first(),
      ).toBeVisible({ timeout: 15_000 });
      monitor.assertClean();
    });

    test('T1-F05-03 Contact form reset / clean post-submission state', async ({ page }) => {
      await page.goto('/kontakt');
      const fields = getContactFormFields(page);
      const uniqueSubject = `Reset-sjekk ${makeRunId()}`;

      await fields.name.fill('Kari Nordmann');
      await fields.email.fill('kari@example.no');
      await fields.subject.fill(uniqueSubject);
      await fields.message.fill('Kan jeg bestille ekstra deler?');
      await fields.submit.click();

      await expect(
        page.getByText(/takk for din henvendelse|meldingen er sendt|mottatt/i).first(),
      ).toBeVisible({ timeout: 15_000 });

      const subjectVisible = await fields.subject.isVisible().catch(() => false);
      if (subjectVisible) {
        await expect(fields.subject).toHaveValue('');
      }
    });

    test('T1-F05-04 Contact message persisted to Admin overview & hidden from public /kontakt', async ({
      page,
    }, testInfo) => {
      const adminCreds = await requireAdminCredsOrSkip(testInfo);
      const uniqueSubject = `Henvendelse ${makeRunId()}`;

      await page.goto('/kontakt');
      const fields = getContactFormFields(page);
      await fields.name.fill('Ingrid Hansen');
      await fields.email.fill('ingrid@example.no');
      await fields.subject.fill(uniqueSubject);
      await fields.message.fill('Spørsmål om Army sekk.');
      await fields.submit.click();
      await expect(
        page.getByText(/takk for din henvendelse|meldingen er sendt|mottatt/i).first(),
      ).toBeVisible({ timeout: 15_000 });

      // Reload /kontakt and verify customer messages are NOT exposed publicly
      await page.reload();
      await expect(page.getByText(uniqueSubject)).toHaveCount(0);

      await signInAdmin(page, adminCreds);
      await openAdminTab(page, /henvendelser/i);
      await expect(page.getByText(uniqueSubject).first()).toBeVisible({ timeout: 15_000 });
    });

    test('T1-F05-05 Contact form usability on mobile 390x844', async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto('/kontakt');
      await expectNoHorizontalOverflow(page);

      const fields = getContactFormFields(page);
      await fields.name.fill('Mobil Kunde');
      await fields.email.fill('mobil@example.no');
      await fields.subject.fill(`Mobilhenvendelse ${makeRunId()}`);
      await fields.message.fill('Tester mobilvisning av kontaktskjema.');
      await fields.submit.click();

      await expect(
        page.getByText(/takk for din henvendelse|meldingen er sendt|mottatt/i).first(),
      ).toBeVisible({ timeout: 15_000 });
      await expectNoHorizontalOverflow(page);
    });
  });

  test.describe('F-06: Admin Product Management Interface', () => {
    test('T1-F06-01 Auth gate on /admin for unauthenticated visitors', async ({ page }) => {
      await page.goto('/admin');

      await expect(page.getByRole('button', { name: /logg inn/i }).first()).toBeVisible();
      await expect(page.getByRole('button', { name: /opprett produkt|slett/i })).toHaveCount(0);
    });

    test('T1-F06-02 Authenticated admin accesses CRUD & overview', async ({ page }, testInfo) => {
      const adminCreds = await requireAdminCredsOrSkip(testInfo);
      await signInAdmin(page, adminCreds);

      await expect(page.locator('main').getByText(/Laster produkter/i)).toBeHidden({
        timeout: 15_000,
      });
      await expect(
        getVisibleAdminProductRows(page, STARTER_PRODUCTS.armySekk.title).first(),
      ).toBeVisible({ timeout: 15_000 });
      await expect(getAdminProductFormFields(page).title).toBeVisible();
    });

    test('T1-F06-03 Admin creates new product visible immediately in store', async ({
      page,
    }, testInfo) => {
      const adminCreds = await requireAdminCredsOrSkip(testInfo);
      const product = makeAdminTestProduct(makeRunId(), {
        categorySlug: 'seveno-living',
        categoryName: 'Seveno living',
        priceNok: 890,
        stock: 12,
      });

      await signInAdmin(page, adminCreds);
      try {
        await createProductViaAdmin(page, product);

        await page.goto('/kategori/seveno-living');
        const card = getProductCardByTitle(page, product.title);
        await expect(card).toBeVisible();
        await expect(card).toContainText(/890\s*kr/i);

        await page.goto('/kategori/alle');
        await expect(getProductLinkByTitle(page, product.title)).toBeVisible();
      } finally {
        await deleteProductViaAdmin(page, product.title).catch(() => {});
      }
    });

    test('T1-F06-04 Admin updates existing product price and stock', async ({ page }, testInfo) => {
      const adminCreds = await requireAdminCredsOrSkip(testInfo);
      const product = makeAdminTestProduct(makeRunId(), { priceNok: 890, stock: 12 });

      await signInAdmin(page, adminCreds);
      try {
        await createProductViaAdmin(page, product);

        const row = getVisibleAdminProductRows(page, product.title)
          .filter({ has: page.getByRole('button', { name: /rediger/i }) })
          .first();
        await row.getByRole('button', { name: /rediger/i }).first().click();

        const form = getAdminProductFormFields(page);
        await form.price.fill('990');
        await form.stock.fill('5');
        await form.submit.click();

        const updatedRow = page
          .locator('main tr, main article')
          .filter({ hasText: product.title })
          .filter({ hasText: /990/ })
          .locator('visible=true')
          .first();
        await expect(updatedRow).toBeVisible({ timeout: 15_000 });

        await page.reload();
        await page.goto('/kategori/seveno-living');
        const card = getProductCardByTitle(page, product.title);
        await expect(card).toContainText(/990\s*kr/i);
      } finally {
        await deleteProductViaAdmin(page, product.title).catch(() => {});
      }
    });

    test('T1-F06-05 Admin product creation with fallback illustration (no custom URL)', async ({
      page,
    }, testInfo) => {
      const adminCreds = await requireAdminCredsOrSkip(testInfo);
      const product = makeAdminTestProduct(makeRunId(), { imageUrl: '' });

      await signInAdmin(page, adminCreds);
      try {
        await createProductViaAdmin(page, product);

        await page.goto(`/kategori/${product.categorySlug}`);
        const card = getProductCardByTitle(page, product.title);
        await expect(card).toBeVisible();
        await expectHealthyLogoAndImages(page);
      } finally {
        await deleteProductViaAdmin(page, product.title).catch(() => {});
      }
    });

    test('T1-F06-06 Admin deletes product and removes it from storefront', async ({
      page,
    }, testInfo) => {
      const adminCreds = await requireAdminCredsOrSkip(testInfo);
      const product = makeAdminTestProduct(makeRunId());

      await signInAdmin(page, adminCreds);
      await createProductViaAdmin(page, product);
      await deleteProductViaAdmin(page, product.title);

      await page.goto(`/kategori/${product.categorySlug}`);
      await page.reload();
      await expect(getProductLinkByTitle(page, product.title)).toHaveCount(0);

      await page.goto('/kategori/alle');
      await expect(getProductLinkByTitle(page, product.title)).toHaveCount(0);
    });
  });

  test.describe('F-07: Persistent Shopping Cart', () => {
    test('T1-F07-01 Add product to cart & update header badge', async ({ page }) => {
      await addProductToCartFromCatalog(page, STARTER_PRODUCTS.armySekk);

      await expect(getCartButton(page)).toContainText(/1/);
      const drawer = await openCartDrawer(page);
      await expect(drawer).toContainText(STARTER_PRODUCTS.armySekk.title);
      await expect(drawer).toContainText(/\d[\d\s\u00a0\u202f]*\s*kr/i);
    });

    test('T1-F07-02 Increment & decrement quantity updates totals & 25% MVA', async ({ page }) => {
      await page.goto('/kategori/seveno-living');
      const card = getProductCardByTitle(page, STARTER_PRODUCTS.armySekk.title);
      const unitPrice = extractNokAmount(await card.innerText());

      await addProductToCartFromCatalog(page, STARTER_PRODUCTS.armySekk);
      const drawer = await openCartDrawer(page);
      const row = getCartItemRow(drawer, STARTER_PRODUCTS.armySekk.title);

      const incBtn = row.getByRole('button', { name: /^\+$|øk/i }).first();
      const decBtn = row.getByRole('button', { name: /^-|−$|reduser/i }).first();

      await incBtn.click();
      await incBtn.click();
      await expect(getCartButton(page)).toContainText(/3/);

      await decBtn.click();
      await expect(getCartButton(page)).toContainText(/2/);

      const drawerText = await drawer.innerText();
      expect(drawerText).toMatch(/mva|merverdiavgift/i);
      expect(drawerText).toMatch(/frakt/i);

      const totals = extractAndAssertOrderMath(drawerText);
      expect(totals.subtotalNok).toBe(unitPrice * 2);
    });

    test('T1-F07-03 Remove single item from cart while keeping other item', async ({ page }) => {
      await addProductToCartFromCatalog(page, STARTER_PRODUCTS.armySekk);
      await addProductToCartFromCatalog(page, STARTER_PRODUCTS.pergola);

      const drawer = await openCartDrawer(page);
      const armyRow = getCartItemRow(drawer, STARTER_PRODUCTS.armySekk.title);
      await armyRow.getByRole('button', { name: /fjern/i }).first().click();

      await expect(drawer).not.toContainText(STARTER_PRODUCTS.armySekk.title);
      await expect(drawer).toContainText(STARTER_PRODUCTS.pergola.title);
      await expect(getCartButton(page)).toContainText(/1/);
    });

    test('T1-F07-04 Clear cart & Norwegian empty-cart state', async ({ page }) => {
      await addProductToCartFromCatalog(page, STARTER_PRODUCTS.armySekk);
      const drawer = await openCartDrawer(page);

      const clearBtn = drawer.getByRole('button', { name: /tøm/i }).first();
      if ((await clearBtn.count()) > 0 && (await clearBtn.isVisible())) {
        await clearBtn.click();
      } else {
        await getCartItemRow(drawer, STARTER_PRODUCTS.armySekk.title)
          .getByRole('button', { name: /fjern/i })
          .first()
          .click();
      }

      await expect(drawer).toContainText(/tom|ingen varer/i);
    });

    test('T1-F07-05 Cart persistence across reload & route changes', async ({ page }) => {
      await addProductToCartFromCatalog(page, STARTER_PRODUCTS.armySekk);
      const drawer = await openCartDrawer(page);
      await getCartItemRow(drawer, STARTER_PRODUCTS.armySekk.title)
        .getByRole('button', { name: /^\+$|øk/i })
        .first()
        .click();

      await page.goto('/kontakt');
      await page.reload();

      await expect(getCartButton(page)).toContainText(/2/);
      const reopened = await openCartDrawer(page);
      await expect(reopened).toContainText(STARTER_PRODUCTS.armySekk.title);
    });

    test('T1-F07-06 Navigate from cart drawer to /utsjekk', async ({ page }) => {
      await addProductToCartFromCatalog(page, STARTER_PRODUCTS.skobeholder);
      const drawer = await openCartDrawer(page);

      await drawer.getByRole('link', { name: /utsjekk|kasse/i }).or(
        drawer.getByRole('button', { name: /utsjekk|kasse/i }),
      ).first().click();

      await expect(page).toHaveURL(/\/utsjekk/);
      await expect(page.locator('main')).toContainText(STARTER_PRODUCTS.skobeholder.title);
    });
  });

  test.describe('F-08: Checkout & Test Order Persistence', () => {
    test.beforeAll(async ({ browser }) => {
      await ensureStarterCatalogReady(browser);
    });

    test('T1-F08-01 /utsjekk renders order summary & Norwegian customer fields', async ({ page }) => {
      await addProductToCartFromCatalog(page, STARTER_PRODUCTS.armySekk);
      await page.goto('/utsjekk');

      const fields = getCheckoutFormFields(page);
      await expect(fields.name).toBeVisible();
      await expect(fields.email).toBeVisible();
      await expect(fields.phone).toBeVisible();
      await expect(fields.street).toBeVisible();
      await expect(fields.postalCode).toBeVisible();
      await expect(fields.city).toBeVisible();

      await expect(page.locator('main')).toContainText(/Army sekk/i);
      const summaryText = await page.locator('main').innerText();
      expect(summaryText).toMatch(/Army sekk/i);
      expect(summaryText).toMatch(/mva|25\s*%/i);
      expect(summaryText).toMatch(/totalt|sum/i);
    });

    test('T1-F08-02 Valid Norwegian 4-digit Postnummer & customer input accepted', async ({
      page,
    }) => {
      await addProductToCartFromCatalog(page, STARTER_PRODUCTS.armySekk);
      const { orderNumber } = await submitOrderAndReadConfirmation(page, 'test_order');
      expect(orderNumber).toMatch(/^SEV-\d{4}-[A-Z0-9]{4}$/);
    });

    test('T1-F08-03 Test order submission & Ordrebekreftelse (SEV-YYYY-XXXX)', async ({
      page,
    }) => {
      const monitor = attachRuntimeMonitor(page);
      await addProductToCartFromCatalog(page, STARTER_PRODUCTS.pergola);
      const { orderNumber } = await submitOrderAndReadConfirmation(page, 'test_order');

      expect(orderNumber).toMatch(/^SEV-\d{4}-[A-Z0-9]{4}$/);
      monitor.assertClean();
    });

    test('T1-F08-04 Ordrebekreftelse displays line items, address & NOK totals', async ({
      page,
    }) => {
      await addProductToCartFromCatalog(page, STARTER_PRODUCTS.skobeholder);
      const { confirmationText } = await submitOrderAndReadConfirmation(page, 'test_order');

      expect(confirmationText).toMatch(/Akryl gjennomsiktig skobeholder/i);
      expect(confirmationText).toMatch(/Ola Nordmann/i);
      expect(confirmationText).toMatch(/0150\s+Oslo/i);
      expect(confirmationText).toMatch(/\d[\d\s\u00a0\u202f]*\s*kr/i);
      expect(confirmationText).not.toMatch(/NaN|undefined/i);
    });

    test('T1-F08-05 Cart clears automatically after order completion', async ({ page }) => {
      await addProductToCartFromCatalog(page, STARTER_PRODUCTS.armySekk);
      await submitOrderAndReadConfirmation(page, 'test_order');

      await page.reload();
      const drawer = await openCartDrawer(page);
      await expect(drawer).toContainText(/tom|ingen varer/i);
    });

    test('T1-F08-06 Completed order persisted in backend & visible in /admin', async ({
      page,
    }, testInfo) => {
      const adminCreds = await requireAdminCredsOrSkip(testInfo);
      await addProductToCartFromCatalog(page, STARTER_PRODUCTS.armySekk);
      const { orderNumber } = await submitOrderAndReadConfirmation(page, 'test_order');

      await signInAdmin(page, adminCreds);
      await openAdminTab(page, /bestillinger/i);
      await expect(page.getByText(orderNumber).first()).toBeVisible({ timeout: 15_000 });
    });
  });

  test.describe('F-09: Payment Provider Adapter Layer (Klarna & Vipps)', () => {
    test.beforeAll(async ({ browser }) => {
      await ensureStarterCatalogReady(browser);
    });

    test('T1-F09-01 All 3 payment providers visible on /utsjekk', async ({ page }) => {
      await addProductToCartFromCatalog(page, STARTER_PRODUCTS.armySekk);
      await page.goto('/utsjekk');

      await expect(getPaymentOption(page, 'test_order')).toBeVisible();
      await expect(getPaymentOption(page, 'klarna')).toBeVisible();
      await expect(getPaymentOption(page, 'vipps')).toBeVisible();
    });

    test('T1-F09-02 Selecting Testbestilling completes simulated order', async ({ page }) => {
      await addProductToCartFromCatalog(page, STARTER_PRODUCTS.armySekk);
      const { orderNumber, confirmationText } = await submitOrderAndReadConfirmation(
        page,
        'test_order',
      );
      expect(orderNumber).toMatch(/^SEV-\d{4}-[A-Z0-9]{4}$/);
      expect(confirmationText).toMatch(/test/i);
    });

    test('T1-F09-03 Selecting Klarna displays Klarna metadata & completes sandbox checkout', async ({
      page,
    }) => {
      await addProductToCartFromCatalog(page, STARTER_PRODUCTS.skobeholder);
      const { orderNumber, confirmationText } = await submitOrderAndReadConfirmation(page, 'klarna');
      expect(orderNumber).toMatch(/^SEV-\d{4}-[A-Z0-9]{4}$/);
      expect(confirmationText).toMatch(/Klarna/i);
    });

    test('T1-F09-04 Selecting Vipps displays Vipps metadata & completes sandbox checkout', async ({
      page,
    }) => {
      await addProductToCartFromCatalog(page, STARTER_PRODUCTS.pergola);
      const { orderNumber, confirmationText } = await submitOrderAndReadConfirmation(page, 'vipps');
      expect(orderNumber).toMatch(/^SEV-\d{4}-[A-Z0-9]{4}$/);
      expect(confirmationText).toMatch(/Vipps/i);
    });

    test('T1-F09-05 Switching payment providers preserves customer checkout inputs', async ({
      page,
    }) => {
      await addProductToCartFromCatalog(page, STARTER_PRODUCTS.armySekk);
      await page.goto('/utsjekk');
      await fillCheckoutCustomer(page);

      await getPaymentOption(page, 'klarna').click();
      await getPaymentOption(page, 'vipps').click();
      await getPaymentOption(page, 'test_order').click();

      const fields = getCheckoutFormFields(page);
      await expect(fields.name).toHaveValue('Ola Nordmann');
      await expect(fields.postalCode).toHaveValue('0150');
      await expect(fields.city).toHaveValue('Oslo');
    });
  });

  test.describe('F-10: Integrated Norwegian Gemini / Firebase AI Bot', () => {
    test.beforeAll(async ({ browser }) => {
      await ensureStarterCatalogReady(browser);
    });

    test('T1-F10-01 Cross-site floating AI assistant launcher visible across routes', async ({
      page,
    }) => {
      for (const route of ['/', '/kategori/seveno-living', '/kontakt', '/utsjekk']) {
        await page.goto(route);
        await expect(getAiLauncher(page)).toBeVisible();
      }
    });

    test('T1-F10-02 Open and close Norwegian AI chat panel', async ({ page }) => {
      await page.goto('/');
      await getAiLauncher(page).click();

      const panel = getAiPanel(page);
      await expect(panel).toBeVisible();
      await expect(getAiInput(panel)).toBeVisible();
      await expect(getAiSendButton(panel)).toBeVisible();

      const closeBtn = panel.getByRole('button', { name: /lukk|minimer|avslutt|×|x/i }).first();
      await closeBtn.click();
      await expect(panel).toBeHidden();
      await expect(page).toHaveURL(/\/$/);
    });

    test('T1-F10-03 Norwegian product Q&A using catalog context', async ({ page }) => {
      test.setTimeout(75_000);
      await page.goto('/');
      const { replyDelta } = await askAiAssistant(
        page,
        'Hva koster Pergola og hvilken kategori tilhører den?',
      );
      expect(replyDelta).toMatch(/Pergola/i);
      expect(replyDelta).toMatch(/Seveno outdoor|outdoor|kr/i);
    });

    test('T1-F10-04 Chat transcript preserved across SPA navigation', async ({ page }) => {
      test.setTimeout(75_000);
      await page.goto('/');
      const sentinelPrompt = `Hvilken sekk har dere? (${makeRunId()})`;
      await askAiAssistant(page, sentinelPrompt);
      await closeAiPanelIfOpen(page);

      await navigateStorefront(page, /seveno home/i);
      await expect(page).toHaveURL(/\/kategori\/seveno-home/);

      const panel = getAiPanel(page);
      if (!(await panel.isVisible().catch(() => false))) {
        await getAiLauncher(page).click();
      }
      await expect(panel).toContainText(sentinelPrompt);
    });

    test('T1-F10-05 Live catalog sync after Admin product creation', async ({
      page,
    }, testInfo) => {
      test.setTimeout(75_000);
      const adminCreds = await requireAdminCredsOrSkip(testInfo);
      const product = makeAdminTestProduct(makeRunId(), {
        title: `Fjellryggsekk Test ${makeRunId()}`,
        priceNok: 1490,
        categorySlug: 'seveno-living',
        categoryName: 'Seveno living',
      });

      await signInAdmin(page, adminCreds);
      try {
        await createProductViaAdmin(page, product);
        await page.goto('/');

        const { replyDelta } = await askAiAssistant(
          page,
          `Har dere ${product.title}, og hva koster den?`,
        );
        expect(replyDelta).toContain(product.title);
        expect(replyDelta).toMatch(/1[\s\u00a0\u202f]*490/);
      } finally {
        await deleteProductViaAdmin(page, product.title).catch(() => {});
      }
    });
  });
});
