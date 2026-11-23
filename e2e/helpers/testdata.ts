import { expect, type Browser, type Page } from '@playwright/test';
import {
  getAdminConfig,
  getAiPolicy,
  getEmulatorAuthUrl,
  getEmulatorFirestoreUrl,
  getTargetMode,
  type AdminCredentials,
} from './env';
import {
  getAdminLoginFields,
  getAdminProductFormFields,
  getAiInput,
  getAiLauncher,
  getAiPanel,
  getAiSendButton,
  getCheckoutFormFields,
  getPaymentOption,
  getProductCardByTitle,
  getProductLinkByTitle,
  getVisibleAdminProductRows,
  type PaymentProviderChoice,
} from './selectors';

export interface StarterProductSpec {
  key: 'armySekk' | 'skobeholder' | 'pergola';
  title: string;
  slug: string;
  categorySlug: 'seveno-living' | 'seveno-home' | 'seveno-outdoor';
  categoryName: 'Seveno living' | 'Seveno home' | 'Seveno outdoor';
  expectedAssetPart: string;
}

export const STARTER_PRODUCTS: Record<StarterProductSpec['key'], StarterProductSpec> = {
  armySekk: {
    key: 'armySekk',
    title: 'Army sekk',
    slug: 'army-sekk',
    categorySlug: 'seveno-living',
    categoryName: 'Seveno living',
    expectedAssetPart: 'army-sekk',
  },
  skobeholder: {
    key: 'skobeholder',
    title: 'Akryl gjennomsiktig skobeholder',
    slug: 'akryl-gjennomsiktig-skobeholder',
    categorySlug: 'seveno-home',
    categoryName: 'Seveno home',
    expectedAssetPart: 'skobeholder',
  },
  pergola: {
    key: 'pergola',
    title: 'Pergola',
    slug: 'pergola',
    categorySlug: 'seveno-outdoor',
    categoryName: 'Seveno outdoor',
    expectedAssetPart: 'pergola',
  },
};

export interface NorwegianCustomerInput {
  name: string;
  email: string;
  phone: string;
  street: string;
  postalCode: string;
  city: string;
}

export const VALID_NORWEGIAN_CUSTOMER: NorwegianCustomerInput = {
  name: 'Ola Nordmann',
  email: 'ola.nordmann@example.no',
  phone: '+47 912 34 567',
  street: 'Storgata 12',
  postalCode: '0150',
  city: 'Oslo',
};

export const INVALID_POSTAL_CODES = ['015', '01500', 'ABCD', '01-5', ''] as const;

export const INVALID_EMAILS = ['ugyldig', 'test@', '@domene.no', 'ola@localhost'] as const;

export interface AdminTestProductInput {
  title: string;
  categorySlug: 'seveno-living' | 'seveno-home' | 'seveno-outdoor';
  categoryName: 'Seveno living' | 'Seveno home' | 'Seveno outdoor';
  priceNok: number;
  stock: number;
  description: string;
  specs?: string;
  imageUrl?: string;
}

export function makeRunId(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(16).slice(2, 6);
  return `E2E-${ts}-${rand}`;
}

export function makeAdminTestProduct(
  runId: string,
  overrides: Partial<AdminTestProductInput> = {},
): AdminTestProductInput {
  return {
    title: `Nordisk ullpledd ${runId}`,
    categorySlug: 'seveno-living',
    categoryName: 'Seveno living',
    priceNok: 890,
    stock: 12,
    description: 'Vevd nordisk ullpledd i varme naturtoner for stue og oppholdsrom.',
    specs: '100% merinoull, 140x200 cm',
    imageUrl: '',
    ...overrides,
  };
}

export async function fillCheckoutCustomer(
  page: Page,
  customer: NorwegianCustomerInput = VALID_NORWEGIAN_CUSTOMER,
): Promise<void> {
  const fields = getCheckoutFormFields(page);
  await fields.name.fill(customer.name);
  await fields.email.fill(customer.email);
  await fields.phone.fill(customer.phone);
  await fields.street.fill(customer.street);
  await fields.postalCode.fill(customer.postalCode);
  await fields.city.fill(customer.city);
}

export async function ensureEmulatorAdmin(creds: AdminCredentials): Promise<void> {
  if (creds.source !== 'emulator') return;
  const authUrl = getEmulatorAuthUrl();
  const signUpRes = await fetch(
    `${authUrl}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-api-key`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer owner',
      },
      body: JSON.stringify({
        email: creds.email,
        password: creds.password,
        emailVerified: true,
        returnSecureToken: true,
      }),
    },
  );

  let localId: string | undefined;
  if (signUpRes.ok) {
    const body = (await signUpRes.json()) as { localId?: string };
    localId = body.localId;
  } else {
    const signInRes = await fetch(
      `${authUrl}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-api-key`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: creds.email,
          password: creds.password,
          returnSecureToken: true,
        }),
      },
    );
    if (signInRes.ok) {
      const body = (await signInRes.json()) as { localId?: string };
      localId = body.localId;
    }
  }

  if (localId) {
    await fetch(
      `${authUrl}/identitytoolkit.googleapis.com/v1/accounts:update?key=fake-api-key`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer owner',
        },
        body: JSON.stringify({
          localId,
          emailVerified: true,
        }),
      },
    );
  }
}

export async function requireAdminCredsOrSkip(
  testInfo: { skip(condition: boolean, description?: string): void },
): Promise<AdminCredentials> {
  const config = getAdminConfig();
  if (!config.configured) {
    testInfo.skip(true, config.skipReason);
    throw new Error(config.skipReason);
  }
  await ensureEmulatorAdmin(config);
  return config;
}

export async function signInAdmin(page: Page, creds: AdminCredentials): Promise<void> {
  await page.goto('/admin');
  const alreadySignedIn = await page
    .getByRole('button', { name: /opprett produkt|nytt produkt|logg ut/i })
    .first()
    .isVisible()
    .catch(() => false);
  if (alreadySignedIn) return;

  const login = getAdminLoginFields(page);
  await expect(login.email).toBeVisible();
  await login.email.fill(creds.email);
  await login.password.fill(creds.password);
  await login.submit.click();

  await expect(
    page.getByRole('heading', { name: /administrasjon|admin|produkter/i }).first(),
  ).toBeVisible({ timeout: 15_000 });
  await expect(
    page.getByRole('button', { name: /logg ut|opprett produkt|nytt produkt|lagre/i }).first(),
  ).toBeVisible({ timeout: 15_000 });
}

export async function ensureStarterCatalogReady(browser: Browser): Promise<void> {
  if (getTargetMode() !== 'emulator') {
    return;
  }

  const firestoreUrl = getEmulatorFirestoreUrl();
  const listRes = await fetch(
    `${firestoreUrl}/v1/projects/spill-2p-math/databases/(default)/documents/products?pageSize=1`,
    {
      headers: {
        Authorization: 'Bearer owner',
      },
    },
  ).catch(() => null);

  if (listRes && listRes.ok) {
    const body = (await listRes.json().catch(() => null)) as { documents?: unknown[] } | null;
    if (Array.isArray(body?.documents) && body.documents.length > 0) {
      return;
    }
  }

  const creds = getAdminConfig();
  if (!creds.configured) {
    return;
  }

  await ensureEmulatorAdmin(creds);
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await signInAdmin(page, creds);
    await expect(page.locator('main').getByText(/Laster produkter/i)).toBeHidden({
      timeout: 15_000,
    });
    await expect(
      getVisibleAdminProductRows(page, STARTER_PRODUCTS.armySekk.title).first(),
    ).toBeVisible({ timeout: 15_000 });
  } finally {
    await context.close();
  }
}

export async function createProductViaAdmin(
  page: Page,
  product: AdminTestProductInput,
): Promise<void> {
  const openCreateBtn = page.getByRole('button', { name: /nytt produkt|legg til produkt/i }).first();
  if ((await openCreateBtn.count()) > 0 && (await openCreateBtn.isVisible())) {
    const formVisible = await page
      .getByLabel(/produkttittel|tittel|produktnavn/i)
      .first()
      .isVisible()
      .catch(() => false);
    if (!formVisible) {
      await openCreateBtn.click();
    }
  }

  const form = getAdminProductFormFields(page);
  await expect(form.title).toBeVisible();
  await form.title.fill(product.title);

  // Select category by value or label
  const tagName = await form.category.evaluate((el) => el.tagName.toLowerCase());
  if (tagName === 'select') {
    await form.category.selectOption(product.categorySlug).catch(async () => {
      await form.category.selectOption({ label: product.categoryName });
    });
  } else {
    await form.category.click();
    await page.getByRole('option', { name: new RegExp(product.categoryName, 'i') }).first().click();
  }

  await form.price.fill(String(product.priceNok));
  await form.stock.fill(String(product.stock));
  await form.description.fill(product.description);

  if (product.specs !== undefined && (await form.specs.count()) > 0) {
    await form.specs.fill(product.specs);
  }
  if (product.imageUrl !== undefined && (await form.imageUrl.count()) > 0) {
    await form.imageUrl.fill(product.imageUrl);
  }

  await form.submit.click();

  await expect(getVisibleAdminProductRows(page, product.title).first()).toBeVisible({
    timeout: 15_000,
  });
}

export async function deleteProductViaAdmin(page: Page, title: string): Promise<void> {
  await page.goto('/admin');
  await expect(
    page
      .getByRole('button', { name: /opprett produkt|nytt produkt|legg til produkt|logg ut/i })
      .first(),
  ).toBeVisible({ timeout: 15_000 });
  await page
    .locator('main')
    .getByRole('button', { name: /slett|rediger/i })
    .locator('visible=true')
    .first()
    .or(page.locator('main').getByText(/ingen produkter/i).first())
    .waitFor({ state: 'visible', timeout: 15_000 })
    .catch(() => {});

  const productRow = getVisibleAdminProductRows(page, title)
    .filter({ has: page.getByRole('button', { name: /slett/i }) })
    .first();

  if ((await productRow.count()) === 0) return;

  page.once('dialog', (dialog) => dialog.accept().catch(() => {}));
  await productRow.getByRole('button', { name: /slett/i }).first().click();

  // Handle in-app confirmation modal if present
  const confirmBtn = page
    .getByRole('dialog')
    .getByRole('button', { name: /bekreft|slett|ja/i })
    .first();
  if ((await confirmBtn.count()) > 0 && (await confirmBtn.isVisible().catch(() => false))) {
    await confirmBtn.click();
  }

  const remainingRows = page
    .locator('main tr, main li, main article')
    .filter({ hasText: title })
    .filter({ has: page.getByRole('button', { name: /slett|rediger/i }) });
  await expect(remainingRows).toHaveCount(0, { timeout: 15_000 });
}

export async function addProductToCartFromCatalog(
  page: Page,
  product: Pick<StarterProductSpec, 'title' | 'categorySlug'>,
): Promise<void> {
  await page.goto(`/kategori/${product.categorySlug}`);
  const card = getProductCardByTitle(page, product.title);
  await expect(card).toBeVisible();

  const cardAddBtn = card.getByRole('button', { name: /legg i handlekurv/i }).first();
  if ((await cardAddBtn.count()) > 0 && (await cardAddBtn.isVisible())) {
    await cardAddBtn.click();
    return;
  }

  await getProductLinkByTitle(page, product.title).click();
  await expect(page).toHaveURL(/\/produkt\//);
  const detailAddBtn = page.getByRole('button', { name: /legg i handlekurv/i }).first();
  await expect(detailAddBtn).toBeEnabled();
  await detailAddBtn.click();
}

export async function submitOrderAndReadConfirmation(
  page: Page,
  provider: PaymentProviderChoice,
  customer: NorwegianCustomerInput = VALID_NORWEGIAN_CUSTOMER,
): Promise<{ orderNumber: string; confirmationText: string }> {
  await page.goto('/utsjekk');
  await fillCheckoutCustomer(page, customer);

  const option = getPaymentOption(page, provider);
  await expect(option).toBeVisible();
  await option.click();

  const fields = getCheckoutFormFields(page);
  await expect(fields.submit).toBeEnabled();
  await fields.submit.click();

  const heading = page
    .getByRole('heading', { name: /ordrebekreftelse|takk for din bestilling/i })
    .first();
  await expect(heading).toBeVisible({ timeout: 20_000 });

  const mainText = (await page.locator('main').innerText()) || '';
  const match = mainText.match(/SEV-\d{4}-[A-Z0-9]{4}/);
  expect(match, `Expected SEV-YYYY-XXXX order number in confirmation: ${mainText}`).not.toBeNull();
  return {
    orderNumber: match![0],
    confirmationText: mainText,
  };
}

export async function applyAiAppCheckDebugToken(page: Page): Promise<void> {
  const { appCheckDebugToken } = getAiPolicy();
  if (!appCheckDebugToken) return;
  await page.addInitScript((token: string) => {
    (window as unknown as Record<string, unknown>).FIREBASE_APPCHECK_DEBUG_TOKEN = token;
  }, appCheckDebugToken);
}

interface AiPanelSnapshot {
  alertText: string;
  isLoading: boolean;
  logMessages: string[];
  panelText: string;
}

async function readAiPanelSnapshot(panel: ReturnType<typeof getAiPanel>): Promise<AiPanelSnapshot> {
  return panel.evaluate((panelEl) => {
    const isElementVisible = (el: Element | null): el is HTMLElement => {
      if (!el || !(el instanceof HTMLElement)) return false;
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
      return el.getClientRects().length > 0;
    };

    const alertEl = panelEl.querySelector('[role="alert"]');
    const alertText = isElementVisible(alertEl)
      ? (alertEl.innerText || alertEl.textContent || '').trim()
      : '';

    const statusEl = panelEl.querySelector('[role="status"]');
    const isLoading = isElementVisible(statusEl);

    const logEl = panelEl.querySelector('[role="log"]');
    const logMessages: string[] = [];
    if (logEl) {
      for (const child of Array.from(logEl.children)) {
        const role = child.getAttribute('role');
        if (role === 'status' || role === 'alert') continue;
        if (child.tagName === 'BUTTON' || child.querySelector('button')) continue;
        if (child.querySelector('[role="status"], [role="alert"]')) continue;
        const text = (
          (child instanceof HTMLElement ? child.innerText : child.textContent) || ''
        ).trim();
        if (!text) continue;
        logMessages.push(text);
      }
    }

    const panelText = (
      (panelEl instanceof HTMLElement ? panelEl.innerText : panelEl.textContent) || ''
    ).trim();

    return { alertText, isLoading, logMessages, panelText };
  });
}

export async function askAiAssistant(
  page: Page,
  prompt: string,
): Promise<{ panelTextBefore: string; panelTextAfter: string; replyDelta: string }> {
  const policy = getAiPolicy();
  const panel = getAiPanel(page);

  if (!(await panel.isVisible().catch(() => false))) {
    const launcher = getAiLauncher(page);
    await expect(launcher).toBeVisible();
    await launcher.click();
    await expect(panel).toBeVisible();
  }

  const input = getAiInput(panel);
  await expect(input).toBeVisible();
  const beforeSnapshot = await readAiPanelSnapshot(panel);
  const panelTextBefore = beforeSnapshot.panelText;

  await input.fill(prompt);
  const sendBtn = getAiSendButton(panel);
  await expect(sendBtn).toBeEnabled();
  await sendBtn.click();

  // Atomically inspect [role="alert"], [role="status"], and [role="log"] message bubbles
  let alertError: string | null = null;
  let settledSnapshot: AiPanelSnapshot | null = null;
  let settledReply = '';
  const trimmedPrompt = prompt.trim();

  await expect
    .poll(
      async () => {
        alertError = null;
        settledSnapshot = null;
        settledReply = '';

        const snapshot = await readAiPanelSnapshot(panel);
        if (snapshot.alertText) {
          alertError = snapshot.alertText;
          return 'done';
        }
        if (snapshot.isLoading) {
          return 'waiting';
        }

        const newMessages = snapshot.logMessages.slice(beforeSnapshot.logMessages.length);
        if (newMessages.length < 2) {
          return 'waiting';
        }

        const userIdx = newMessages.findIndex(
          (msg) =>
            msg === trimmedPrompt || (trimmedPrompt.length > 0 && msg.includes(trimmedPrompt)),
        );
        const assistantReplies = (
          userIdx >= 0 ? newMessages.slice(userIdx + 1) : newMessages.slice(1)
        )
          .map((m) => m.trim())
          .filter(Boolean);

        if (assistantReplies.length === 0) {
          return 'waiting';
        }

        const replyText = assistantReplies.join('\n').trim();
        if (!replyText || /^(?:skriver|tenker|laster|sender)\.{0,3}$/i.test(replyText)) {
          return 'waiting';
        }

        settledSnapshot = snapshot;
        settledReply = replyText;
        return 'done';
      },
      {
        timeout: policy.responseTimeoutMs,
        message: `Timed out waiting for AI assistant response to "${prompt}"`,
      },
    )
    .toBe('done');

  expect(
    alertError,
    `AI assistant rendered an error alert for "${prompt}": ${alertError ?? ''}`,
  ).toBeNull();

  const panelTextAfter = (settledSnapshot as AiPanelSnapshot | null)?.panelText ?? panelTextBefore;
  return {
    panelTextBefore,
    panelTextAfter,
    replyDelta: settledReply,
  };
}


