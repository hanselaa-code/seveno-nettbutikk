import { expect, type Page } from '@playwright/test';

export interface RuntimeMonitor {
  pageErrors: string[];
  consoleErrors: string[];
  serverErrors: Array<{ url: string; status: number }>;
  reset(): void;
  assertClean(options?: {
    allowConsoleErrors?: boolean;
    allowServerErrors?: boolean;
  }): void;
}

export function attachRuntimeMonitor(page: Page): RuntimeMonitor {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  const serverErrors: Array<{ url: string; status: number }> = [];

  page.on('pageerror', (err) => {
    pageErrors.push(err.message || String(err));
  });

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
    }
  });

  page.on('response', (res) => {
    if (res.status() >= 500) {
      serverErrors.push({ url: res.url(), status: res.status() });
    }
  });

  return {
    pageErrors,
    consoleErrors,
    serverErrors,
    reset() {
      pageErrors.length = 0;
      consoleErrors.length = 0;
      serverErrors.length = 0;
    },
    assertClean(options = {}) {
      expect(pageErrors, `Uncaught pageerrors detected: ${pageErrors.join(' | ')}`).toEqual([]);
      if (!options.allowConsoleErrors) {
        expect(
          consoleErrors,
          `Console errors detected: ${consoleErrors.join(' | ')}`,
        ).toEqual([]);
      }
      if (!options.allowServerErrors) {
        expect(
          serverErrors,
          `HTTP >=500 responses detected: ${JSON.stringify(serverErrors)}`,
        ).toEqual([]);
      }
    },
  };
}

export async function expectHealthyLogoAndImages(page: Page): Promise<void> {
  const header = page.getByRole('banner').first();
  await expect(header).toBeVisible();

  const headerBox = await header.boundingBox();
  expect(headerBox, 'Header bounding box should exist').not.toBeNull();
  if (headerBox) {
    expect(
      headerBox.height,
      `Header height (${headerBox.height}px) should stay framed cleanly (<= 112px)`,
    ).toBeLessThanOrEqual(112);
  }

  const logoImg = header.locator('img').first();
  await expect(logoImg).toBeVisible();
  await expect
    .poll(
      async () =>
        logoImg.evaluate((el) => {
          const img = el as HTMLImageElement;
          return img.complete && img.naturalWidth > 0 && img.naturalHeight > 0;
        }),
      { message: 'Header Seveno logo image must load with naturalWidth > 0' },
    )
    .toBe(true);

  let lastImageReport: Array<{
    src: string;
    alt: string;
    complete: boolean;
    naturalWidth: number;
  }> = [];

  await expect
    .poll(
      async () => {
        lastImageReport = await page.evaluate(() => {
          const imgs = Array.from(document.querySelectorAll('img'));
          return imgs
            .filter((img) => {
              const rect = img.getBoundingClientRect();
              const style = getComputedStyle(img);
              return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0;
            })
            .map((img) => ({
              src: img.currentSrc || img.getAttribute('src') || '',
              alt: img.alt,
              complete: img.complete,
              naturalWidth: img.naturalWidth,
            }));
        });
        return (
          lastImageReport.length > 0 &&
          lastImageReport.every((img) => img.complete && img.naturalWidth > 0)
        );
      },
      {
        message: 'All visible images must finish loading with naturalWidth > 0',
      },
    )
    .toBe(true);

  expect(lastImageReport.length, 'At least one visible image (logo) should exist').toBeGreaterThan(
    0,
  );
  for (const img of lastImageReport) {
    expect(
      img.complete && img.naturalWidth > 0,
      `Broken visible image detected: src=${img.src} alt=${img.alt}`,
    ).toBe(true);
  }
}

export async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => {
    const header = document.querySelector('header');
    const headerOverflow = header
      ? {
          scrollWidth: header.scrollWidth,
          clientWidth: header.clientWidth,
        }
      : null;

    const clippedHeaderControls = header
      ? Array.from(header.querySelectorAll('a, button'))
          .filter((el) => {
            const rect = el.getBoundingClientRect();
            const style = getComputedStyle(el);
            return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0;
          })
          .map((el) => {
            const rect = el.getBoundingClientRect();
            return {
              label: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 40),
              left: rect.left,
              right: rect.right,
            };
          })
          .filter((item) => item.left < -1 || item.right > window.innerWidth + 1)
      : [];

    return {
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      innerWidth: window.innerWidth,
      headerOverflow,
      clippedHeaderControls,
    };
  });

  expect(
    overflow.scrollWidth,
    `Horizontal overflow: scrollWidth=${overflow.scrollWidth} > clientWidth=${overflow.clientWidth}`,
  ).toBeLessThanOrEqual(overflow.clientWidth + 1);

  if (overflow.headerOverflow) {
    expect(
      overflow.headerOverflow.scrollWidth,
      `Header horizontal overflow: scrollWidth=${overflow.headerOverflow.scrollWidth} > clientWidth=${overflow.headerOverflow.clientWidth}`,
    ).toBeLessThanOrEqual(overflow.headerOverflow.clientWidth + 1);
  }

  expect(
    overflow.clippedHeaderControls,
    `Visible header controls clipped outside viewport (0..${overflow.innerWidth}): ${JSON.stringify(overflow.clippedHeaderControls)}`,
  ).toEqual([]);
}

interface RgbaColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

function parseCssColor(raw: string): RgbaColor | null {
  const match = raw.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)/i);
  if (!match) return null;
  return {
    r: Number(match[1]),
    g: Number(match[2]),
    b: Number(match[3]),
    a: match[4] !== undefined ? Number(match[4]) : 1,
  };
}

function compositeOver(fg: RgbaColor, bg: RgbaColor): RgbaColor {
  const a = fg.a;
  return {
    r: Math.round(fg.r * a + bg.r * (1 - a)),
    g: Math.round(fg.g * a + bg.g * (1 - a)),
    b: Math.round(fg.b * a + bg.b * (1 - a)),
    a: 1,
  };
}

function relativeLuminance(c: RgbaColor): number {
  const toLinear = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * toLinear(c.r) + 0.7152 * toLinear(c.g) + 0.0722 * toLinear(c.b);
}

export function computeContrastRatio(fgRaw: string, bgRaw: string): number | null {
  const fg = parseCssColor(fgRaw);
  const bg = parseCssColor(bgRaw);
  if (!fg || !bg) return null;
  const effectiveFg = fg.a < 1 ? compositeOver(fg, bg) : fg;
  const l1 = relativeLuminance(effectiveFg);
  const l2 = relativeLuminance(bg);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

export async function expectBrandPaletteAndWcagContrast(page: Page): Promise<void> {
  await expect(page.locator('html')).toHaveAttribute('lang', /^nb/i);

  const audit = await page.evaluate(() => {
    const parse = (raw: string) => {
      const m = raw.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)/i);
      if (!m) return null;
      return { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]), a: m[4] !== undefined ? Number(m[4]) : 1 };
    };
    const composite = (fg: { r: number; g: number; b: number; a: number }, bg: { r: number; g: number; b: number; a: number }) => ({
      r: Math.round(fg.r * fg.a + bg.r * (1 - fg.a)),
      g: Math.round(fg.g * fg.a + bg.g * (1 - fg.a)),
      b: Math.round(fg.b * fg.a + bg.b * (1 - fg.a)),
      a: 1,
    });
    const effectiveBg = (el: Element): { r: number; g: number; b: number; a: number } => {
      const layers: Array<{ r: number; g: number; b: number; a: number }> = [];
      let cur: Element | null = el;
      while (cur) {
        const c = parse(getComputedStyle(cur).backgroundColor);
        if (c && c.a > 0) {
          layers.unshift(c);
          if (c.a >= 0.99) break;
        }
        cur = cur.parentElement;
      }
      let acc = { r: 254, g: 254, b: 252, a: 1 };
      for (const layer of layers) {
        acc = layer.a >= 0.99 ? { ...layer, a: 1 } : composite(layer, acc);
      }
      return acc;
    };

    const bodyBg = effectiveBg(document.body);
    const selectors = ['h1', 'h2', 'p', 'header nav a', 'main a button, main button, main a[href^="/kategori/"]'];
    const samples: Array<{
      tag: string;
      text: string;
      fg: string;
      bg: string;
      fontSize: number;
      fontWeight: number;
      fontFamily: string;
    }> = [];

    for (const sel of selectors) {
      const nodes = Array.from(document.querySelectorAll(sel)).slice(0, 5);
      for (const el of nodes) {
        const rect = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        const text = (el.textContent || '').trim().slice(0, 40);
        if (!text || rect.width === 0 || rect.height === 0 || style.visibility === 'hidden') continue;
        const bg = effectiveBg(el);
        samples.push({
          tag: el.tagName.toLowerCase(),
          text,
          fg: style.color,
          bg: `rgb(${bg.r}, ${bg.g}, ${bg.b})`,
          fontSize: parseFloat(style.fontSize) || 16,
          fontWeight: parseInt(style.fontWeight, 10) || 400,
          fontFamily: style.fontFamily,
        });
      }
    }

    return { bodyBg, samples };
  });

  // Warm ivory/white Nordic canvas (avoid dark mode or stark cold grey)
  expect(audit.bodyBg.r, `Expected warm light canvas R >= 230, got ${JSON.stringify(audit.bodyBg)}`).toBeGreaterThanOrEqual(230);
  expect(audit.bodyBg.g, `Expected warm light canvas G >= 225, got ${JSON.stringify(audit.bodyBg)}`).toBeGreaterThanOrEqual(225);
  expect(audit.bodyBg.b, `Expected warm light canvas B >= 210, got ${JSON.stringify(audit.bodyBg)}`).toBeGreaterThanOrEqual(210);
  expect(audit.bodyBg.r).toBeGreaterThanOrEqual(audit.bodyBg.b);

  expect(audit.samples.length, 'Expected visible text samples for contrast check').toBeGreaterThan(0);
  for (const sample of audit.samples) {
    const ratio = computeContrastRatio(sample.fg, sample.bg);
    expect(ratio, `Could not parse colors for ${sample.tag} "${sample.text}"`).not.toBeNull();
    const isLarge = sample.fontSize >= 24 || (sample.fontSize >= 18.66 && sample.fontWeight >= 700);
    const minRatio = isLarge ? 3.0 : 4.5;
    expect(
      ratio!,
      `WCAG AA contrast failure on <${sample.tag}> "${sample.text}" (${sample.fg} on ${sample.bg}): ${ratio!.toFixed(2)} < ${minRatio}`,
    ).toBeGreaterThanOrEqual(minRatio);
  }
}

export const NOK_TOKEN_REGEX = /\d[\d\s\u00a0\u202f.]*(?:,\d{1,2}|,-)?\s*kr/i;

export function parseNok(text: string): number {
  const cleaned = text
    .replace(/[\u00A0\u202F\s]/g, '')
    .replace(/NOK/gi, '')
    .replace(/kr/gi, '')
    .replace(/,-/g, '')
    .replace(/(?<=\d)\.(?=\d{3}(?:\D|$))/g, '')
    .replace(/,(\d{1,2})(?=\D|$)/g, '.$1');
  const match = cleaned.match(/-?\d+(?:\.\d+)?/);
  if (!match) {
    throw new Error(`Could not parse NOK amount from: ${JSON.stringify(text)}`);
  }
  const value = Math.round(Number(match[0]));
  if (!Number.isFinite(value)) {
    throw new Error(`Parsed non-finite NOK amount from: ${JSON.stringify(text)}`);
  }
  return value;
}

export function extractNokAmount(text: string): number {
  const match = text.match(NOK_TOKEN_REGEX);
  if (!match) {
    throw new Error(`Could not find NOK price token in: ${JSON.stringify(text.slice(0, 200))}`);
  }
  return parseNok(match[0]);
}

export interface OrderSummaryNumbers {
  subtotalNok: number;
  shippingNok: number;
  mvaNok: number;
  totalNok: number;
}

export function extractOrderSummaryNumbers(text: string): OrderSummaryNumbers {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const findLineMatch = (labelRegex: RegExp, valueRegex: RegExp, excludeLabelRegex?: RegExp): string | null => {
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      if (!labelRegex.test(line)) continue;
      if (excludeLabelRegex && excludeLabelRegex.test(line)) continue;

      const combined = new RegExp(valueRegex.source, 'gi');
      const sameLineMatches = Array.from(line.matchAll(combined));
      if (sameLineMatches.length > 0) {
        return sameLineMatches[sameLineMatches.length - 1][0];
      }
      if (i + 1 < lines.length) {
        const nextMatches = Array.from(lines[i + 1].matchAll(combined));
        if (nextMatches.length > 0) {
          return nextMatches[nextMatches.length - 1][0];
        }
      }
    }
    return null;
  };

  const amountPattern = /\d[\d\s\u00a0\u202f.]*(?:,\d{1,2}|,-)?\s*kr/;
  const shippingTokenPattern = /\bgratis\b|\d[\d\s\u00a0\u202f.]*(?:,\d{1,2}|,-)?\s*kr/;

  const subtotalToken = findLineMatch(/\b(?:delsum|subtotal)\b/i, amountPattern);
  const shippingToken =
    findLineMatch(/^\s*frakt(?:\s*:|\s|$|\t)/i, shippingTokenPattern) ??
    findLineMatch(
      /\bfrakt\b/i,
      shippingTokenPattern,
      /\bhandle\s+for\b|mer\s+for\s+gratis\s+frakt|\bgratis\s+frakt\b.*(?:over|fra|ved)\b|^\s*gratis\s+frakt\s*$/i,
    );
  const mvaToken = findLineMatch(/(?:herav\s+)?\b(?:mva|merverdiavgift)\b/i, amountPattern);
  const totalToken = findLineMatch(
    /\b(?:totalt|totalpris|sum\s*å\s*betale|å\s*betale|total)\b/i,
    amountPattern,
    /\b(?:delsum|subtotal)\b/i,
  );

  const missing: string[] = [];
  if (!subtotalToken) missing.push('subtotal (Delsum/Subtotal)');
  if (!shippingToken) missing.push('shipping (Frakt)');
  if (!mvaToken) missing.push('mva (MVA / Herav MVA (25%))');
  if (!totalToken) missing.push('total (Totalt)');

  if (missing.length > 0) {
    throw new Error(
      `Missing required order summary field(s): ${missing.join(', ')}. Text snippet: ${JSON.stringify(text.slice(0, 500))}`,
    );
  }

  return {
    subtotalNok: parseNok(subtotalToken!),
    shippingNok: /gratis/i.test(shippingToken!) ? 0 : parseNok(shippingToken!),
    mvaNok: parseNok(mvaToken!),
    totalNok: parseNok(totalToken!),
  };
}

export function extractAndAssertOrderMath(text: string): OrderSummaryNumbers {
  const totals = extractOrderSummaryNumbers(text);
  expectOrderMathConsistent(totals);
  return totals;
}

export function expectOrderMathConsistent(totals: {
  subtotalNok: number;
  shippingNok: number;
  mvaNok: number;
  totalNok: number;
}): void {
  const { subtotalNok, shippingNok, mvaNok, totalNok } = totals;
  expect(subtotalNok).toBeGreaterThan(0);
  expect(shippingNok).toBeGreaterThanOrEqual(0);
  expect(totalNok).toBe(subtotalNok + shippingNok);

  const expectedMvaOnTotal = Math.round(totalNok * 0.2);
  const expectedMvaOnSubtotal = Math.round(subtotalNok * 0.2);
  const mvaMatchesTotal = Math.abs(mvaNok - expectedMvaOnTotal) <= 1;
  const mvaMatchesSubtotal = Math.abs(mvaNok - expectedMvaOnSubtotal) <= 1;
  expect(
    mvaMatchesTotal || mvaMatchesSubtotal,
    `25% MVA mismatch: mva=${mvaNok}, expected ~${expectedMvaOnTotal} (of total ${totalNok}) or ~${expectedMvaOnSubtotal} (of subtotal ${subtotalNok})`,
  ).toBe(true);
}

export function expectNoLeakedSecrets(payloads: Array<{ source: string; content: string }>): void {
  const forbiddenPatterns: Array<{ name: string; regex: RegExp }> = [
    { name: 'Private Key PEM', regex: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
    { name: 'Klarna API Secret', regex: /KLARNA_API_PASSWORD\s*[:=]\s*["'`][^"'`]{6,}["'`]/i },
    { name: 'Vipps Client Secret', regex: /VIPPS_CLIENT_SECRET\s*[:=]\s*["'`][^"'`]{6,}["'`]/i },
    {
      name: 'Vipps Subscription Key',
      regex: /["'`]?Ocp-Apim-Subscription-Key["'`]?\s*(?:\]\s*)?[:=]\s*["'`][A-Za-z0-9_-]{12,}["'`]/i,
    },
    { name: 'Hardcoded Gemini Key Env', regex: /GEMINI_API_KEY\s*[:=]\s*["'`]AIza[0-9A-Za-z_-]{20,}["'`]/i },
    { name: 'Stripe/OpenAI style live key', regex: /\bsk[-_](?:live|proj)-[A-Za-z0-9_-]{16,}\b/ },
  ];

  for (const item of payloads) {
    for (const pattern of forbiddenPatterns) {
      expect(
        pattern.regex.test(item.content),
        `Potential secret leak (${pattern.name}) found in ${item.source}`,
      ).toBe(false);
    }

    // Distinguish legitimate public Firebase Web apiKey from standalone leaked Google API keys
    const aizaMatches = item.content.matchAll(/AIza[0-9A-Za-z_-]{30,}/g);
    for (const m of aizaMatches) {
      const idx = m.index ?? 0;
      const immediatePrefix = item.content.slice(Math.max(0, idx - 40), idx);
      const isGeminiAssignment = /(?:gemini[a-z0-9_]*|GEMINI_API_KEY)\s*(?:\]\s*)?[:=]\s*["'`]?$/i.test(
        immediatePrefix,
      );
      const localWindow = item.content.slice(Math.max(0, idx - 25), idx + 10);
      const configWindow = item.content.slice(Math.max(0, idx - 200), idx + 80);
      const isFirebaseWebConfig =
        !isGeminiAssignment &&
        (/(?:["'`]?apiKey["'`]?\s*[:=]\s*["'`]AIza)/i.test(localWindow) ||
          (/firebaseConfig[\s\S]{0,200}apiKey/i.test(configWindow) &&
            /["'`]?apiKey["'`]?\s*[:=]\s*["'`]?$/i.test(immediatePrefix)));
      expect(
        isFirebaseWebConfig,
        `Non-Firebase Google API key (AIza...) detected outside firebaseConfig in ${item.source}`,
      ).toBe(true);
    }
  }
}
