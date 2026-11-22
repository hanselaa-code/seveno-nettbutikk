import { describe, expect, it } from 'vitest';
import {
  isCategorySlug,
  isPaymentProviderId,
  isValidEmail,
  isValidImageUrl,
  isValidNorwegianPhone,
  isValidNorwegianPostalCode,
  validateContactMessageInput,
  validateOrderInput,
  validateProductInput,
} from '../../src/lib/validators';
import { DEFAULT_PRODUCT_IMAGE } from '../../src/types/domain';

describe('validators (M1)', () => {
  describe('primitive validators', () => {
    it('validates CategorySlug and PaymentProviderId', () => {
      expect(isCategorySlug('seveno-living')).toBe(true);
      expect(isCategorySlug('seveno-home')).toBe(true);
      expect(isCategorySlug('seveno-outdoor')).toBe(true);
      expect(isCategorySlug('seveno-unknown')).toBe(false);

      expect(isPaymentProviderId('test_order')).toBe(true);
      expect(isPaymentProviderId('klarna')).toBe(true);
      expect(isPaymentProviderId('vipps')).toBe(true);
      expect(isPaymentProviderId('stripe')).toBe(false);
    });

    it('validates email addresses', () => {
      expect(isValidEmail('ola.nordmann@example.no')).toBe(true);
      expect(isValidEmail('a@b.co')).toBe(true);
      expect(isValidEmail('bad..email@example.no')).toBe(false);
      expect(isValidEmail('not-an-email')).toBe(false);
      expect(isValidEmail('')).toBe(false);
    });

    it('validates 4-digit Norwegian postal codes', () => {
      expect(isValidNorwegianPostalCode('0150')).toBe(true);
      expect(isValidNorwegianPostalCode(' 5003 ')).toBe(true);
      expect(isValidNorwegianPostalCode('123')).toBe(false);
      expect(isValidNorwegianPostalCode('12345')).toBe(false);
      expect(isValidNorwegianPostalCode('01AB')).toBe(false);
    });

    it('validates Norwegian phone numbers', () => {
      expect(isValidNorwegianPhone('91234567')).toBe(true);
      expect(isValidNorwegianPhone('912 34 567')).toBe(true);
      expect(isValidNorwegianPhone('+47 912 34 567')).toBe(true);
      expect(isValidNorwegianPhone('004791234567')).toBe(true);
      expect(isValidNorwegianPhone('1234567')).toBe(false);
      expect(isValidNorwegianPhone('abcdefgh')).toBe(false);
    });

    it('allows safe local /images/ or https:// URLs and blocks unsafe schemes/traversal', () => {
      expect(isValidImageUrl('/images/products/army-sekk.svg')).toBe(true);
      expect(isValidImageUrl('/images/seveno-logo.jpg')).toBe(true);
      expect(isValidImageUrl('https://cdn.example.no/img.webp')).toBe(true);

      expect(isValidImageUrl('javascript:alert(1)')).toBe(false);
      expect(isValidImageUrl('data:image/svg+xml,<svg/>')).toBe(false);
      expect(isValidImageUrl('http://insecure.example.com/a.jpg')).toBe(false);
      expect(isValidImageUrl('//evil.example.com/a.jpg')).toBe(false);
      expect(isValidImageUrl('/images/../secret.svg')).toBe(false);
      expect(isValidImageUrl('/images/products/bad.txt')).toBe(false);
    });
  });

  describe('validateProductInput', () => {
    it('normalizes valid input and applies default image fallback when omitted', () => {
      const res = validateProductInput({
        title: '  Nordisk ullpledd  ',
        categorySlug: 'seveno-home',
        description: 'Mykt ullpledd vevd i 100 % ren ny ull for lune kvelder.',
        priceNok: 1290,
        stock: 10,
        specs: ['  Mål: 130 × 200 cm  '],
      });

      expect(res.valid).toBe(true);
      expect(res.value).toEqual({
        slug: 'nordisk-ullpledd',
        title: 'Nordisk ullpledd',
        categorySlug: 'seveno-home',
        description: 'Mykt ullpledd vevd i 100 % ren ny ull for lune kvelder.',
        priceNok: 1290,
        stock: 10,
        imageUrl: DEFAULT_PRODUCT_IMAGE,
        specs: ['Mål: 130 × 200 cm'],
        active: true,
      });
    });

    it('rejects invalid price, negative/non-integer stock, short title/description, and >20 specs', () => {
      const res = validateProductInput({
        title: 'A',
        categorySlug: 'invalid' as 'seveno-living',
        description: 'Kort',
        priceNok: 0,
        stock: -1.5,
        imageUrl: 'http://bad.com/a.png',
        specs: Array.from({ length: 21 }, (_, i) => `Spec ${i}`),
      });

      expect(res.valid).toBe(false);
      expect(res.errors.title).toBeDefined();
      expect(res.errors.categorySlug).toBeDefined();
      expect(res.errors.description).toBeDefined();
      expect(res.errors.priceNok).toBeDefined();
      expect(res.errors.stock).toBeDefined();
      expect(res.errors.imageUrl).toBeDefined();
      expect(res.errors.specs).toBeDefined();
    });
  });

  describe('validateOrderInput', () => {
    it('accepts a valid Norwegian order and rejects invalid postal code, items, and provider', () => {
      const valid = validateOrderInput({
        ownerUid: 'anon-123',
        customer: {
          name: 'Kari Nordmann',
          email: 'kari@example.no',
          phone: '+47 912 34 567',
        },
        shippingAddress: {
          street: 'Karl Johans gate 12',
          postalCode: '0154',
          city: 'Oslo',
        },
        items: [{ productId: 'army-sekk', quantity: 2 }],
        paymentProvider: 'vipps',
      });
      expect(valid.valid).toBe(true);

      const invalid = validateOrderInput({
        ownerUid: '',
        customer: { name: 'K', email: 'bad', phone: '123' },
        shippingAddress: { street: 'X', postalCode: '015', city: '' },
        items: [],
        paymentProvider: 'crypto' as 'test_order',
      });
      expect(invalid.valid).toBe(false);
      expect(invalid.errors.ownerUid).toBeDefined();
      expect(invalid.errors['customer.name']).toBeDefined();
      expect(invalid.errors['customer.email']).toBeDefined();
      expect(invalid.errors['customer.phone']).toBeDefined();
      expect(invalid.errors['shippingAddress.street']).toBeDefined();
      expect(invalid.errors['shippingAddress.postalCode']).toBeDefined();
      expect(invalid.errors['shippingAddress.city']).toBeDefined();
      expect(invalid.errors.items).toBeDefined();
      expect(invalid.errors.paymentProvider).toBeDefined();
    });

    it('rejects >50 order items or quantity >100', () => {
      const tooMany = validateOrderInput({
        ownerUid: 'u1',
        customer: { name: 'Ola Nordmann', email: 'ola@example.no', phone: '91234567' },
        shippingAddress: { street: 'Storgata 1', postalCode: '0150', city: 'Oslo' },
        items: Array.from({ length: 51 }, (_, i) => ({ productId: `p-${i}`, quantity: 1 })),
        paymentProvider: 'klarna',
      });
      expect(tooMany.valid).toBe(false);
      expect(tooMany.errors.items).toBeDefined();

      const badQty = validateOrderInput({
        ownerUid: 'u1',
        customer: { name: 'Ola Nordmann', email: 'ola@example.no', phone: '91234567' },
        shippingAddress: { street: 'Storgata 1', postalCode: '0150', city: 'Oslo' },
        items: [{ productId: 'army-sekk', quantity: 101 }],
        paymentProvider: 'test_order',
      });
      expect(badQty.valid).toBe(false);
      expect(badQty.errors.items).toBeDefined();
    });

    it('validates paymentReference bounds (3..120), omits empty paymentReference, and restricts paymentStatus on create', () => {
      const baseInput = {
        ownerUid: 'u1',
        customer: { name: 'Ola Nordmann', email: 'ola@example.no', phone: '91234567' },
        shippingAddress: { street: 'Storgata 1', postalCode: '0150', city: 'Oslo' },
        items: [{ productId: 'army-sekk', quantity: 1 }],
        paymentProvider: 'vipps' as const,
      };

      const shortRef = validateOrderInput({ ...baseInput, paymentReference: 'ab' });
      expect(shortRef.valid).toBe(false);
      expect(shortRef.errors.paymentReference).toBeDefined();

      const longRef = validateOrderInput({ ...baseInput, paymentReference: 'x'.repeat(121) });
      expect(longRef.valid).toBe(false);
      expect(longRef.errors.paymentReference).toBeDefined();

      const emptyRef = validateOrderInput({ ...baseInput, paymentReference: '   ' });
      expect(emptyRef.valid).toBe(true);
      expect(emptyRef.value?.paymentReference).toBeUndefined();

      const validRef = validateOrderInput({
        ...baseInput,
        paymentReference: '  vipps-ref-123  ',
        paymentStatus: 'pending_provider',
      });
      expect(validRef.valid).toBe(true);
      expect(validRef.value?.paymentReference).toBe('vipps-ref-123');
      expect(validRef.value?.paymentStatus).toBe('pending_provider');

      const authorizedStatus = validateOrderInput({
        ...baseInput,
        paymentStatus: 'authorized',
      });
      expect(authorizedStatus.valid).toBe(false);
      expect(authorizedStatus.errors.paymentStatus).toBeDefined();
    });

    it('normalizes Unicode whitespace (e.g. NBSP \\u00A0) in customer.phone to ASCII space', () => {
      const res = validateOrderInput({
        ownerUid: 'u1',
        customer: {
          name: 'Ola Nordmann',
          email: 'ola@example.no',
          phone: '912\u00A034\u00A0567',
        },
        shippingAddress: {
          street: 'Storgata 1',
          postalCode: '0150',
          city: 'Oslo',
        },
        items: [{ productId: 'army-sekk', quantity: 1 }],
        paymentProvider: 'test_order',
      });

      expect(res.valid).toBe(true);
      expect(res.value?.customer.phone).toBe('912 34 567');
      expect(res.value?.customer.phone).not.toContain('\u00A0');
    });
  });

  describe('validateContactMessageInput', () => {
    it('accepts valid Norwegian message and rejects short/invalid inputs', () => {
      const ok = validateContactMessageInput({
        name: 'Henrik Solberg',
        email: 'henrik@example.no',
        subject: 'Spørsmål om pergola',
        message: 'Hei, kan pergolaen monteres på eksisterende treterrasse?',
      });
      expect(ok.valid).toBe(true);

      const bad = validateContactMessageInput({
        name: 'H',
        email: 'ugyldig',
        subject: '?',
        message: 'Kort',
      });
      expect(bad.valid).toBe(false);
      expect(bad.errors.name).toBeDefined();
      expect(bad.errors.email).toBeDefined();
      expect(bad.errors.subject).toBeDefined();
      expect(bad.errors.message).toBeDefined();
    });
  });
});
