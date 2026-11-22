export const FREE_SHIPPING_THRESHOLD_NOK = 1500;
export const STANDARD_SHIPPING_NOK = 99;
export const NORWEGIAN_VAT_RATE = 0.25;

const ORDER_NUMBER_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/**
 * Formats an amount in NOK using deterministic ASCII space thousand separators
 * (e.g. `formatNok(1890) === '1 890 kr'`).
 */
export function formatNok(amountNok: number): string {
  if (!Number.isFinite(amountNok)) {
    return '0 kr';
  }
  const rounded = Math.round(amountNok) || 0;
  const isNegative = rounded < 0;
  const absDigits = Math.abs(rounded)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${isNegative ? '-' : ''}${absDigits} kr`;
}

/**
 * Calculates the 25% Norwegian MVA already included in a VAT-inclusive NOK total:
 * `total * (0.25 / 1.25) = total * 0.2`.
 */
export function calculateIncludedMva(totalNok: number): number {
  if (!Number.isFinite(totalNok) || totalNok <= 0) {
    return 0;
  }
  return Math.round(totalNok * (NORWEGIAN_VAT_RATE / (1 + NORWEGIAN_VAT_RATE)));
}

/**
 * Calculates shipping in NOK: free shipping at or above 1 500 kr, otherwise 99 kr.
 */
export function calculateShippingNok(subtotalNok: number): number {
  if (!Number.isFinite(subtotalNok) || subtotalNok <= 0) {
    return 0;
  }
  return subtotalNok >= FREE_SHIPPING_THRESHOLD_NOK ? 0 : STANDARD_SHIPPING_NOK;
}

/**
 * Converts arbitrary Norwegian text into a lowercase kebab-case URL slug.
 */
export function slugify(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/æ/g, 'ae')
    .replace(/ø/g, 'o')
    .replace(/å/g, 'a')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Generates an order number of format `SEV-YYYY-XXXXXXXX` (8 random chars).
 */
export function generateOrderNumber(date: Date = new Date()): string {
  const year = date.getUTCFullYear();
  let suffix = '';

  if (typeof globalThis.crypto !== 'undefined' && typeof globalThis.crypto.getRandomValues === 'function') {
    const bytes = new Uint8Array(8);
    globalThis.crypto.getRandomValues(bytes);
    for (const byte of bytes) {
      suffix += ORDER_NUMBER_ALPHABET[byte % ORDER_NUMBER_ALPHABET.length];
    }
  } else {
    for (let i = 0; i < 8; i += 1) {
      const idx = Math.floor(Math.random() * ORDER_NUMBER_ALPHABET.length);
      suffix += ORDER_NUMBER_ALPHABET[idx];
    }
  }

  return `SEV-${year}-${suffix}`;
}
