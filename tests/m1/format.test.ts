import { describe, expect, it } from 'vitest';
import {
  FREE_SHIPPING_THRESHOLD_NOK,
  STANDARD_SHIPPING_NOK,
  calculateIncludedMva,
  calculateShippingNok,
  formatNok,
  generateOrderNumber,
  slugify,
} from '../../src/lib/format';

describe('format helpers (M1)', () => {
  describe('formatNok', () => {
    it('formats amounts with regular ASCII space thousands separator and kr suffix', () => {
      expect(formatNok(0)).toBe('0 kr');
      expect(formatNok(349)).toBe('349 kr');
      expect(formatNok(1890)).toBe('1 890 kr');
      expect(formatNok(24900)).toBe('24 900 kr');
      expect(formatNok(1000000)).toBe('1 000 000 kr');
      // Verify regular ASCII space (U+0020), not non-breaking space (U+00A0)
      expect(formatNok(1890)).not.toContain('\u00A0');
    });

    it('rounds decimals and handles non-finite or negative values safely', () => {
      expect(formatNok(1890.6)).toBe('1 891 kr');
      expect(formatNok(-0)).toBe('0 kr');
      expect(formatNok(-250)).toBe('-250 kr');
      expect(formatNok(Number.NaN)).toBe('0 kr');
      expect(formatNok(Number.POSITIVE_INFINITY)).toBe('0 kr');
    });
  });

  describe('calculateIncludedMva', () => {
    it('calculates 25% included Norwegian MVA (20% of VAT-inclusive total)', () => {
      expect(calculateIncludedMva(1000)).toBe(200);
      expect(calculateIncludedMva(1890)).toBe(378);
      expect(calculateIncludedMva(349)).toBe(70);
      expect(calculateIncludedMva(0)).toBe(0);
      expect(calculateIncludedMva(-500)).toBe(0);
      expect(calculateIncludedMva(Number.NaN)).toBe(0);
    });
  });

  describe('calculateShippingNok', () => {
    it('applies standard shipping below threshold and free shipping at or above 1500 kr', () => {
      expect(calculateShippingNok(0)).toBe(0);
      expect(calculateShippingNok(-100)).toBe(0);
      expect(calculateShippingNok(349)).toBe(STANDARD_SHIPPING_NOK);
      expect(calculateShippingNok(FREE_SHIPPING_THRESHOLD_NOK - 1)).toBe(STANDARD_SHIPPING_NOK);
      expect(calculateShippingNok(FREE_SHIPPING_THRESHOLD_NOK)).toBe(0);
      expect(calculateShippingNok(1890)).toBe(0);
      expect(calculateShippingNok(24900)).toBe(0);
    });
  });

  describe('slugify', () => {
    it('transliterates Norwegian characters and strips punctuation', () => {
      expect(slugify('Army sekk')).toBe('army-sekk');
      expect(slugify('Akryl gjennomsiktig skobeholder')).toBe('akryl-gjennomsiktig-skobeholder');
      expect(slugify('Blåbær & Øl Ære')).toBe('blabaer-ol-aere');
      expect(slugify('  Fjell-telt (2026)!  ')).toBe('fjell-telt-2026');
      expect(slugify('   ')).toBe('');
    });
  });

  describe('generateOrderNumber', () => {
    it('matches SEV-YYYY-XXXXXXXX format, uses provided UTC year, and generates 500 unique values', () => {
      const fixedDate = new Date('2026-06-15T12:00:00Z');
      const orderNum = generateOrderNumber(fixedDate);
      expect(orderNum).toMatch(/^SEV-2026-[A-Z0-9]{8}$/);

      const samples = Array.from({ length: 500 }, () => generateOrderNumber(fixedDate));
      for (const sample of samples) {
        expect(sample).toMatch(/^SEV-2026-[A-Z0-9]{8}$/);
      }
      expect(new Set(samples).size).toBe(500);
    });
  });
});
