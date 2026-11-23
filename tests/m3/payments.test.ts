import { describe, expect, it, vi } from 'vitest';
import { calculateIncludedMva, STANDARD_SHIPPING_NOK } from '../../src/lib/format';
import {
  KLARNA_LIVE_BASE_URL,
  KLARNA_SANDBOX_BASE_URL,
  KLARNA_TAX_RATE_25_MVA,
  KlarnaPaymentAdapter,
} from '../../src/services/payments/klarnaAdapter';
import type { KlarnaSessionPayload } from '../../src/services/payments/klarnaAdapter';
import {
  PaymentProviderRegistry,
  createDefaultPaymentRegistry,
} from '../../src/services/payments/registry';
import { TestOrderAdapter } from '../../src/services/payments/testOrderAdapter';
import {
  PaymentProviderError,
  calculateOrderPricing,
  nokToOre,
} from '../../src/services/payments/types';
import {
  VIPPS_LIVE_BASE_URL,
  VIPPS_TEST_BASE_URL,
  VippsPaymentAdapter,
} from '../../src/services/payments/vippsAdapter';
import type { PaymentProviderId } from '../../src/types/domain';

describe('M3 Payment Provider Adapter Layer', () => {
  describe('nokToOre & calculateOrderPricing', () => {
    it('converts NOK to integer øre accurately across IEEE-754 float edge cases', () => {
      expect(nokToOre(0)).toBe(0);
      expect(nokToOre(1890)).toBe(189000);
      expect(nokToOre(19.9)).toBe(1990);
      expect(nokToOre(1.005)).toBe(101);
      expect(nokToOre(35.855)).toBe(3586);
      expect(nokToOre(0.1 + 0.2)).toBe(30);
    });

    it('rejects negative, NaN, and infinite amounts with PaymentProviderError', () => {
      expect(() => nokToOre(-1)).toThrow(PaymentProviderError);
      expect(() => nokToOre(Number.NaN)).toThrow(PaymentProviderError);
      expect(() => nokToOre(Number.POSITIVE_INFINITY)).toThrow(PaymentProviderError);
    });

    it('matches canonical shipping and 25% MVA rules in src/lib/format.ts without drift', () => {
      const belowThreshold = calculateOrderPricing([
        { unitPriceNok: 349, quantity: 2 },
      ]);
      expect(belowThreshold.subtotalNok).toBe(698);
      expect(belowThreshold.shippingNok).toBe(STANDARD_SHIPPING_NOK);
      expect(belowThreshold.totalNok).toBe(797);
      expect(belowThreshold.mvaNok).toBe(calculateIncludedMva(797));
      expect(belowThreshold.mvaNok).toBe(159);
      expect(belowThreshold.shippingOre).toBe(9900);
      expect(belowThreshold.totalOre).toBe(79700);

      const atThreshold = calculateOrderPricing(1500);
      expect(atThreshold.shippingNok).toBe(0);
      expect(atThreshold.totalNok).toBe(1500);
      expect(atThreshold.mvaNok).toBe(300);
      expect(atThreshold.totalOre).toBe(150000);

      const armySekk = calculateOrderPricing([{ unitPriceNok: 1890, quantity: 1 }]);
      expect(armySekk.shippingNok).toBe(0);
      expect(armySekk.mvaNok).toBe(calculateIncludedMva(armySekk.totalNok));

      const pergola = calculateOrderPricing([{ unitPriceNok: 24900, quantity: 1 }]);
      expect(pergola.shippingNok).toBe(0);
      expect(pergola.mvaNok).toBe(calculateIncludedMva(pergola.totalNok));

      expect(() => calculateOrderPricing([{ unitPriceNok: 100, quantity: 0 }])).toThrow(
        PaymentProviderError,
      );
      expect(() => calculateOrderPricing([{ unitPriceNok: -50, quantity: 1 }])).toThrow(
        PaymentProviderError,
      );
    });

    it('exposes Error + PaymentProviderError prototype metadata under erasableSyntaxOnly', () => {
      const err = new PaymentProviderError('klarna', 'TEST_ERR', 'Noe gikk galt', {
        retryable: true,
        statusCode: 503,
      });
      expect(err instanceof Error).toBe(true);
      expect(err instanceof PaymentProviderError).toBe(true);
      expect(err.providerId).toBe('klarna');
      expect(err.code).toBe('TEST_ERR');
      expect(err.retryable).toBe(true);
      expect(err.statusCode).toBe(503);
    });
  });

  describe('TestOrderAdapter', () => {
    it('runs full sandbox payment lifecycle and generates unique valid references', async () => {
      const adapter = new TestOrderAdapter();
      expect(adapter.id).toBe('test_order');
      expect(adapter.mode).toBe('sandbox');
      expect(adapter.isConfigured()).toBe(true);

      const refs = new Set<string>();
      for (let i = 0; i < 200; i += 1) {
        const s = await adapter.createSession({
          items: [{ productId: 'army-sekk', title: 'Army sekk', quantity: 1, unitPriceNok: 1890 }],
        });
        expect(s.reference).toMatch(/^TEST-\d{4}-[A-Z0-9]{8}$/);
        expect(s.reference.length).toBeGreaterThanOrEqual(3);
        expect(s.reference.length).toBeLessThanOrEqual(120);
        refs.add(s.reference);
      }
      expect(refs.size).toBe(200);

      const session = await adapter.createSession({
        items: [
          {
            productId: 'akryl-gjennomsiktig-skobeholder',
            title: 'Akryl gjennomsiktig skobeholder',
            quantity: 2,
            unitPriceNok: 349,
          },
        ],
      });
      expect(session.status).toBe('ready');
      expect(session.amountOre).toBe(79700);

      const initialStatus = await adapter.getStatus(session.reference);
      expect(initialStatus.status).toBe('ready');

      const auth = await adapter.authorizePayment(session.sessionId);
      expect(auth.authorized).toBe(true);
      expect(auth.status).toBe('paid_test');
      expect(auth.orderPaymentStatus).toBe('paid_test');
      expect(auth.reference).toBe(session.reference);

      const finalStatus = await adapter.getStatus(session.reference);
      expect(finalStatus.status).toBe('paid_test');

      await expect(adapter.authorizePayment('missing-session')).rejects.toThrow(
        PaymentProviderError,
      );
      await expect(adapter.getStatus('missing-ref')).rejects.toThrow(PaymentProviderError);
      await expect(adapter.createSession({ items: [] })).rejects.toThrow(PaymentProviderError);
    });
  });

  describe('KlarnaPaymentAdapter', () => {
    it('builds Klarna Payments v1 payloads with exact line-item sums in sandbox mode', async () => {
      const adapter = new KlarnaPaymentAdapter();
      expect(adapter.id).toBe('klarna');
      expect(adapter.mode).toBe('sandbox');
      expect(adapter.isConfigured()).toBe(false);

      const belowThreshold = await adapter.createSession({
        items: [
          {
            productId: 'akryl-gjennomsiktig-skobeholder',
            title: 'Akryl gjennomsiktig skobeholder',
            quantity: 2,
            unitPriceNok: 349,
          },
        ],
      });
      const belowPayload = belowThreshold.providerPayload as unknown as KlarnaSessionPayload;
      expect(belowPayload.purchase_country).toBe('NO');
      expect(belowPayload.purchase_currency).toBe('NOK');
      expect(belowPayload.locale).toBe('nb-NO');
      expect(belowPayload.order_lines).toHaveLength(2);
      expect(belowPayload.order_lines[0].tax_rate).toBe(KLARNA_TAX_RATE_25_MVA);
      expect(belowPayload.order_lines[1].type).toBe('shipping_fee');
      expect(belowPayload.order_lines[1].total_amount).toBe(9900);
      expect(
        belowPayload.order_lines.reduce((acc, l) => acc + l.total_amount, 0),
      ).toBe(belowPayload.order_amount);
      expect(
        belowPayload.order_lines.reduce((acc, l) => acc + l.total_tax_amount, 0),
      ).toBe(belowPayload.order_tax_amount);
      expect(belowThreshold.metadata.apiBaseUrl).toBe(KLARNA_SANDBOX_BASE_URL);

      const aboveThreshold = await adapter.createSession({
        items: [{ productId: 'army-sekk', title: 'Army sekk', quantity: 1, unitPriceNok: 1890 }],
      });
      const abovePayload = aboveThreshold.providerPayload as unknown as KlarnaSessionPayload;
      expect(abovePayload.order_lines).toHaveLength(1);
      expect(abovePayload.order_lines.some((l) => l.type === 'shipping_fee')).toBe(false);

      // Non-divisible-by-5 øre edge case
      const edgeCase = adapter.buildSessionPayload({
        items: [{ productId: 'edge', title: 'Edge vare', quantity: 2, unitPriceNok: 33.33 }],
      });
      expect(
        edgeCase.payload.order_lines.reduce((acc, l) => acc + l.total_tax_amount, 0),
      ).toBe(edgeCase.payload.order_tax_amount);

      const auth = await adapter.authorizePayment(belowThreshold.sessionId);
      expect(auth.orderPaymentStatus).toBe('paid_test');
      expect(auth.reference).toMatch(/^KLARNA-SANDBOX-/);
      expect(auth.reference.length).toBeGreaterThanOrEqual(3);
      expect(auth.reference.length).toBeLessThanOrEqual(120);
    });

    it('calls Klarna REST API in configured live mode and maps HTTP/network errors', async () => {
      const fetchMock = vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          session_id: 'klarna-live-sess-1',
          client_token: 'klarna-live-token-1',
        }),
      })) as unknown as typeof fetch;

      const adapter = new KlarnaPaymentAdapter({
        username: 'merchant-user',
        password: 'merchant-secret-value',
        fetchImpl: fetchMock,
      });

      expect(adapter.isConfigured()).toBe(true);
      expect(adapter.mode).toBe('live');

      const session = await adapter.createSession({
        orderNumber: 'SEV-2026-TEST1234',
        items: [{ productId: 'army-sekk', title: 'Army sekk', quantity: 1, unitPriceNok: 1890 }],
      });
      expect(session.mode).toBe('live');
      expect(session.sessionId).toBe('klarna-live-sess-1');
      expect(session.clientToken).toBe('klarna-live-token-1');
      expect(fetchMock).toHaveBeenCalledWith(
        `${KLARNA_LIVE_BASE_URL}/payments/v1/sessions`,
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: expect.stringMatching(/^Basic /),
          }),
        }),
      );

      const auth = await adapter.authorizePayment(session.sessionId);
      expect(auth.orderPaymentStatus).toBe('pending_provider');
      expect(auth.authorized).toBe(false);

      const failingAuthAdapter = new KlarnaPaymentAdapter({
        username: 'u',
        password: 'p',
        fetchImpl: (async () => ({ ok: false, status: 401 })) as unknown as typeof fetch,
      });
      await expect(
        failingAuthAdapter.createSession({
          items: [{ productId: 'army-sekk', title: 'Army sekk', quantity: 1, unitPriceNok: 1890 }],
        }),
      ).rejects.toMatchObject({ retryable: false, statusCode: 401 });

      const retryableAdapter = new KlarnaPaymentAdapter({
        username: 'u',
        password: 'p',
        fetchImpl: (async () => ({ ok: false, status: 503 })) as unknown as typeof fetch,
      });
      await expect(
        retryableAdapter.createSession({
          items: [{ productId: 'army-sekk', title: 'Army sekk', quantity: 1, unitPriceNok: 1890 }],
        }),
      ).rejects.toMatchObject({ retryable: true, statusCode: 503 });
    });

    it('fails closed on malformed or unverified Klarna webhooks', async () => {
      const adapter = new KlarnaPaymentAdapter();
      const badJson = await adapter.verifyWebhook({}, 'not-json');
      expect(badJson.valid).toBe(false);
      expect(badJson.verified).toBe(false);

      const noSecret = await adapter.verifyWebhook({}, '{"event_type":"ORDER_CAPTURED"}');
      expect(noSecret.valid).toBe(false);
      expect(noSecret.verified).toBe(false);
    });
  });

  describe('VippsPaymentAdapter', () => {
    it('builds Vipps ePayment v1 payload & redacted header contract in sandbox mode', async () => {
      const adapter = new VippsPaymentAdapter();
      expect(adapter.id).toBe('vipps');
      expect(adapter.mode).toBe('sandbox');
      expect(adapter.isConfigured()).toBe(false);

      const session = await adapter.createSession({
        orderNumber: 'SEV-2026-VIPPS001',
        customer: { phone: '+47 912 34 567' },
        items: [
          {
            productId: 'akryl-gjennomsiktig-skobeholder',
            title: 'Akryl gjennomsiktig skobeholder',
            quantity: 2,
            unitPriceNok: 349,
          },
        ],
      });

      expect(session.amountOre).toBe(79700);
      expect(session.providerPayload).toMatchObject({
        amount: { currency: 'NOK', value: 79700 },
        paymentMethod: { type: 'WALLET' },
        userFlow: 'WEB_REDIRECT',
        customer: { phoneNumber: '4791234567' },
      });
      expect(String(session.providerPayload?.paymentDescription).length).toBeLessThanOrEqual(100);
      expect(session.metadata.apiBaseUrl).toBe(VIPPS_TEST_BASE_URL);
      expect(session.metadata.headersContract).toMatchObject({
        Authorization: 'Bearer <redacted-oauth-token>',
        'Ocp-Apim-Subscription-Key': '<redacted>',
      });

      const auth = await adapter.authorizePayment(session.sessionId);
      expect(auth.orderPaymentStatus).toBe('paid_test');
      expect(auth.reference).toMatch(/^VIPPS-SANDBOX-/);
    });

    it('performs two-step OAuth + ePayment request in configured live mode', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ access_token: 'oauth-token-123' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            reference: 'SEV-2026-VIPPS999',
            redirectUrl: 'https://landing.vipps.no/mock-redirect',
          }),
        }) as unknown as typeof fetch;

      const adapter = new VippsPaymentAdapter({
        clientId: 'client-id',
        clientSecret: 'client-secret',
        subscriptionKey: 'sub-key',
        merchantSerialNumber: '123456',
        fetchImpl: fetchMock,
      });

      expect(adapter.isConfigured()).toBe(true);
      expect(adapter.mode).toBe('live');

      const session = await adapter.createSession({
        orderNumber: 'SEV-2026-VIPPS999',
        items: [{ productId: 'army-sekk', title: 'Army sekk', quantity: 1, unitPriceNok: 1890 }],
      });

      expect(session.mode).toBe('live');
      expect(session.redirectUrl).toBe('https://landing.vipps.no/mock-redirect');
      expect(fetchMock).toHaveBeenNthCalledWith(
        1,
        `${VIPPS_LIVE_BASE_URL}/accesstoken/get`,
        expect.objectContaining({ method: 'POST' }),
      );
      expect(fetchMock).toHaveBeenNthCalledWith(
        2,
        `${VIPPS_LIVE_BASE_URL}/epayment/v1/payments`,
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer oauth-token-123',
            'Ocp-Apim-Subscription-Key': 'sub-key',
            'Merchant-Serial-Number': '123456',
            'Idempotency-Key': expect.any(String),
          }),
        }),
      );

      const auth = await adapter.authorizePayment(session.sessionId);
      expect(auth.orderPaymentStatus).toBe('pending_provider');
      expect(auth.authorized).toBe(false);

      const rateLimited = new VippsPaymentAdapter({
        clientId: 'c',
        clientSecret: 's',
        subscriptionKey: 'k',
        merchantSerialNumber: '123',
        fetchImpl: (async () => ({ ok: false, status: 429 })) as unknown as typeof fetch,
      });
      await expect(
        rateLimited.createSession({
          items: [{ productId: 'army-sekk', title: 'Army sekk', quantity: 1, unitPriceNok: 1890 }],
        }),
      ).rejects.toMatchObject({ retryable: true, statusCode: 429 });
    });

    it('fails closed on invalid Vipps webhooks', async () => {
      const adapter = new VippsPaymentAdapter({ webhookSecret: 'secret' });
      expect((await adapter.verifyWebhook({}, '{bad')).valid).toBe(false);
      expect((await adapter.verifyWebhook({}, '{"reference":"r1"}')).valid).toBe(false);
    });
  });

  describe('PaymentProviderRegistry', () => {
    it('registers test_order, klarna, and vipps deterministically with zero hardcoded merchant secrets', () => {
      const registry = createDefaultPaymentRegistry();
      expect(registry.list().map((p) => p.id)).toEqual(['test_order', 'klarna', 'vipps']);
      expect(registry.listConfigured().map((p) => p.id)).toEqual(['test_order']);
      expect(registry.get('klarna')).toBeInstanceOf(KlarnaPaymentAdapter);
      expect(registry.get('vipps')).toBeInstanceOf(VippsPaymentAdapter);
      expect(registry.getDefault().id).toBe('test_order');
      expect(registry.find('unknown')).toBeUndefined();
      expect(() => registry.get('unknown' as PaymentProviderId)).toThrow(PaymentProviderError);

      expect(() => registry.register(new TestOrderAdapter())).toThrow(PaymentProviderError);
      expect(() => registry.register(new TestOrderAdapter(), { replace: true })).not.toThrow();
      expect(() => new PaymentProviderRegistry().getDefault()).toThrow(PaymentProviderError);
    });
  });

  describe('Tier 5 Adversarial Payment Hardening', () => {
    it('calculateOrderPricing([]) throws PaymentProviderError and nokToOre rejects safe-integer overflow', () => {
      expect(() => calculateOrderPricing([])).toThrow(PaymentProviderError);
      expect(() => nokToOre(1e15)).toThrow(PaymentProviderError);
    });

    it('KlarnaPaymentAdapter.getStatus and VippsPaymentAdapter.getStatus wrap invalid JSON as PaymentProviderError(INVALID_RESPONSE) and Vipps rejects non-https redirectUrl', async () => {
      const klarnaAdapter = new KlarnaPaymentAdapter({
        username: 'merchant-user',
        password: 'merchant-secret-value',
        fetchImpl: (async () => ({
          ok: true,
          status: 200,
          json: async () => {
            throw new SyntaxError('Unexpected token < in JSON');
          },
        })) as unknown as typeof fetch,
      });

      await expect(klarnaAdapter.getStatus('ORD-123')).rejects.toMatchObject({
        name: 'PaymentProviderError',
        providerId: 'klarna',
        code: 'INVALID_RESPONSE',
      });

      const vippsBadJsonFetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ access_token: 'oauth-token-123' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => {
            throw new SyntaxError('Unexpected token < in JSON');
          },
        }) as unknown as typeof fetch;

      const vippsAdapter = new VippsPaymentAdapter({
        clientId: 'c',
        clientSecret: 's',
        subscriptionKey: 'k',
        merchantSerialNumber: '123',
        fetchImpl: vippsBadJsonFetch,
      });

      await expect(vippsAdapter.getStatus('VIPPS-123')).rejects.toMatchObject({
        name: 'PaymentProviderError',
        providerId: 'vipps',
        code: 'INVALID_RESPONSE',
      });

      const vippsUnsafeRedirectFetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ access_token: 'oauth-token-123' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            reference: 'SEV-2026-XSS1',
            redirectUrl: 'javascript:alert(1)',
          }),
        }) as unknown as typeof fetch;

      const vippsRedirectAdapter = new VippsPaymentAdapter({
        clientId: 'c',
        clientSecret: 's',
        subscriptionKey: 'k',
        merchantSerialNumber: '123',
        fetchImpl: vippsUnsafeRedirectFetch,
      });

      await expect(
        vippsRedirectAdapter.createSession({
          orderNumber: 'SEV-2026-XSS1',
          items: [{ productId: 'army-sekk', title: 'Army sekk', quantity: 1, unitPriceNok: 1890 }],
        }),
      ).rejects.toMatchObject({
        name: 'PaymentProviderError',
        providerId: 'vipps',
        code: 'INVALID_RESPONSE',
      });
    });
  });
});
