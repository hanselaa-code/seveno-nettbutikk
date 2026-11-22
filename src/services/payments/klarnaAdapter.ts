import { NORWEGIAN_VAT_RATE } from '../../lib/format';
import {
  PaymentProviderError,
  assertValidSessionInput,
  calculateOrderPricing,
  createRandomAlnum,
  encodeBasicAuth,
  nokToOre,
} from './types';
import type {
  CreatePaymentSessionInput,
  IPaymentProvider,
  OrderPricing,
  PaymentAuthorizationResult,
  PaymentLookupStatus,
  PaymentMode,
  PaymentSessionResult,
  PaymentStatusResult,
  WebhookVerificationResult,
} from './types';

export const KLARNA_SANDBOX_BASE_URL = 'https://api.playground.klarna.com';
export const KLARNA_LIVE_BASE_URL = 'https://api.klarna.com';
export const KLARNA_TAX_RATE_25_MVA = 2500;

export interface KlarnaOrderLine {
  type: 'physical' | 'shipping_fee';
  reference: string;
  name: string;
  quantity: number;
  quantity_unit: string;
  unit_price: number;
  tax_rate: 2500;
  total_amount: number;
  total_discount_amount: number;
  total_tax_amount: number;
}

export interface KlarnaSessionPayload {
  purchase_country: 'NO';
  purchase_currency: 'NOK';
  locale: 'nb-NO';
  intent: 'buy';
  order_amount: number;
  order_tax_amount: number;
  order_lines: KlarnaOrderLine[];
  merchant_reference1?: string;
  merchant_urls?: {
    confirmation?: string;
    notification?: string;
  };
}

export interface KlarnaAdapterConfig {
  username?: string;
  password?: string;
  apiBaseUrl?: string;
  mode?: PaymentMode;
  webhookSecret?: string;
  fetchImpl?: typeof fetch;
}

interface KlarnaSessionRecord {
  sessionId: string;
  reference: string;
  mode: PaymentMode;
  pricing: OrderPricing;
  status: PaymentLookupStatus;
  clientToken?: string;
  updatedAt: string;
}

function getHeaderCaseInsensitive(
  headers: Record<string, string>,
  targetName: string,
): string | undefined {
  const lowerTarget = targetName.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lowerTarget) {
      return value;
    }
  }
  return undefined;
}

function mapKlarnaOrderStatus(status: unknown): PaymentLookupStatus {
  const normalized = typeof status === 'string' ? status.toUpperCase() : '';
  switch (normalized) {
    case 'AUTHORIZED':
    case 'CAPTURED':
    case 'PART_CAPTURED':
      return 'authorized';
    case 'CANCELLED':
    case 'EXPIRED':
      return 'cancelled';
    case 'CLOSED':
      return 'failed';
    default:
      return 'pending_provider';
  }
}

export class KlarnaPaymentAdapter implements IPaymentProvider {
  readonly id = 'klarna' as const;
  readonly displayName = 'Klarna';
  readonly description =
    'Klarna Payments v1 for Norge (NOK, 25 % MVA). Kjører i simulert testmodus når API-nøkler mangler.';
  readonly mode: PaymentMode;

  private readonly config: KlarnaAdapterConfig;
  private readonly sessions = new Map<string, KlarnaSessionRecord>();
  private readonly byReference = new Map<string, KlarnaSessionRecord>();

  constructor(config: KlarnaAdapterConfig = {}) {
    this.config = config;
    const configured = Boolean(config.username?.trim() && config.password?.trim());
    this.mode = configured ? (config.mode ?? 'live') : 'sandbox';
  }

  isConfigured(): boolean {
    return Boolean(this.config.username?.trim() && this.config.password?.trim());
  }

  private resolveBaseUrl(): string {
    if (this.config.apiBaseUrl?.trim()) {
      return this.config.apiBaseUrl.trim().replace(/\/+$/, '');
    }
    return this.mode === 'live' ? KLARNA_LIVE_BASE_URL : KLARNA_SANDBOX_BASE_URL;
  }

  buildSessionPayload(input: CreatePaymentSessionInput): {
    payload: KlarnaSessionPayload;
    pricing: OrderPricing;
  } {
    assertValidSessionInput(this.id, input);
    const pricing = calculateOrderPricing(input.items);

    const orderLines: KlarnaOrderLine[] = input.items.map((item) => {
      const unitPrice = nokToOre(item.unitPriceNok);
      const totalAmount = unitPrice * item.quantity;
      const totalTaxAmount = Math.round(
        totalAmount * (NORWEGIAN_VAT_RATE / (1 + NORWEGIAN_VAT_RATE)),
      );
      return {
        type: 'physical',
        reference: item.productId.trim(),
        name: item.title.trim(),
        quantity: item.quantity,
        quantity_unit: 'stk',
        unit_price: unitPrice,
        tax_rate: KLARNA_TAX_RATE_25_MVA,
        total_amount: totalAmount,
        total_discount_amount: 0,
        total_tax_amount: totalTaxAmount,
      };
    });

    if (pricing.shippingOre > 0) {
      orderLines.push({
        type: 'shipping_fee',
        reference: 'shipping',
        name: 'Frakt',
        quantity: 1,
        quantity_unit: 'stk',
        unit_price: pricing.shippingOre,
        tax_rate: KLARNA_TAX_RATE_25_MVA,
        total_amount: pricing.shippingOre,
        total_discount_amount: 0,
        total_tax_amount: Math.round(
          pricing.shippingOre * (NORWEGIAN_VAT_RATE / (1 + NORWEGIAN_VAT_RATE)),
        ),
      });
    }

    const orderAmount = orderLines.reduce((acc, line) => acc + line.total_amount, 0);
    const orderTaxAmount = orderLines.reduce((acc, line) => acc + line.total_tax_amount, 0);

    const payload: KlarnaSessionPayload = {
      purchase_country: 'NO',
      purchase_currency: 'NOK',
      locale: 'nb-NO',
      intent: 'buy',
      order_amount: orderAmount,
      order_tax_amount: orderTaxAmount,
      order_lines: orderLines,
    };

    if (input.orderNumber?.trim()) {
      payload.merchant_reference1 = input.orderNumber.trim();
    }

    if (input.returnUrl?.trim() || input.notificationUrl?.trim()) {
      payload.merchant_urls = {
        ...(input.returnUrl?.trim() ? { confirmation: input.returnUrl.trim() } : {}),
        ...(input.notificationUrl?.trim() ? { notification: input.notificationUrl.trim() } : {}),
      };
    }

    return { payload, pricing };
  }

  async createSession(input: CreatePaymentSessionInput): Promise<PaymentSessionResult> {
    const { payload, pricing } = this.buildSessionPayload(input);
    const baseUrl = this.resolveBaseUrl();

    if (!this.isConfigured() || this.mode === 'sandbox') {
      const sessionId = `klarna_sandbox_${createRandomAlnum(10)}`;
      const reference = `KLARNA-SANDBOX-${createRandomAlnum(8)}`;
      const clientToken = `klarna_client_sandbox_${createRandomAlnum(12)}`;
      const nowIso = new Date().toISOString();

      const record: KlarnaSessionRecord = {
        sessionId,
        reference,
        mode: 'sandbox',
        pricing,
        status: 'ready',
        clientToken,
        updatedAt: nowIso,
      };
      this.sessions.set(sessionId, record);
      this.byReference.set(reference, record);

      return {
        providerId: this.id,
        mode: 'sandbox',
        sessionId,
        reference,
        status: 'ready',
        amountOre: pricing.totalOre,
        currency: 'NOK',
        pricing,
        clientToken,
        providerPayload: payload as unknown as Record<string, unknown>,
        metadata: {
          simulated: true,
          configured: this.isConfigured(),
          endpoint: '/payments/v1/sessions',
          method: 'POST',
          apiBaseUrl: baseUrl,
        },
      };
    }

    const fetchFn = this.config.fetchImpl ?? globalThis.fetch;
    if (typeof fetchFn !== 'function') {
      throw new PaymentProviderError(
        this.id,
        'FETCH_UNAVAILABLE',
        'Fetch API er ikke tilgjengelig for Klarna-kall.',
        { retryable: false },
      );
    }

    const username = this.config.username?.trim() ?? '';
    const password = this.config.password?.trim() ?? '';

    let response: Response;
    try {
      response = await fetchFn(`${baseUrl}/payments/v1/sessions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Basic ${encodeBasicAuth(username, password)}`,
        },
        body: JSON.stringify(payload),
      });
    } catch (error) {
      throw new PaymentProviderError(
        this.id,
        'NETWORK_ERROR',
        'Nettverksfeil ved opprettelse av Klarna-betalingssesjon.',
        { retryable: true, cause: error },
      );
    }

    if (!response.ok) {
      const retryable = response.status >= 500 || response.status === 429;
      throw new PaymentProviderError(
        this.id,
        'KLARNA_API_ERROR',
        `Klarna svarte med HTTP ${response.status} ved opprettelse av sesjon.`,
        { retryable, statusCode: response.status },
      );
    }

    let data: { session_id?: unknown; client_token?: unknown };
    try {
      data = (await response.json()) as { session_id?: unknown; client_token?: unknown };
    } catch (error) {
      throw new PaymentProviderError(
        this.id,
        'INVALID_RESPONSE',
        'Ugyldig JSON-svar fra Klarna ved opprettelse av sesjon.',
        { retryable: false, cause: error },
      );
    }

    const sessionId = typeof data.session_id === 'string' ? data.session_id.trim() : '';
    const clientToken = typeof data.client_token === 'string' ? data.client_token.trim() : '';
    if (!sessionId || !clientToken) {
      throw new PaymentProviderError(
        this.id,
        'INVALID_RESPONSE',
        'Klarna-svaret mangler session_id eller client_token.',
        { retryable: false },
      );
    }

    const reference = input.orderNumber?.trim() || sessionId;
    const nowIso = new Date().toISOString();
    const record: KlarnaSessionRecord = {
      sessionId,
      reference,
      mode: 'live',
      pricing,
      status: 'created',
      clientToken,
      updatedAt: nowIso,
    };
    this.sessions.set(sessionId, record);
    this.byReference.set(reference, record);

    return {
      providerId: this.id,
      mode: 'live',
      sessionId,
      reference,
      status: 'created',
      amountOre: pricing.totalOre,
      currency: 'NOK',
      pricing,
      clientToken,
      providerPayload: payload as unknown as Record<string, unknown>,
      metadata: {
        simulated: false,
        configured: true,
        endpoint: '/payments/v1/sessions',
        method: 'POST',
        apiBaseUrl: baseUrl,
      },
    };
  }

  async authorizePayment(sessionId: string): Promise<PaymentAuthorizationResult> {
    const trimmedSessionId = typeof sessionId === 'string' ? sessionId.trim() : '';
    const record = trimmedSessionId ? this.sessions.get(trimmedSessionId) : undefined;
    if (!record) {
      throw new PaymentProviderError(
        this.id,
        'SESSION_NOT_FOUND',
        `Fant ikke Klarna-betalingssesjon "${sessionId}".`,
        { retryable: false },
      );
    }

    if (record.mode === 'sandbox' || !this.isConfigured() || this.mode === 'sandbox') {
      record.status = 'paid_test';
      record.updatedAt = new Date().toISOString();

      return {
        providerId: this.id,
        mode: 'sandbox',
        sessionId: record.sessionId,
        reference: record.reference,
        authorized: true,
        status: 'paid_test',
        orderPaymentStatus: 'paid_test',
        amountOre: record.pricing.totalOre,
        currency: 'NOK',
        metadata: {
          simulated: true,
          provider: 'klarna',
        },
      };
    }

    record.status = 'pending_provider';
    record.updatedAt = new Date().toISOString();

    return {
      providerId: this.id,
      mode: 'live',
      sessionId: record.sessionId,
      reference: record.reference,
      authorized: false,
      status: 'pending_provider',
      orderPaymentStatus: 'pending_provider',
      amountOre: record.pricing.totalOre,
      currency: 'NOK',
      metadata: {
        simulated: false,
        provider: 'klarna',
        requiresClientAuthorizationToken: true,
      },
    };
  }

  async getStatus(reference: string): Promise<PaymentStatusResult> {
    const trimmedRef = typeof reference === 'string' ? reference.trim() : '';
    const record = trimmedRef
      ? (this.byReference.get(trimmedRef) ?? this.sessions.get(trimmedRef))
      : undefined;

    if (!this.isConfigured() || this.mode === 'sandbox') {
      if (!record) {
        throw new PaymentProviderError(
          this.id,
          'PAYMENT_NOT_FOUND',
          `Fant ikke Klarna-betaling med referanse "${reference}".`,
          { retryable: false },
        );
      }

      return {
        providerId: this.id,
        mode: 'sandbox',
        reference: record.reference,
        status: record.status,
        amountOre: record.pricing.totalOre,
        currency: 'NOK',
        updatedAt: record.updatedAt,
        metadata: {
          simulated: true,
        },
      };
    }

    if (!trimmedRef) {
      throw new PaymentProviderError(
        this.id,
        'PAYMENT_NOT_FOUND',
        'Betalingsreferanse mangler for oppslag hos Klarna.',
        { retryable: false },
      );
    }

    const fetchFn = this.config.fetchImpl ?? globalThis.fetch;
    if (typeof fetchFn !== 'function') {
      throw new PaymentProviderError(
        this.id,
        'FETCH_UNAVAILABLE',
        'Fetch API er ikke tilgjengelig for Klarna-statusoppslag.',
        { retryable: false },
      );
    }

    const baseUrl = this.resolveBaseUrl();
    const username = this.config.username?.trim() ?? '';
    const password = this.config.password?.trim() ?? '';

    let response: Response;
    try {
      response = await fetchFn(
        `${baseUrl}/ordermanagement/v1/orders/${encodeURIComponent(trimmedRef)}`,
        {
          method: 'GET',
          headers: {
            Authorization: `Basic ${encodeBasicAuth(username, password)}`,
          },
        },
      );
    } catch (error) {
      throw new PaymentProviderError(
        this.id,
        'NETWORK_ERROR',
        'Nettverksfeil ved oppslag av Klarna-betalingsstatus.',
        { retryable: true, cause: error },
      );
    }

    if (!response.ok) {
      const retryable = response.status >= 500 || response.status === 429;
      throw new PaymentProviderError(
        this.id,
        'KLARNA_API_ERROR',
        `Klarna svarte med HTTP ${response.status} ved statusoppslag.`,
        { retryable, statusCode: response.status },
      );
    }

    const data = (await response.json()) as { status?: unknown; order_amount?: unknown };
    return {
      providerId: this.id,
      mode: 'live',
      reference: trimmedRef,
      status: mapKlarnaOrderStatus(data.status),
      amountOre:
        typeof data.order_amount === 'number'
          ? data.order_amount
          : (record?.pricing.totalOre ?? 0),
      currency: 'NOK',
      updatedAt: new Date().toISOString(),
      metadata: {
        simulated: false,
      },
    };
  }

  async verifyWebhook(
    headers: Record<string, string>,
    rawBody: string,
  ): Promise<WebhookVerificationResult> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      return {
        providerId: this.id,
        valid: false,
        verified: false,
        reason: 'Ugyldig JSON i webhook-body.',
      };
    }

    const bodyRecord =
      parsed !== null && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
    const eventType = typeof bodyRecord.event_type === 'string' ? bodyRecord.event_type : undefined;
    const reference =
      typeof bodyRecord.order_id === 'string'
        ? bodyRecord.order_id
        : typeof bodyRecord.session_id === 'string'
          ? bodyRecord.session_id
          : undefined;

    if (!this.config.webhookSecret?.trim()) {
      return {
        providerId: this.id,
        valid: false,
        verified: false,
        eventType,
        reference,
        reason: 'Webhook-verifisering krever konfigurert Klarna webhook-hemmelighet på server.',
        payload: parsed,
      };
    }

    const signature =
      getHeaderCaseInsensitive(headers, 'klarna-signature') ??
      getHeaderCaseInsensitive(headers, 'authorization');

    if (!signature?.trim()) {
      return {
        providerId: this.id,
        valid: false,
        verified: false,
        eventType,
        reference,
        reason: 'Manglende Klarna-signaturheader.',
        payload: parsed,
      };
    }

    return {
      providerId: this.id,
      valid: false,
      verified: false,
      eventType,
      reference,
      reason: 'Kryptografisk Klarna webhook-signaturverifisering utføres i servermiljø.',
      payload: parsed,
    };
  }
}
