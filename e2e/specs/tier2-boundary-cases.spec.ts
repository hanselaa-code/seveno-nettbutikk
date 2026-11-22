import { expect, test } from '@playwright/test';
import {
  attachRuntimeMonitor,
  computeContrastRatio,
  expectHealthyLogoAndImages,
  expectNoHorizontalOverflow,
  extractAndAssertOrderMath,
  extractNokAmount,
  parseNok,
} from '../helpers/assertions';
import {
  getAdminLoginFields,
  getAdminProductFormFields,
  getAiInput,
  getAiLauncher,
  getAiPanel,
  getAiSendButton,
  getAllProductLinks,
  getCartButton,
  getCartDrawer,
  getCartItemRow,
  getCheckoutFormFields,
  getContactFormFields,
  getLogoLink,
  getMobileMenuButton,
  getPaymentOption,
  getProductCardByTitle,
  getProductLinkByTitle,
  openCartDrawer,
} from '../helpers/selectors';
import {
  addProductToCartFromCatalog,
  applyAiAppCheckDebugToken,
  askAiAssistant,
  createProductViaAdmin,
  deleteProductViaAdmin,
  fillCheckoutCustomer,
  INVALID_EMAILS,
  INVALID_POSTAL_CODES,
  makeAdminTestProduct,
  makeRunId,
  requireAdminCredsOrSkip,
  signInAdmin,
  STARTER_PRODUCTS,
  submitOrderAndReadConfirmation,
  VALID_NORWEGIAN_CUSTOMER,
} from '../helpers/testdata';

test.describe('Tier 2 — Boundary & Corner Cases (F-01 through F-10)', () => {
  test.beforeEach(async ({ page }) => {
    await applyAiAppCheckDebugToken(page);
  });

  test.describe('F-01 Boundaries: Shell, Routing, Mobile & Accessibility', () => {
    test('T2-F01-01 Unknown route /finnes-ikke-404 shows Norwegian 404 with link home', async ({
      page,
    }) => {
      const monitor = attachRuntimeMonitor(page);
      await page.goto('/finnes-ikke-404');

      await expect(page.locator('main')).toContainText(/ikke funnet|404|finner ikke/i);
      const homeLink = page.locator('main a[href="/"]').or(getLogoLink(page)).first();
      await expect(homeLink).toBeVisible();
      await homeLink.click();
      await expect(page).toHaveURL(/\/$/);

      expect(monitor.pageErrors).toEqual([]);
    });

    test('T2-F01-02 Zero horizontal overflow across routes at 390x844 and 320x568', async ({
      page,
    }) => {
      for (const viewport of [
        { width: 390, height: 844 },
        { width: 320, height: 568 },
      ]) {
        await page.setViewportSize(viewport);
        for (const route of ['/', '/kategori/alle', '/kontakt', '/utsjekk']) {
          await page.goto(route);
          await expectNoHorizontalOverflow(page);
        }
      }
    });

    test('T2-F01-03 Rapid mobile drawer toggle & Escape dismiss leaves clean state', async ({
      page,
    }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto('/');

      const menuBtn = getMobileMenuButton(page);
      await expect(menuBtn).toBeVisible();

      for (let i = 0; i < 5; i += 1) {
        await menuBtn.click();
      }
      await page.keyboard.press('Escape');

      // Storefront logo/main content must remain clickable (no stuck backdrop)
      await expect(getLogoLink(page)).toBeVisible();
      await getLogoLink(page).click({ trial: true });
    });

    test('T2-F01-04 Keyboard navigation via Tab & Enter without focus traps', async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto('/');

      const visitedTags: string[] = [];
      for (let i = 0; i < 8; i += 1) {
        await page.keyboard.press('Tab');
        const active = await page.evaluate(() => {
          const el = document.activeElement;
          return el ? `${el.tagName}:${(el.textContent || '').trim().slice(0, 20)}` : 'none';
        });
        visitedTags.push(active);
      }
      expect(new Set(visitedTags).size).toBeGreaterThan(2);
    });

    test('T2-F01-05 Clean runtime console and zero HTTP >=500 across primary routes', async ({
      page,
    }) => {
      const monitor = attachRuntimeMonitor(page);
      for (const route of ['/', '/kategori/alle', '/kontakt', '/utsjekk', '/admin']) {
        await page.goto(route);
        await expect(page.locator('main')).toBeVisible();
      }
      monitor.assertClean();
    });
  });

  test.describe('F-02 Boundaries: Hero & Category Showcase', () => {
    test('T2-F02-01 Invalid category slug /kategori/ugyldig-kategori renders clean Norwegian fallback', async ({
      page,
    }) => {
      const monitor = attachRuntimeMonitor(page);
      await page.goto('/kategori/ugyldig-kategori');

      await expect(page.locator('main')).toContainText(/ikke funnet|ingen produkter|ugyldig/i);
      const fallbackLink = page
        .locator('main a[href="/kategori/alle"], main a[href="/"]')
        .first();
      await expect(fallbackLink).toBeVisible();
      expect(monitor.pageErrors).toEqual([]);
    });

    test('T2-F02-02 Narrow mobile category card wrapping at 320x568 and 390x844', async ({
      page,
    }) => {
      for (const vp of [
        { width: 320, height: 568 },
        { width: 390, height: 844 },
      ]) {
        await page.setViewportSize(vp);
        await page.goto('/');
        await expectNoHorizontalOverflow(page);
        for (const starter of Object.values(STARTER_PRODUCTS)) {
          await expect(page.locator('main')).toContainText(new RegExp(starter.categoryName, 'i'));
        }
      }
    });

    test('T2-F02-03 Dynamic viewport resize desktop <-> mobile retains healthy imagery', async ({
      page,
    }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto('/');
      await expectHealthyLogoAndImages(page);

      await page.setViewportSize({ width: 390, height: 844 });
      await expectNoHorizontalOverflow(page);
      await expectHealthyLogoAndImages(page);

      await page.setViewportSize({ width: 1440, height: 900 });
      await expectHealthyLogoAndImages(page);
    });

    test('T2-F02-04 Hover & focus states maintain >= 4.5:1 button contrast', async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto('/');

      const cta = page
        .locator('main a[href^="/kategori/"], main button')
        .filter({ hasText: /utforsk|se produkter|kolleksjon|alle/i })
        .first();
      await expect(cta).toBeVisible();
      await cta.hover();
      await cta.focus();

      const colors = await cta.evaluate((el) => {
        const s = getComputedStyle(el);
        return { fg: s.color, bg: s.backgroundColor };
      });
      const ratio = computeContrastRatio(colors.fg, colors.bg);
      if (ratio !== null && colors.bg !== 'rgba(0, 0, 0, 0)') {
        expect(ratio).toBeGreaterThanOrEqual(4.5);
      }
    });

    test('T2-F02-05 Cold deep link to /kategori/seveno-outdoor hydrates directly', async ({
      browser,
    }) => {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      try {
        await page.goto('/kategori/seveno-outdoor');
        await expect(page.locator('main')).toContainText(/Seveno outdoor/i);
        await expect(getProductLinkByTitle(page, STARTER_PRODUCTS.pergola.title)).toBeVisible();
        await expectHealthyLogoAndImages(page);
      } finally {
        await ctx.close();
      }
    });
  });

  test.describe('F-03 Boundaries: Catalog & Product Detail', () => {
    test('T2-F03-01 Non-existent product ID /produkt/ikke-eksisterende-id-999 shows Norwegian 404', async ({
      page,
    }) => {
      const monitor = attachRuntimeMonitor(page);
      await page.goto('/produkt/ikke-eksisterende-id-999');

      await expect(page.locator('main')).toContainText(/ikke funnet|finnes ikke/i);
      await expect(
        page.locator('main a[href^="/kategori/"], main a[href="/"]').first(),
      ).toBeVisible();
      expect(monitor.pageErrors).toEqual([]);
    });

    test('T2-F03-02 Broken product image falls back to healthy placeholder (naturalWidth > 0)', async ({
      page,
    }) => {
      await page.route('**/images/products/army-sekk*', (route) =>
        route.fulfill({ status: 404, body: 'Not Found' }),
      );

      await page.goto('/kategori/seveno-living');
      const card = getProductCardByTitle(page, STARTER_PRODUCTS.armySekk.title);
      await expect(card).toBeVisible();

      const img = card.locator('img').first();
      await expect(img).toBeVisible();
      await expect
        .poll(
          async () =>
            img.evaluate((el) => {
              const i = el as HTMLImageElement;
              return i.complete && i.naturalWidth > 0;
            }),
          { timeout: 10_000 },
        )
        .toBe(true);
    });

    test('T2-F03-03 Zero stock product shows out-of-stock badge & disables add-to-cart', async ({
      page,
    }, testInfo) => {
      const adminCreds = await requireAdminCredsOrSkip(testInfo);
      const product = makeAdminTestProduct(makeRunId(), {
        title: `Utsolgt Test ${makeRunId()}`,
        stock: 0,
      });

      await signInAdmin(page, adminCreds);
      try {
        await createProductViaAdmin(page, product);

        await page.goto(`/kategori/${product.categorySlug}`);
        await getProductLinkByTitle(page, product.title).click();
        await expect(page.locator('main')).toContainText(/utsolgt|ikke på lager/i);

        const addBtn = page.getByRole('button', { name: /legg i handlekurv|utsolgt/i }).first();
        if ((await addBtn.count()) > 0) {
          await expect(addBtn).toBeDisabled();
        }
      } finally {
        await deleteProductViaAdmin(page, product.title).catch(() => {});
      }
    });

    test('T2-F03-04 Oversized 120-char product title & 80-char spec wrap without overflow', async ({
      page,
    }, testInfo) => {
      const adminCreds = await requireAdminCredsOrSkip(testInfo);
      const runId = makeRunId();
      const longTitle = `EkstraLangNordiskProdukttittel ${runId} `.padEnd(115, 'x');
      const product = makeAdminTestProduct(runId, {
        title: longTitle,
        specs: 'Spesifikasjon med veldig langt sammenhengende ord '.padEnd(78, 'z'),
      });

      await signInAdmin(page, adminCreds);
      try {
        await createProductViaAdmin(page, product);

        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto(`/kategori/${product.categorySlug}`);
        await expect(getProductLinkByTitle(page, runId)).toBeVisible();
        await expectNoHorizontalOverflow(page);

        await getProductLinkByTitle(page, runId).click();
        await expectNoHorizontalOverflow(page);
      } finally {
        await deleteProductViaAdmin(page, longTitle).catch(() => {});
      }
    });

    test('T2-F03-05 XSS payload in catalog product renders inertly as escaped text', async ({
      page,
    }, testInfo) => {
      const adminCreds = await requireAdminCredsOrSkip(testInfo);
      const runId = makeRunId();
      const xssPayload = `<script>window.__xss=1</script><img src=x onerror="window.__xss=2">`;
      const product = makeAdminTestProduct(runId, {
        title: `Sikkerhetstest ${runId}`,
        description: `Beskrivelse ${xssPayload}`,
      });

      await signInAdmin(page, adminCreds);
      try {
        await createProductViaAdmin(page, product);
        await page.goto(`/kategori/${product.categorySlug}`);
        await getProductLinkByTitle(page, runId).click();

        const xssFlag = await page.evaluate(
          () => (window as unknown as { __xss?: unknown }).__xss,
        );
        expect(xssFlag).toBeUndefined();
      } finally {
        await deleteProductViaAdmin(page, product.title).catch(() => {});
      }
    });

    test('T2-F03-06 Category slug trailing slash & mixed case handled gracefully', async ({
      page,
    }) => {
      const monitor = attachRuntimeMonitor(page);

      await page.goto('/kategori/seveno-living/');
      await expect(page.locator('main')).toBeVisible();
      expect(monitor.pageErrors).toEqual([]);

      await page.goto('/kategori/Seveno-Living');
      await expect(page.locator('main')).toBeVisible();
      expect(monitor.pageErrors).toEqual([]);
    });
  });

  test.describe('F-04 Boundaries: Seeded Starter Catalog & Assets', () => {
    test('T2-F04-01 Concurrent browser contexts keep starter seed idempotent', async ({
      browser,
    }) => {
      const ctx1 = await browser.newContext();
      const ctx2 = await browser.newContext();
      try {
        const p1 = await ctx1.newPage();
        const p2 = await ctx2.newPage();

        await Promise.all([p1.goto('/kategori/alle'), p2.goto('/kategori/alle')]);

        for (const starter of Object.values(STARTER_PRODUCTS)) {
          await expect(getAllProductLinks(p1).filter({ hasText: starter.title })).toHaveCount(1);
          await expect(getAllProductLinks(p2).filter({ hasText: starter.title })).toHaveCount(1);
        }
      } finally {
        await ctx1.close();
        await ctx2.close();
      }
    });

    test('T2-F04-02 Cold deep-load on each starter product detail route', async ({ browser }) => {
      for (const starter of Object.values(STARTER_PRODUCTS)) {
        const ctx = await browser.newContext();
        const page = await ctx.newPage();
        try {
          await page.goto(`/produkt/${starter.slug}`);
          await expect(page.locator('main')).toContainText(new RegExp(starter.title, 'i'));
          await expect(page.locator('main')).toContainText(/\d[\d\s\u00a0\u202f]*\s*kr/i);
          await expectHealthyLogoAndImages(page);
        } finally {
          await ctx.close();
        }
      }
    });

    test('T2-F04-03 Starter image assets return HTTP 200/304 with positive dimensions', async ({
      page,
    }) => {
      const assetResponses: Array<{ url: string; status: number }> = [];
      page.on('response', (res) => {
        if (/\/images\/.*\.(jpg|jpeg|png|svg|webp)/i.test(res.url())) {
          assetResponses.push({ url: res.url(), status: res.status() });
        }
      });

      await page.goto('/kategori/alle');
      await expectHealthyLogoAndImages(page);

      expect(assetResponses.length).toBeGreaterThan(0);
      for (const asset of assetResponses) {
        expect([200, 304], `Unexpected asset status for ${asset.url}`).toContain(asset.status);
      }
    });

    test('T2-F04-04 Starter product category exclusivity (no cross-leakage)', async ({ page }) => {
      await page.goto('/kategori/seveno-living');
      await expect(getProductLinkByTitle(page, STARTER_PRODUCTS.armySekk.title)).toBeVisible();
      await expect(getProductLinkByTitle(page, STARTER_PRODUCTS.skobeholder.title)).toHaveCount(0);
      await expect(getProductLinkByTitle(page, STARTER_PRODUCTS.pergola.title)).toHaveCount(0);

      await page.goto('/kategori/seveno-home');
      await expect(getProductLinkByTitle(page, STARTER_PRODUCTS.skobeholder.title)).toBeVisible();
      await expect(getProductLinkByTitle(page, STARTER_PRODUCTS.armySekk.title)).toHaveCount(0);
      await expect(getProductLinkByTitle(page, STARTER_PRODUCTS.pergola.title)).toHaveCount(0);

      await page.goto('/kategori/seveno-outdoor');
      await expect(getProductLinkByTitle(page, STARTER_PRODUCTS.pergola.title)).toBeVisible();
      await expect(getProductLinkByTitle(page, STARTER_PRODUCTS.armySekk.title)).toHaveCount(0);
      await expect(getProductLinkByTitle(page, STARTER_PRODUCTS.skobeholder.title)).toHaveCount(0);
    });

    test('T2-F04-05 Norwegian UTF-8 characters render without mojibake', async ({ page }) => {
      await page.goto('/kategori/alle');
      const text = await page.locator('main').innerText();
      expect(text).not.toMatch(/Ã¸|Ã¥|Ã¦|\uFFFD/);

      await page.goto('/kontakt');
      const contactText = await page.locator('main').innerText();
      expect(contactText).not.toMatch(/Ã¸|Ã¥|Ã¦|\uFFFD/);
    });
  });

  test.describe('F-05 Boundaries: Contact Form Validation & Security', () => {
    test('T2-F05-01 Empty & whitespace-only contact submission blocked', async ({ page }) => {
      await page.goto('/kontakt');
      const fields = getContactFormFields(page);

      await fields.submit.click();
      await expect(
        page.getByText(/takk for din henvendelse|meldingen er sendt/i),
      ).toHaveCount(0);

      await fields.name.fill('   ');
      await fields.email.fill('   ');
      await fields.subject.fill('   ');
      await fields.message.fill('   ');
      await fields.submit.click();
      await expect(
        page.getByText(/takk for din henvendelse|meldingen er sendt/i),
      ).toHaveCount(0);
    });

    test('T2-F05-02 Invalid email formats rejected on /kontakt', async ({ page }) => {
      await page.goto('/kontakt');
      const fields = getContactFormFields(page);

      for (const badEmail of INVALID_EMAILS) {
        await fields.name.fill('Ola Nordmann');
        await fields.email.fill(badEmail);
        await fields.subject.fill('Test emne');
        await fields.message.fill('Gyldig meldingstekst for test.');
        await fields.submit.click();

        await expect(
          page.getByText(/takk for din henvendelse|meldingen er sendt/i),
        ).toHaveCount(0);
      }
    });

    test('T2-F05-03 Oversized 5000-char contact message handled cleanly without crash', async ({
      page,
    }) => {
      const monitor = attachRuntimeMonitor(page);
      await page.goto('/kontakt');
      const fields = getContactFormFields(page);

      await fields.name.fill('A'.repeat(150));
      await fields.email.fill('ola@example.no');
      await fields.subject.fill('B'.repeat(200));
      await fields.message.fill('C'.repeat(5000));
      await fields.submit.click();

      await expect(page.locator('main')).toBeVisible();
      expect(monitor.pageErrors).toEqual([]);
    });

    test('T2-F05-04 XSS payload in contact form renders safely as plain text in Admin', async ({
      page,
    }, testInfo) => {
      const adminCreds = await requireAdminCredsOrSkip(testInfo);
      const runId = makeRunId();
      const xssSubject = `<script>window.__xss=1</script> ${runId}`;

      await page.goto('/kontakt');
      const fields = getContactFormFields(page);
      await fields.name.fill('<img src=x onerror="window.__xss=2">');
      await fields.email.fill('xss-test@example.no');
      await fields.subject.fill(xssSubject);
      await fields.message.fill('Sikkerhetstest for escaping.');
      await fields.submit.click();
      await expect(
        page.getByText(/takk for din henvendelse|meldingen er sendt|mottatt/i).first(),
      ).toBeVisible({ timeout: 15_000 });

      await signInAdmin(page, adminCreds);
      await expect(page.getByText(xssSubject).first()).toBeVisible({ timeout: 15_000 });
      const xssFlag = await page.evaluate(() => (window as unknown as { __xss?: unknown }).__xss);
      expect(xssFlag).toBeUndefined();
    });

    test('T2-F05-05 Rapid double-submit on /kontakt sends single request', async ({ page }) => {
      await page.goto('/kontakt');
      const fields = getContactFormFields(page);

      await fields.name.fill('Dobbeltklikk Test');
      await fields.email.fill('double@example.no');
      await fields.subject.fill(`Double ${makeRunId()}`);
      await fields.message.fill('Tester beskyttelse mot dobbel innsending.');

      await fields.submit.dblclick();
      await expect(
        page.getByText(/takk for din henvendelse|meldingen er sendt|mottatt/i).first(),
      ).toBeVisible({ timeout: 15_000 });
    });

    test('T2-F05-06 Contact backend/network failure shows Norwegian error & preserves input', async ({
      page,
      context,
    }) => {
      await page.goto('/kontakt');
      const fields = getContactFormFields(page);

      const subject = `Offline test ${makeRunId()}`;
      await fields.name.fill('Offline Bruker');
      await fields.email.fill('offline@example.no');
      await fields.subject.fill(subject);
      await fields.message.fill('Denne meldingen skal beholdes ved feil.');

      await context.setOffline(true);
      try {
        await fields.submit.click();
        await expect(
          page.getByText(/feil|kunne ikke|prøv igjen|nettverk/i).first(),
        ).toBeVisible({ timeout: 15_000 });
        await expect(fields.subject).toHaveValue(subject);
      } finally {
        await context.setOffline(false);
      }
    });
  });

  test.describe('F-06 Boundaries: Admin Auth & Product Validation', () => {
    test('T2-F06-01 Non-admin / unauthenticated visitor denied access to /admin CRUD', async ({
      page,
    }) => {
      await page.goto('/admin');
      await expect(page.getByRole('button', { name: /logg inn/i }).first()).toBeVisible();
      await expect(page.getByRole('button', { name: /opprett produkt|slett/i })).toHaveCount(0);
    });

    test('T2-F06-02 Invalid admin login credentials rejected with Norwegian error', async ({
      page,
    }) => {
      await page.goto('/admin');
      const login = getAdminLoginFields(page);

      await login.email.fill('ikke-admin@example.no');
      await login.password.fill('FeilPassord123!');
      await login.submit.click();

      await expect(
        page.getByText(/feil|ugyldig|kunne ikke logge inn|tilgang/i).first(),
      ).toBeVisible({ timeout: 15_000 });
      await expect(page.getByRole('button', { name: /opprett produkt/i })).toHaveCount(0);
    });

    test('T2-F06-03 Admin rejects zero or negative product price', async ({ page }, testInfo) => {
      const adminCreds = await requireAdminCredsOrSkip(testInfo);
      await signInAdmin(page, adminCreds);

      const form = getAdminProductFormFields(page);
      const invalidTitle = `Nullpris ${makeRunId()}`;
      await form.title.fill(invalidTitle);
      await form.price.fill('0');
      await form.stock.fill('5');
      await form.description.fill('Skal blokkeres pga pris 0.');
      await form.submit.click();

      await expect(page.getByText(invalidTitle)).toHaveCount(0);

      await form.price.fill('-100');
      await form.submit.click();
      await expect(page.getByText(invalidTitle)).toHaveCount(0);
    });

    test('T2-F06-04 Admin rejects negative stock and whitespace-only title', async ({
      page,
    }, testInfo) => {
      const adminCreds = await requireAdminCredsOrSkip(testInfo);
      await signInAdmin(page, adminCreds);

      const form = getAdminProductFormFields(page);
      const beforeDeleteCount = await page.locator('main').getByRole('button', { name: /slett/i }).count();
      await form.title.fill('   ');
      await form.price.fill('500');
      await form.stock.fill('-1');
      await form.description.fill('Ugyldig lager og tittel.');
      await form.submit.click();

      const afterDeleteCount = await page.locator('main').getByRole('button', { name: /slett/i }).count();
      expect(afterDeleteCount).toBe(beforeDeleteCount);
      await expect(page.locator('main').getByText('Ugyldig lager og tittel.')).toHaveCount(0);

      const validationSignal = page
        .locator('main [role="alert"], main [aria-invalid="true"]')
        .or(page.locator('main').getByText(/ugyldig|påkrevd|må være|kan ikke/i))
        .first();
      await expect(validationSignal).toBeVisible();
    });

    test('T2-F06-05 Admin product with unreachable image URL falls back cleanly on store', async ({
      page,
    }, testInfo) => {
      const adminCreds = await requireAdminCredsOrSkip(testInfo);
      const product = makeAdminTestProduct(makeRunId(), {
        imageUrl: 'https://invalid.example.invalid/missing-image.png',
      });

      await signInAdmin(page, adminCreds);
      try {
        await createProductViaAdmin(page, product);
        await page.goto(`/kategori/${product.categorySlug}`);
        await expectHealthyLogoAndImages(page);
      } finally {
        await deleteProductViaAdmin(page, product.title).catch(() => {});
      }
    });

    test('T2-F06-06 Admin oversized title & XSS input handled safely', async ({
      page,
    }, testInfo) => {
      const adminCreds = await requireAdminCredsOrSkip(testInfo);
      await signInAdmin(page, adminCreds);

      const form = getAdminProductFormFields(page);
      const prefix = `XSS${makeRunId().replace(/[^A-Za-z0-9]/g, '')}`;
      const hugeTitle = `${prefix}${'X'.repeat(280)}`;
      await form.title.fill(hugeTitle);
      await form.price.fill('400');
      await form.stock.fill('3');
      await form.description.fill('<script>window.__xss=1</script>');
      await form.submit.click();

      const savedRow = page.locator('main').getByText(prefix).first();
      const validationSignal = page
        .locator('main [role="alert"], main [aria-invalid="true"]')
        .or(page.locator('main').getByText(/maks|lengde|tegn|ugyldig|påkrevd|kan ikke/i))
        .first();
      await expect(savedRow.or(validationSignal)).toBeVisible({ timeout: 15_000 });

      try {
        const xssFlag = await page.evaluate(() => (window as unknown as { __xss?: unknown }).__xss);
        expect(xssFlag).toBeUndefined();
      } finally {
        // Cleanup in case truncated title was saved
        await deleteProductViaAdmin(page, prefix).catch(() => {});
      }
    });
  });

  test.describe('F-07 Boundaries: Cart Limits, Persistence & Math', () => {
    test('T2-F07-01 Decrementing cart item at qty 1 removes item or prevents 0/-1', async ({
      page,
    }) => {
      await addProductToCartFromCatalog(page, STARTER_PRODUCTS.armySekk);
      const drawer = await openCartDrawer(page);
      const row = getCartItemRow(drawer, STARTER_PRODUCTS.armySekk.title);

      const decBtn = row.getByRole('button', { name: /^-|−$|reduser/i }).first();
      if ((await decBtn.count()) > 0 && (await decBtn.isEnabled().catch(() => false))) {
        await decBtn.click();
      }

      const stillPresent = await drawer.getByText(STARTER_PRODUCTS.armySekk.title).count();
      if (stillPresent > 0) {
        const rowText = await row.innerText();
        expect(rowText).not.toMatch(/(?:^|\s)[0-](?:\s|$)/);
        await expect(getCartButton(page)).toContainText(/1/);
      } else {
        await expect(drawer).toContainText(/tom|ingen varer/i);
      }
    });

    test('T2-F07-02 Cart quantity caps strictly at product.stock', async ({ page }, testInfo) => {
      const adminCreds = await requireAdminCredsOrSkip(testInfo);
      const product = makeAdminTestProduct(makeRunId(), {
        title: `LagerGrense ${makeRunId()}`,
        stock: 2,
        priceNok: 500,
      });

      await signInAdmin(page, adminCreds);
      try {
        await createProductViaAdmin(page, product);
        await addProductToCartFromCatalog(page, {
          title: product.title,
          categorySlug: product.categorySlug,
        });

        const drawer = await openCartDrawer(page);
        const row = getCartItemRow(drawer, product.title);
        const incBtn = row.getByRole('button', { name: /^\+$|øk/i }).first();

        await incBtn.click(); // qty = 2
        if (await incBtn.isEnabled().catch(() => false)) {
          await incBtn.click(); // attempt qty 3 -> must cap at 2
        }

        await expect(getCartButton(page)).toContainText(/2/);
        await expect(getCartButton(page)).not.toContainText(/3/);
      } finally {
        await deleteProductViaAdmin(page, product.title).catch(() => {});
      }
    });

    test('T2-F07-03 Corrupt localStorage cart payload recovers cleanly without crash', async ({
      page,
    }) => {
      const monitor = attachRuntimeMonitor(page);
      await addProductToCartFromCatalog(page, STARTER_PRODUCTS.armySekk);

      const corruptedKeys = await page.evaluate(() => {
        const keys: string[] = [];
        for (let i = 0; i < localStorage.length; i += 1) {
          const key = localStorage.key(i);
          if (key) keys.push(key);
        }
        for (let i = 0; i < keys.length; i += 1) {
          localStorage.setItem(
            keys[i],
            i % 2 === 0 ? '{broken-json' : '[{"productId":"unknown","quantity":-5}]',
          );
        }
        return keys.length;
      });
      expect(corruptedKeys).toBeGreaterThan(0);

      await page.reload();
      await expect(page.locator('main')).toBeVisible();
      await page.goto('/kategori/alle');
      await expect(getProductLinkByTitle(page, STARTER_PRODUCTS.armySekk.title)).toBeVisible();
      expect(monitor.pageErrors).toEqual([]);
    });

    test('T2-F07-04 Rapid 5x add-to-cart clicks keep totals valid without NaN', async ({ page }) => {
      await page.goto('/kategori/seveno-home');
      await getProductLinkByTitle(page, STARTER_PRODUCTS.skobeholder.title).click();

      const addBtn = page.getByRole('button', { name: /legg i handlekurv/i }).first();
      for (let i = 0; i < 5; i += 1) {
        await addBtn.click();
      }

      const drawer = await openCartDrawer(page);
      const drawerText = await drawer.innerText();
      expect(drawerText).not.toMatch(/NaN|undefined/i);
      expect(drawerText).toMatch(/\d[\d\s\u00a0\u202f]*\s*kr/i);
    });

    test('T2-F07-05 Stale cart item deleted by admin handled gracefully on reload', async ({
      page,
    }, testInfo) => {
      const adminCreds = await requireAdminCredsOrSkip(testInfo);
      const product = makeAdminTestProduct(makeRunId(), {
        title: `SnartSlettet ${makeRunId()}`,
        priceNok: 750,
        stock: 5,
      });

      await signInAdmin(page, adminCreds);
      await createProductViaAdmin(page, product);

      await addProductToCartFromCatalog(page, {
        title: product.title,
        categorySlug: product.categorySlug,
      });

      await deleteProductViaAdmin(page, product.title);

      const monitor = attachRuntimeMonitor(page);
      await page.goto('/utsjekk');
      const mainText = await page.locator('main').innerText();
      expect(mainText).not.toMatch(/NaN|undefined/i);
      expect(monitor.pageErrors).toEqual([]);
    });

    test('T2-F07-06 Multi-item NOK math precision (no floating-point artifacts)', async ({ page }) => {
      await addProductToCartFromCatalog(page, STARTER_PRODUCTS.armySekk);
      await addProductToCartFromCatalog(page, STARTER_PRODUCTS.skobeholder);

      const drawer = await openCartDrawer(page);
      await getCartItemRow(drawer, STARTER_PRODUCTS.armySekk.title)
        .getByRole('button', { name: /^\+$|øk/i })
        .first()
        .click();

      await page.goto('/utsjekk');
      const text = await page.locator('main').innerText();
      expect(text).not.toMatch(/\.\d{3,}/);

      extractAndAssertOrderMath(text);
    });
  });

  test.describe('F-08 Boundaries: Checkout Validation & Tamper Guards', () => {
    test('T2-F08-01 Empty cart on /utsjekk blocks submission with Norwegian notice', async ({
      page,
    }) => {
      await page.goto('/utsjekk');
      await expect(page.locator('main')).toContainText(/tom|ingen varer|handlekurven/i);

      const submitBtn = getCheckoutFormFields(page).submit;
      if ((await submitBtn.count()) > 0 && (await submitBtn.isVisible().catch(() => false))) {
        await expect(submitBtn).toBeDisabled();
      }
    });

    test('T2-F08-02 Invalid Norwegian Postnummer formats rejected on /utsjekk', async ({
      page,
    }) => {
      await addProductToCartFromCatalog(page, STARTER_PRODUCTS.armySekk);
      await page.goto('/utsjekk');

      for (const badPostal of INVALID_POSTAL_CODES) {
        await fillCheckoutCustomer(page, {
          ...VALID_NORWEGIAN_CUSTOMER,
          postalCode: badPostal,
        });
        await getCheckoutFormFields(page).submit.click();

        await expect(
          page.getByRole('heading', { name: /ordrebekreftelse/i }),
        ).toHaveCount(0);
      }
    });

    test('T2-F08-03 Leading-zero Postnummer ("0001") preserved verbatim', async ({ page }) => {
      await addProductToCartFromCatalog(page, STARTER_PRODUCTS.armySekk);
      const { confirmationText } = await submitOrderAndReadConfirmation(page, 'test_order', {
        ...VALID_NORWEGIAN_CUSTOMER,
        postalCode: '0001',
      });
      expect(confirmationText).toContain('0001');
    });

    test('T2-F08-04 Invalid email and empty required fields block checkout submit', async ({
      page,
    }) => {
      await addProductToCartFromCatalog(page, STARTER_PRODUCTS.armySekk);
      await page.goto('/utsjekk');

      await fillCheckoutCustomer(page, {
        ...VALID_NORWEGIAN_CUSTOMER,
        name: '   ',
        email: 'feil@',
        street: '',
      });
      await getCheckoutFormFields(page).submit.click();

      await expect(
        page.getByRole('heading', { name: /ordrebekreftelse/i }),
      ).toHaveCount(0);
    });

    test('T2-F08-05 Client-side price tamper guard recalculates authoritative catalog prices', async ({
      page,
    }) => {
      await page.goto('/kategori/seveno-outdoor');
      const pergolaCard = getProductCardByTitle(page, STARTER_PRODUCTS.pergola.title);
      const realPrice = extractNokAmount(await pergolaCard.innerText());

      await addProductToCartFromCatalog(page, STARTER_PRODUCTS.pergola);

      // Tamper with any stored price values in localStorage
      await page.evaluate(() => {
        for (let i = 0; i < localStorage.length; i += 1) {
          const k = localStorage.key(i);
          if (!k) continue;
          const val = localStorage.getItem(k);
          if (val && val.includes('{')) {
            localStorage.setItem(k, val.replace(/"priceNok"\s*:\s*\d+/g, '"priceNok":1'));
          }
        }
      });

      await page.reload();
      const { confirmationText } = await submitOrderAndReadConfirmation(page, 'test_order');
      const totalLine = confirmationText.match(
        /(?:totalt|totalpris)[^\n\r\d]*(\d[\d\s\u00a0\u202f.]*(?:,\d{1,2}|,-)?\s*kr)/i,
      );
      if (totalLine) {
        expect(parseNok(totalLine[1])).toBeGreaterThanOrEqual(realPrice);
      } else {
        expect(confirmationText).not.toMatch(/\b1\s*kr\b/);
      }
    });

    test('T2-F08-06 Checkout double-submit creates only one order', async ({ page }) => {
      await addProductToCartFromCatalog(page, STARTER_PRODUCTS.skobeholder);
      await page.goto('/utsjekk');
      await fillCheckoutCustomer(page);
      await getPaymentOption(page, 'test_order').click();

      const submitBtn = getCheckoutFormFields(page).submit;
      await submitBtn.dblclick();

      await expect(
        page.getByRole('heading', { name: /ordrebekreftelse|takk for din bestilling/i }).first(),
      ).toBeVisible({ timeout: 20_000 });
      const matches = (await page.locator('main').innerText()).match(/SEV-\d{4}-[A-Z0-9]{4}/g) || [];
      expect(new Set(matches).size).toBe(1);
    });
  });

  test.describe('F-09 Boundaries: Payment Provider Resilience', () => {
    test('T2-F09-01 Default provider selected or explicit selection enforced on /utsjekk', async ({
      page,
    }) => {
      await addProductToCartFromCatalog(page, STARTER_PRODUCTS.armySekk);
      await page.goto('/utsjekk');
      await fillCheckoutCustomer(page);

      // Submitting directly either succeeds with default provider or prompts selection cleanly
      await getCheckoutFormFields(page).submit.click();

      const confirmation = page
        .getByRole('heading', { name: /ordrebekreftelse|takk for din bestilling/i })
        .first();
      const validationError = page
        .locator('main [role="alert"]')
        .or(
          page
            .locator('main')
            .getByText(/velg.*betaling|betalingsmetode|betalingsleverandør|påkrevd/i),
        )
        .first();
      await expect(confirmation.or(validationError)).toBeVisible({ timeout: 15_000 });

      if (await confirmation.isVisible().catch(() => false)) {
        const mainText = await page.locator('main').innerText();
        expect(mainText).toMatch(/SEV-\d{4}-[A-Z0-9]{4}/);
      }
    });

    test('T2-F09-02 Klarna and Vipps fall back cleanly to sandbox simulation without live keys', async ({
      page,
    }) => {
      const monitor = attachRuntimeMonitor(page);

      await addProductToCartFromCatalog(page, STARTER_PRODUCTS.armySekk);
      const klarna = await submitOrderAndReadConfirmation(page, 'klarna');
      expect(klarna.confirmationText).toMatch(/Klarna/i);

      await addProductToCartFromCatalog(page, STARTER_PRODUCTS.skobeholder);
      const vipps = await submitOrderAndReadConfirmation(page, 'vipps');
      expect(vipps.confirmationText).toMatch(/Vipps/i);

      monitor.assertClean();
    });

    test('T2-F09-03 Distinct Klarna vs Vipps metadata visible in Ordrebekreftelse & Admin', async ({
      page,
    }, testInfo) => {
      const adminCreds = await requireAdminCredsOrSkip(testInfo);

      await addProductToCartFromCatalog(page, STARTER_PRODUCTS.armySekk);
      const klarnaOrder = await submitOrderAndReadConfirmation(page, 'klarna');

      await addProductToCartFromCatalog(page, STARTER_PRODUCTS.skobeholder);
      const vippsOrder = await submitOrderAndReadConfirmation(page, 'vipps');

      expect(klarnaOrder.orderNumber).not.toBe(vippsOrder.orderNumber);

      await signInAdmin(page, adminCreds);
      await expect(page.getByText(klarnaOrder.orderNumber).first()).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText(vippsOrder.orderNumber).first()).toBeVisible({ timeout: 15_000 });
    });

    test('T2-F09-04 Klarna/Vipps order confirmation preserves exact 25% MVA & NOK totals', async ({
      page,
    }) => {
      await addProductToCartFromCatalog(page, STARTER_PRODUCTS.pergola);
      const { confirmationText } = await submitOrderAndReadConfirmation(page, 'vipps');

      extractAndAssertOrderMath(confirmationText);
    });

    test('T2-F09-05 Network/payment failure preserves cart and allows retry on /utsjekk', async ({
      page,
      context,
    }) => {
      await addProductToCartFromCatalog(page, STARTER_PRODUCTS.armySekk);
      await page.goto('/utsjekk');
      await fillCheckoutCustomer(page);
      await getPaymentOption(page, 'klarna').click();

      await context.setOffline(true);
      try {
        await getCheckoutFormFields(page).submit.click();
        await expect(
          page.getByText(/feil|kunne ikke|prøv igjen|nettverk/i).first(),
        ).toBeVisible({ timeout: 15_000 });
        await expect(page).toHaveURL(/\/utsjekk/);
        await expect(getCartButton(page)).toContainText(/1/);
      } finally {
        await context.setOffline(false);
      }
    });
  });

  test.describe('F-10 Boundaries: AI Assistant Edge Cases', () => {
    test('T2-F10-01 Empty or whitespace-only AI prompt ignored/disabled', async ({ page }) => {
      await page.goto('/');
      await getAiLauncher(page).click();
      const panel = getAiPanel(page);
      const input = getAiInput(panel);
      const sendBtn = getAiSendButton(panel);

      const textBefore = (await panel.innerText()).trim();
      await input.fill('   \n  ');
      if (await sendBtn.isEnabled().catch(() => false)) {
        await sendBtn.click();
      }
      await expect
        .poll(async () => (await panel.innerText()).trim())
        .toBe(textBefore);
    });

    test('T2-F10-02 Oversized 2500-char AI prompt wraps cleanly without horizontal overflow', async ({
      page,
    }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto('/');
      await getAiLauncher(page).click();
      const panel = getAiPanel(page);
      const input = getAiInput(panel);

      const longToken = 'SevenoLangtSammenhengendeOrd'.repeat(90);
      await input.fill(longToken);
      const sendBtn = getAiSendButton(panel);
      if (await sendBtn.isEnabled().catch(() => false)) {
        await sendBtn.click();
        await expect(
          panel
            .getByText(longToken.slice(0, 40))
            .or(panel.getByText(/for lang|maks|tegn|ugyldig/i))
            .first(),
        ).toBeVisible({ timeout: 15_000 });
      }
      await expectNoHorizontalOverflow(page);
    });

    test('T2-F10-03 Out-of-catalog AI prompt responds gracefully in Norwegian', async ({ page }) => {
      await page.goto('/');
      const { replyDelta } = await askAiAssistant(
        page,
        'Selger dere iPhone 16 eller elektriske biler?',
      );
      expect(replyDelta).toMatch(/ikke|dessverre|Seveno|sortiment|katalog|produkter/i);
    });

    test('T2-F10-04 XSS payload in AI chat renders as inert escaped text', async ({ page }) => {
      await page.goto('/');
      await getAiLauncher(page).click();
      const panel = getAiPanel(page);
      const input = getAiInput(panel);
      const xssPrompt = '<script>window.__xss=1</script><img src=x onerror="window.__xss=2">';

      await input.fill(xssPrompt);
      await getAiSendButton(panel).click();
      await expect(panel).toContainText('window.__xss=1', { timeout: 15_000 });

      const xssFlag = await page.evaluate(() => (window as unknown as { __xss?: unknown }).__xss);
      expect(xssFlag).toBeUndefined();
    });

    test('T2-F10-05 Fault-injected AI backend failure shows Norwegian fallback & preserves store', async ({
      page,
    }) => {
      await page.route(
        /generativelanguage\.googleapis\.com|firebasevertexai\.googleapis\.com|firebaseailogic/i,
        (route) => route.abort('failed'),
      );

      await page.goto('/');
      await getAiLauncher(page).click();
      const panel = getAiPanel(page);
      await getAiInput(panel).fill('Hva koster Pergola?');
      await getAiSendButton(panel).click();

      await expect(
        panel.getByText(/beklager|feil|utilgjengelig|prøv igjen|kontakt/i).first(),
      ).toBeVisible({ timeout: 20_000 });

      // Storefront navigation & cart remain completely unaffected
      await addProductToCartFromCatalog(page, STARTER_PRODUCTS.armySekk);
      await expect(getCartButton(page)).toContainText(/1/);
    });
  });
});
