import { expect, test } from '@playwright/test';
import {
  attachRuntimeMonitor,
  expectNoHorizontalOverflow,
  extractAndAssertOrderMath,
} from '../helpers/assertions';
import { getEmulatorAuthUrl, getTargetMode } from '../helpers/env';
import {
  getAdminLoginFields,
  getAdminProductFormFields,
  getAiInput,
  getAiLauncher,
  getAiPanel,
  getAiSendButton,
  getCartButton,
  getCartDrawer,
  getContactFormFields,
  getHeader,
  getLogoLink,
  getMobileMenuButton,
  getMobileNavDrawer,
  getPaymentOption,
  getProductCardByTitle,
  getProductLinkByTitle,
  getVisibleAdminProductRows,
  openCartDrawer,
} from '../helpers/selectors';
import {
  addProductToCartFromCatalog,
  applyAiAppCheckDebugToken,
  createProductViaAdmin,
  deleteProductViaAdmin,
  fillCheckoutCustomer,
  makeAdminTestProduct,
  makeRunId,
  requireAdminCredsOrSkip,
  signInAdmin,
  STARTER_PRODUCTS,
  submitOrderAndReadConfirmation,
  VALID_NORWEGIAN_CUSTOMER,
} from '../helpers/testdata';

test.describe('Tier 5 — White-Box Adversarial Hardening', () => {
  test.beforeEach(async ({ page }) => {
    await applyAiAppCheckDebugToken(page);
  });

  test('T5-01 Narrow 320x568 Header & Interactive Control Visibility (Zero Clipping/Overlap)', async ({
    page,
  }) => {
    const monitor = attachRuntimeMonitor(page);
    await page.setViewportSize({ width: 320, height: 568 });

    for (const route of ['/', '/kategori/alle', '/kontakt', '/utsjekk']) {
      await page.goto(route);
      await expect(getHeader(page)).toBeVisible();
      await expectNoHorizontalOverflow(page);

      const logoBox = await getLogoLink(page).boundingBox();
      const cartBox = await getCartButton(page).boundingBox();
      const menuBtn = getMobileMenuButton(page);
      const menuBox = await menuBtn.boundingBox();

      expect(logoBox, `Logo box missing on ${route}`).not.toBeNull();
      expect(cartBox, `Cart box missing on ${route}`).not.toBeNull();
      expect(menuBox, `Menu button box missing on ${route}`).not.toBeNull();

      expect(logoBox!.x).toBeGreaterThanOrEqual(0);
      expect(logoBox!.x + logoBox!.width).toBeLessThanOrEqual(cartBox!.x + 1);
      expect(cartBox!.x + cartBox!.width).toBeLessThanOrEqual(menuBox!.x + 1);
      expect(menuBox!.x + menuBox!.width).toBeLessThanOrEqual(320);

      await menuBtn.click();
      const drawer = getMobileNavDrawer(page);
      await expect(drawer).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(drawer).toBeHidden();
    }

    monitor.assertClean();
  });

  test('T5-02 Tailwind v4 wrap-anywhere Overflow Stress (320x568) Across Storefront, Drawer, Admin & Confirmation', async ({
    page,
  }, testInfo) => {
    test.setTimeout(75_000);
    const monitor = attachRuntimeMonitor(page);
    const adminCreds = await requireAdminCredsOrSkip(testInfo);
    const runId = makeRunId();
    const longToken = `SuperLangtNordiskProduktOrd${'X'.repeat(42)}-${runId}`;
    const product = makeAdminTestProduct(runId, {
      title: longToken,
      categorySlug: 'seveno-living',
      categoryName: 'Seveno living',
      priceNok: 1690,
      stock: 5,
      description: `LangBeskrivelse_${'Y'.repeat(65)}_slutt`,
      specs: `LangSpesifikasjon_${'Z'.repeat(65)}_slutt`,
      imageUrl: '',
    });

    await signInAdmin(page, adminCreds);
    try {
      await createProductViaAdmin(page, product);

      await page.setViewportSize({ width: 320, height: 568 });

      // 1. /kategori/seveno-living ProductCard wrapping
      await page.goto('/kategori/seveno-living');
      const card = getProductCardByTitle(page, longToken);
      await expect(card).toBeVisible({ timeout: 15_000 });
      await expectNoHorizontalOverflow(page);
      const cardMetrics = await card.evaluate((el) => {
        const h3 = el.querySelector('h3');
        return {
          cardScrollWidth: el.scrollWidth,
          cardClientWidth: el.clientWidth,
          h3OverflowWrap: h3 ? getComputedStyle(h3).overflowWrap : '',
        };
      });
      expect(cardMetrics.cardScrollWidth).toBeLessThanOrEqual(cardMetrics.cardClientWidth + 1);
      expect(cardMetrics.h3OverflowWrap).toBe('anywhere');

      // 2. /produkt/<slug> Detail page wrapping
      await getProductLinkByTitle(page, longToken).click();
      await expect(page).toHaveURL(/\/produkt\//);
      await expectNoHorizontalOverflow(page);
      const h1Metrics = await page.locator('main h1').evaluate((el) => ({
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
        overflowWrap: getComputedStyle(el).overflowWrap,
      }));
      expect(h1Metrics.scrollWidth).toBeLessThanOrEqual(h1Metrics.clientWidth + 1);
      expect(h1Metrics.overflowWrap).toBe('anywhere');

      // 3. Add to cart + CartDrawer wrapping
      await page.getByRole('button', { name: /legg i handlekurv/i }).first().click();
      await expect(getCartButton(page)).toContainText(/1/);
      const drawer = await openCartDrawer(page);
      const drawerMetrics = await drawer.evaluate((el) => {
        const link = el.querySelector('a[href^="/produkt/"]');
        return {
          drawerScrollWidth: el.scrollWidth,
          drawerClientWidth: el.clientWidth,
          linkScrollWidth: link ? link.scrollWidth : 0,
          linkClientWidth: link ? link.clientWidth : 0,
        };
      });
      expect(drawerMetrics.drawerScrollWidth).toBeLessThanOrEqual(
        drawerMetrics.drawerClientWidth + 1,
      );
      expect(drawerMetrics.linkScrollWidth).toBeLessThanOrEqual(drawerMetrics.linkClientWidth + 1);
      await drawer.getByRole('button', { name: /lukk handlekurv/i }).first().click();
      await expect(drawer).toBeHidden();

      // 4. /admin mobile card wrapping
      await page.goto('/admin');
      const adminRow = getVisibleAdminProductRows(page, longToken).first();
      await expect(adminRow).toBeVisible({ timeout: 15_000 });
      await expectNoHorizontalOverflow(page);

      // 5. /utsjekk -> OrderConfirmation wrapping
      const { orderNumber } = await submitOrderAndReadConfirmation(page, 'test_order');
      expect(orderNumber).toMatch(/^SEV-\d{4}-[A-Z0-9]{4}$/);
      await expectNoHorizontalOverflow(page);
    } finally {
      await deleteProductViaAdmin(page, product.title).catch(() => {});
    }

    monitor.assertClean();
  });

  test('T5-03 Corrupted, Negative & Over-Stock localStorage Cart Recovery + Pre-Payment Guard on /utsjekk', async ({
    page,
  }) => {
    const monitor = attachRuntimeMonitor(page);
    await page.goto('/');

    await page.evaluate(() => {
      localStorage.setItem(
        'seveno_cart_v1',
        JSON.stringify([
          { productId: 'pergola', quantity: 99 },
          { productId: 'deleted-item-xyz', quantity: 2 },
          { productId: 'army-sekk', quantity: -5 },
          'corrupt-entry',
        ]),
      );
    });

    await page.goto('/utsjekk');

    const summaryAside = page.locator('aside[aria-labelledby="checkout-summary-heading"]');
    await expect(summaryAside).toBeVisible({ timeout: 15_000 });
    await expect(summaryAside).not.toContainText(STARTER_PRODUCTS.armySekk.title);
    await expect(summaryAside).toContainText('Ikke lenger tilgjengelig');
    await expect(summaryAside).toContainText('Bare 6 stk på lager');

    // Attempt submit before fixing invalid/over-stock items -> rejected before OrderConfirmation
    await fillCheckoutCustomer(page, VALID_NORWEGIAN_CUSTOMER);
    await getPaymentOption(page, 'klarna').click();
    await page.getByRole('button', { name: /fullfør testbestilling/i }).click();

    await expect(page.locator('form [role="alert"]').first()).toBeVisible();
    await expect(
      page.getByRole('heading', { name: /ordrebekreftelse|takk for din bestilling/i }),
    ).toHaveCount(0);

    // Recover by removing unavailable item and clamping pergola to max stock (6)
    await summaryAside
      .locator('li')
      .filter({ hasText: 'deleted-item-xyz' })
      .getByRole('button', { name: 'Fjern' })
      .click();
    await summaryAside.getByRole('button', { name: /juster til maks \(6\)/i }).click();
    await expect(summaryAside).not.toContainText('Ikke lenger tilgjengelig');
    await expect(summaryAside).not.toContainText('Bare 6 stk på lager');

    await page.getByRole('button', { name: /fullfør testbestilling/i }).click();
    await expect(
      page.getByRole('heading', { name: /takk for din bestilling/i }).first(),
    ).toBeVisible({ timeout: 20_000 });

    monitor.assertClean();
  });

  test('T5-04 Mid-Session Admin Stock Reduction Triggers Pre-Payment Guard & Recovery', async ({
    page,
  }, testInfo) => {
    test.setTimeout(75_000);
    const monitor = attachRuntimeMonitor(page);
    const adminCreds = await requireAdminCredsOrSkip(testInfo);
    const runId = makeRunId();
    const product = makeAdminTestProduct(runId, {
      title: `LagerVakt ${runId}`,
      priceNok: 950,
      stock: 5,
    });

    await signInAdmin(page, adminCreds);
    try {
      await createProductViaAdmin(page, product);

      // Customer adds all 5 units to cart
      await page.goto(`/kategori/${product.categorySlug}`);
      await getProductLinkByTitle(page, product.title).click();
      await expect(page).toHaveURL(/\/produkt\//);
      for (let i = 0; i < 4; i += 1) {
        await page.getByRole('button', { name: /øk antall/i }).click();
      }
      await page.getByRole('button', { name: /legg i handlekurv/i }).first().click();
      await expect(getCartButton(page)).toContainText(/5/);

      // Admin lowers stock to 2 mid-session
      await page.goto('/admin');
      const row = getVisibleAdminProductRows(page, product.title).first();
      await expect(row).toBeVisible({ timeout: 15_000 });
      await row.getByRole('button', { name: /rediger/i }).first().click();

      const form = getAdminProductFormFields(page);
      await form.stock.fill('2');
      await form.submit.click();
      await expect(page.getByRole('status').filter({ hasText: /lagret/i }).first()).toBeVisible({
        timeout: 15_000,
      });

      // Navigate to /utsjekk -> over-stock warning shown before submit
      await page.goto('/utsjekk');
      const summaryAside = page.locator('aside[aria-labelledby="checkout-summary-heading"]');
      await expect(summaryAside).toContainText('Bare 2 stk på lager', { timeout: 15_000 });

      await fillCheckoutCustomer(page, VALID_NORWEGIAN_CUSTOMER);
      await getPaymentOption(page, 'vipps').click();
      await page.getByRole('button', { name: /fullfør testbestilling/i }).click();

      await expect(page.locator('form [role="alert"]').first()).toContainText(/bare 2 stk på lager/i);
      await expect(
        page.getByRole('heading', { name: /takk for din bestilling/i }),
      ).toHaveCount(0);

      // Clamp to 2 and complete checkout
      await summaryAside.getByRole('button', { name: /juster til maks \(2\)/i }).click();
      await page.getByRole('button', { name: /fullfør testbestilling/i }).click();
      await expect(
        page.getByRole('heading', { name: /takk for din bestilling/i }).first(),
      ).toBeVisible({ timeout: 20_000 });
    } finally {
      await deleteProductViaAdmin(page, product.title).catch(() => {});
    }

    monitor.assertClean();
  });

  test('T5-05 Offline Network Failure Recovery on /kontakt and Signed-In /utsjekk', async ({
    page,
    context,
  }) => {
    test.setTimeout(75_000);

    // 1. /kontakt offline guard & recovery
    await page.goto('/kontakt');
    const contact = getContactFormFields(page);
    await contact.name.fill('Nora Solberg');
    await contact.email.fill('nora@example.no');
    await contact.subject.fill('Offline test');
    await contact.message.fill('Tester at nettverksbrudd på kontaktskjema feiler raskt.');

    await context.setOffline(true);
    try {
      await contact.submit.click();
      await expect(page.locator('main [role="alert"]').first()).toBeVisible({ timeout: 12_000 });
      await expect(contact.submit).toBeEnabled({ timeout: 12_000 });
      await expect(contact.name).toHaveValue('Nora Solberg');
      await expect(contact.message).toHaveValue(
        'Tester at nettverksbrudd på kontaktskjema feiler raskt.',
      );
    } finally {
      await context.setOffline(false);
    }

    await contact.submit.click();
    await expect(
      page.getByText(/takk for din henvendelse|meldingen er sendt/i).first(),
    ).toBeVisible({ timeout: 15_000 });

    // 2. Establish an active Auth session via a quick order, then test signed-in offline /utsjekk
    await addProductToCartFromCatalog(page, STARTER_PRODUCTS.armySekk);
    await expect(getCartButton(page)).toContainText(/1/);
    await submitOrderAndReadConfirmation(page, 'test_order');

    await addProductToCartFromCatalog(page, STARTER_PRODUCTS.armySekk);
    await expect(getCartButton(page)).toContainText(/1/);
    await page.goto('/utsjekk');
    await fillCheckoutCustomer(page, VALID_NORWEGIAN_CUSTOMER);
    await getPaymentOption(page, 'test_order').click();

    await context.setOffline(true);
    try {
      const submitBtn = page.getByRole('button', { name: /fullfør testbestilling/i });
      await submitBtn.click();
      await expect(page.locator('form [role="alert"]').first()).toBeVisible({ timeout: 12_000 });
      await expect(submitBtn).toBeEnabled({ timeout: 12_000 });
      await expect(getCartButton(page)).toContainText(/1/);
      await expect(page.locator('#checkout-name')).toHaveValue(VALID_NORWEGIAN_CUSTOMER.name);
    } finally {
      await context.setOffline(false);
    }

    await page.getByRole('button', { name: /fullfør testbestilling/i }).click();
    await expect(
      page.getByRole('heading', { name: /takk for din bestilling/i }).first(),
    ).toBeVisible({ timeout: 20_000 });
  });

  test('T5-06 Non-Admin Authenticated User RBAC Boundary on /admin + Firestore Write Denial', async ({
    page,
  }, testInfo) => {
    if (getTargetMode() !== 'emulator') {
      testInfo.skip(true, 'Non-admin emulator user provisioning requires E2E_TARGET=emulator.');
      return;
    }

    const authUrl = getEmulatorAuthUrl();
    const runId = makeRunId().toLowerCase();
    const nonAdminEmail = `kunde-${runId}@example.no`;
    const nonAdminPass = 'KundePassord!2026';

    const signUpRes = await fetch(
      `${authUrl}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-api-key`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: nonAdminEmail,
          password: nonAdminPass,
          emailVerified: true,
          returnSecureToken: true,
        }),
      },
    );
    expect(signUpRes.ok, 'Failed to create non-admin emulator test user').toBe(true);
    const signUpData = (await signUpRes.json()) as { localId: string; idToken: string };

    // Mark emailVerified in emulator admin endpoint
    await fetch(
      `${authUrl}/identitytoolkit.googleapis.com/v1/accounts:update?key=fake-api-key`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer owner',
        },
        body: JSON.stringify({ localId: signUpData.localId, emailVerified: true }),
      },
    );

    // 1. UI check: sign in on /admin as non-admin -> denied
    await page.goto('/admin');
    const login = getAdminLoginFields(page);
    await login.email.fill(nonAdminEmail);
    await login.password.fill(nonAdminPass);
    await login.submit.click();

    await expect(page.getByText(/ingen administratortilgang/i).first()).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByRole('tab', { name: /produkter|bestillinger|henvendelser/i })).toHaveCount(
      0,
    );

    // 2. Direct Firestore REST API write as non-admin must be rejected with 403
    const nowIso = new Date().toISOString();
    const tamperProductRes = await fetch(
      `http://127.0.0.1:8080/v1/projects/spill-2p-math/databases/(default)/documents/products?documentId=tamper-${runId}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${signUpData.idToken}`,
        },
        body: JSON.stringify({
          fields: {
            slug: { stringValue: `tamper-${runId}` },
            title: { stringValue: 'Tamper Product' },
            categorySlug: { stringValue: 'seveno-living' },
            categoryName: { stringValue: 'Seveno living' },
            description: { stringValue: 'Uautorisert produktinnsetting.' },
            priceNok: { integerValue: '100' },
            stock: { integerValue: '10' },
            imageUrl: { stringValue: '/images/products/seveno-default.svg' },
            specs: { arrayValue: { values: [] } },
            active: { booleanValue: true },
            createdAt: { timestampValue: nowIso },
            updatedAt: { timestampValue: nowIso },
          },
        }),
      },
    );
    expect(tamperProductRes.status).toBe(403);
  });

  test('T5-07 Direct Firestore Rules Order Price, Subtotal, Provider, Phone & Item-Cap (1..4 OK, 5+ 403) + Checkout Math', async ({
    page,
  }, testInfo) => {
    const monitor = attachRuntimeMonitor(page);

    if (getTargetMode() === 'emulator') {
      const authUrl = getEmulatorAuthUrl();
      const adminCreds = await requireAdminCredsOrSkip(testInfo);
      const adminSignInRes = await fetch(
        `${authUrl}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-api-key`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: adminCreds.email,
            password: adminCreds.password,
            returnSecureToken: true,
          }),
        },
      );
      expect(adminSignInRes.ok, 'Admin Emulator sign-in failed in T5-07').toBe(true);
      const { idToken: adminToken } = (await adminSignInRes.json()) as { idToken: string };

      const anonRes = await fetch(
        `${authUrl}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-api-key`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ returnSecureToken: true }),
        },
      );
      expect(anonRes.ok).toBe(true);
      const { localId, idToken } = (await anonRes.json()) as {
        localId: string;
        idToken: string;
      };
      const nowIso = new Date().toISOString();
      const fsBase = 'http://127.0.0.1:8080/v1/projects/spill-2p-math/databases/(default)/documents';
      const suffix = makeRunId().toLowerCase();
      const extraProd4Id = `t5-07-extra-4-${suffix}`;
      const extraProd5Id = `t5-07-extra-5-${suffix}`;

      const seedExtraProduct = async (docId: string, title: string, priceNok: number) => {
        const res = await fetch(`${fsBase}/products?documentId=${docId}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${adminToken}`,
          },
          body: JSON.stringify({
            fields: {
              slug: { stringValue: docId },
              title: { stringValue: title },
              categorySlug: { stringValue: 'seveno-living' },
              categoryName: { stringValue: 'Seveno living' },
              description: { stringValue: 'Midlertidig testprodukt for T5-07 Firestore-regler.' },
              priceNok: { integerValue: String(priceNok) },
              stock: { integerValue: '10' },
              imageUrl: { stringValue: '/images/products/seveno-default.svg' },
              specs: { arrayValue: { values: [] } },
              active: { booleanValue: true },
              createdAt: { timestampValue: nowIso },
              updatedAt: { timestampValue: nowIso },
            },
          }),
        });
        expect(res.ok, `Failed to seed ${docId}: ${res.status}`).toBe(true);
      };

      const postOrder = async (docId: string, overrides: Record<string, unknown> = {}) => {
        const baseFields: Record<string, unknown> = {
          orderNumber: { stringValue: 'SEV-2026-TAMPER01' },
          ownerUid: { stringValue: localId },
          customer: {
            mapValue: {
              fields: {
                name: { stringValue: 'Ola Nordmann' },
                email: { stringValue: 'ola@example.no' },
                phone: { stringValue: '91234567' },
              },
            },
          },
          shippingAddress: {
            mapValue: {
              fields: {
                street: { stringValue: 'Storgata 10' },
                postalCode: { stringValue: '0155' },
                city: { stringValue: 'Oslo' },
              },
            },
          },
          items: {
            arrayValue: {
              values: [
                {
                  mapValue: {
                    fields: {
                      productId: { stringValue: 'pergola' },
                      title: { stringValue: 'Pergola' },
                      quantity: { integerValue: '1' },
                      unitPriceNok: { integerValue: '24900' },
                      lineTotalNok: { integerValue: '24900' },
                    },
                  },
                },
              ],
            },
          },
          subtotalNok: { integerValue: '24900' },
          shippingNok: { integerValue: '0' },
          mvaNok: { integerValue: '4980' },
          totalNok: { integerValue: '24900' },
          paymentProvider: { stringValue: 'test_order' },
          paymentReference: { stringValue: 'TEST-2026-ABCDEF12' },
          paymentStatus: { stringValue: 'paid_test' },
          status: { stringValue: 'confirmed' },
          createdAt: { timestampValue: nowIso },
          ...overrides,
        };

        return fetch(`${fsBase}/orders?documentId=${docId}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${idToken}`,
          },
          body: JSON.stringify({ fields: baseFields }),
        });
      };

      await seedExtraProduct(extraProd4Id, `T5 Extra 4 ${suffix}`, 500);
      await seedExtraProduct(extraProd5Id, `T5 Extra 5 ${suffix}`, 600);
      try {
        const makeItem = (productId: string, title: string, priceNok: number) => ({
          mapValue: {
            fields: {
              productId: { stringValue: productId },
              title: { stringValue: title },
              quantity: { integerValue: '1' },
              unitPriceNok: { integerValue: String(priceNok) },
              lineTotalNok: { integerValue: String(priceNok) },
            },
          },
        });

        // 0a. Valid n=4 (exact orderItemsMax) must return HTTP 200 with full get() verification
        // Subtotal: 1890 + 349 + 24900 + 500 = 27639 (>= 1500 -> shipping 0, mva 5528)
        const order4Res = await postOrder(`valid-n4-${Date.now()}`, {
          orderNumber: { stringValue: 'SEV-2026-MAX0004' },
          items: {
            arrayValue: {
              values: [
                makeItem('army-sekk', 'Army sekk', 1890),
                makeItem('akryl-gjennomsiktig-skobeholder', 'Akryl gjennomsiktig skobeholder', 349),
                makeItem('pergola', 'Pergola', 24900),
                makeItem(extraProd4Id, `T5 Extra 4 ${suffix}`, 500),
              ],
            },
          },
          subtotalNok: { integerValue: '27639' },
          shippingNok: { integerValue: '0' },
          mvaNok: { integerValue: '5528' },
          totalNok: { integerValue: '27639' },
        });
        expect(order4Res.status, await order4Res.clone().text()).toBe(200);

        // 0b. n=5 (orderItemsMax + 1) must be cleanly rejected with HTTP 403 (not 1000-expression error)
        // Subtotal: 27639 + 600 = 28239
        const order5Res = await postOrder(`overcap-n5-${Date.now()}`, {
          orderNumber: { stringValue: 'SEV-2026-OVER005' },
          items: {
            arrayValue: {
              values: [
                makeItem('army-sekk', 'Army sekk', 1890),
                makeItem('akryl-gjennomsiktig-skobeholder', 'Akryl gjennomsiktig skobeholder', 349),
                makeItem('pergola', 'Pergola', 24900),
                makeItem(extraProd4Id, `T5 Extra 4 ${suffix}`, 500),
                makeItem(extraProd5Id, `T5 Extra 5 ${suffix}`, 600),
              ],
            },
          },
          subtotalNok: { integerValue: '28239' },
          shippingNok: { integerValue: '0' },
          mvaNok: { integerValue: '5648' },
          totalNok: { integerValue: '28239' },
        });
        expect(order5Res.status).toBe(403);
        const order5Body = await order5Res.text();
        expect(order5Body).not.toMatch(/maximum of 1000 expressions/i);

        // 1. Tampered unitPriceNok (1 kr instead of 24 900 kr)
        const priceTamper = await postOrder(`tamper-price-${Date.now()}`, {
          items: {
            arrayValue: {
              values: [makeItem('pergola', 'Pergola', 1)],
            },
          },
          subtotalNok: { integerValue: '1' },
          shippingNok: { integerValue: '99' },
          mvaNok: { integerValue: '20' },
          totalNok: { integerValue: '100' },
        });
        expect(priceTamper.status).toBe(403);

        // 2. Spoofed paid_test on vipps
        const providerSpoof = await postOrder(`tamper-vipps-${Date.now()}`, {
          paymentProvider: { stringValue: 'vipps' },
          paymentStatus: { stringValue: 'paid_test' },
        });
        expect(providerSpoof.status).toBe(403);

        // 3. Whitespace-only phone
        const blankPhone = await postOrder(`tamper-phone-${Date.now()}`, {
          customer: {
            mapValue: {
              fields: {
                name: { stringValue: 'Ola Nordmann' },
                email: { stringValue: 'ola@example.no' },
                phone: { stringValue: '        ' },
              },
            },
          },
        });
        expect(blankPhone.status).toBe(403);
      } finally {
        await fetch(`${fsBase}/products/${extraProd4Id}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${adminToken}` },
        }).catch(() => {});
        await fetch(`${fsBase}/products/${extraProd5Id}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${adminToken}` },
        }).catch(() => {});
      }
    } else {
      testInfo.annotations.push({
        type: 'info',
        description: 'Direct Firestore REST tamper probes run only in E2E_TARGET=emulator mode.',
      });
    }

    // Storefront checkout canonical math check (2x 349 = 698 + 99 = 797, mva = 159)
    await addProductToCartFromCatalog(page, STARTER_PRODUCTS.skobeholder);
    await expect(getCartButton(page)).toContainText(/1/);
    const drawer = await openCartDrawer(page);
    await drawer.getByRole('button', { name: /øk antall/i }).first().click();
    await expect(getCartButton(page)).toContainText(/2/);
    await drawer.getByRole('button', { name: /lukk handlekurv/i }).first().click();

    const { confirmationText } = await submitOrderAndReadConfirmation(page, 'test_order');
    const summary = extractAndAssertOrderMath(confirmationText);
    expect(summary.subtotalNok).toBe(698);
    expect(summary.shippingNok).toBe(99);
    expect(summary.totalNok).toBe(797);
    expect(summary.mvaNok).toBe(159);

    monitor.assertClean();
  });

  test('T5-08 Admin Double-Click Concurrency Lock (Deaktiver) & Tablist Keyboard Navigation', async ({
    page,
  }, testInfo) => {
    const monitor = attachRuntimeMonitor(page);
    const adminCreds = await requireAdminCredsOrSkip(testInfo);
    const runId = makeRunId();
    const product = makeAdminTestProduct(runId, {
      title: `TabLock ${runId}`,
    });

    await signInAdmin(page, adminCreds);
    try {
      await createProductViaAdmin(page, product);

      // Keyboard navigation across role="tablist"
      const productsTab = page.getByRole('tab', { name: /produkter/i });
      const ordersTab = page.getByRole('tab', { name: /bestillinger/i });
      const messagesTab = page.getByRole('tab', { name: /henvendelser/i });

      await productsTab.focus();
      await page.keyboard.press('ArrowRight');
      await expect(ordersTab).toHaveAttribute('aria-selected', 'true');
      await expect(ordersTab).toBeFocused();

      await page.keyboard.press('End');
      await expect(messagesTab).toHaveAttribute('aria-selected', 'true');
      await expect(messagesTab).toBeFocused();

      await page.keyboard.press('ArrowLeft');
      await expect(ordersTab).toHaveAttribute('aria-selected', 'true');
      await expect(ordersTab).toBeFocused();

      await page.keyboard.press('Home');
      await expect(productsTab).toHaveAttribute('aria-selected', 'true');
      await expect(productsTab).toBeFocused();

      // Rapid double-click on Deaktiver results in single deterministic toggle -> Deaktivert
      const row = getVisibleAdminProductRows(page, product.title).first();
      await expect(row).toBeVisible();
      await row.getByRole('button', { name: 'Deaktiver' }).dblclick();

      await expect(row).toContainText(/deaktivert/i, { timeout: 15_000 });
    } finally {
      await deleteProductViaAdmin(page, product.title).catch(() => {});
    }

    monitor.assertClean();
  });

  test('T5-09 Layered Overlay Escape Precedence & Focus Restoration (390x844)', async ({
    page,
  }) => {
    const monitor = attachRuntimeMonitor(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');

    // 1. Open AI dialog, then open Mobile Menu -> first Escape closes ONLY Mobile Menu
    await getAiLauncher(page).click();
    const aiPanel = getAiPanel(page);
    await expect(aiPanel).toBeVisible();

    await getMobileMenuButton(page).click();
    const mobileNav = getMobileNavDrawer(page);
    await expect(mobileNav).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(mobileNav).toBeHidden();
    await expect(aiPanel).toBeVisible();
    expect(await page.evaluate(() => document.body.style.overflow)).toBe('');

    // 2. Open CartDrawer while AI dialog is still open -> first Escape closes ONLY CartDrawer
    await getCartButton(page).click();
    const cartDrawer = getCartDrawer(page);
    await expect(cartDrawer).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(cartDrawer).toBeHidden();
    await expect(aiPanel).toBeVisible();
    expect(await page.evaluate(() => document.body.style.overflow)).toBe('');

    // 3. Final Escape closes AI dialog and restores focus to launcher
    await page.keyboard.press('Escape');
    await expect(aiPanel).toBeHidden();
    await expect(getAiLauncher(page)).toBeFocused();

    monitor.assertClean();
  });

  test('T5-10 AI Fault-Injected Input Recovery, Inert XSS Rendering & Admin javascript: Image Defense', async ({
    page,
  }, testInfo) => {
    // 1. Fault-injected AI error restores prompt in input & omits dangling unanswered turn
    await page.route(
      /generativelanguage\.googleapis\.com|firebasevertexai\.googleapis\.com|firebaseailogic/i,
      (route) => route.abort('failed'),
    );

    await page.goto('/');
    await getAiLauncher(page).click();
    const panel = getAiPanel(page);
    const input = getAiInput(panel);

    await input.fill('Hva koster Pergola?');
    await getAiSendButton(panel).click();

    await expect(panel.locator('[role="alert"]').first()).toBeVisible({ timeout: 20_000 });
    await expect(input).toHaveValue('Hva koster Pergola?');

    // XSS attempt in AI input never injects script/img tags or executes window.__xss
    const xssPayload = '<img src=x onerror="window.__xss=1">';
    await input.fill(xssPayload);
    await getAiSendButton(panel).click();
    await expect(panel.locator('[role="alert"]').first()).toBeVisible({ timeout: 20_000 });
    const xssCheck = await page.evaluate(() => ({
      xss: (window as unknown as { __xss?: unknown }).__xss,
      logMediaCount: document.querySelectorAll('[role="log"] script, [role="log"] img').length,
    }));
    expect(xssCheck.xss).toBeUndefined();
    expect(xssCheck.logMediaCount).toBe(0);

    // 2. Admin javascript: imageUrl preview defense
    const adminCreds = await requireAdminCredsOrSkip(testInfo);
    await signInAdmin(page, adminCreds);
    const form = getAdminProductFormFields(page);
    await form.imageUrl.fill('javascript:alert(1)');

    const previewImg = page.locator('img[alt="Forhåndsvisning av produktbilde"]').first();
    await expect(previewImg).toBeVisible();
    await expect(previewImg).toHaveAttribute('src', '/images/products/seveno-default.svg');
    expect(await page.evaluate(() => (window as unknown as { __xss?: unknown }).__xss)).toBeUndefined();
  });
});
