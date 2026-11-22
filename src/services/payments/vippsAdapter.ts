import {
  PaymentProviderError,
  assertValidSessionInput,
  calculateOrderPricing,
  createRandomAlnum,
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

export const VIPPS_TEST_BASE_URL = 'https://apitest.vipps.no';
export const VIPPS_LIVE_BASE_URL = 'https://api.vipps.no';

export interface VippsCreatePaymentPayload {
  amount: {
    currency: 'NOK';
    value: number;
  };
  paymentMethod: {
    type: 'WALLET';
  };
  reference: string;
  returnUrl: string;
  userFlow: 'WEB_REDIRECT';
  paymentDescription: string;
  customer?: {
    phoneNumber: string;
  };
}

export interface VippsHeadersContract {
  'Content-Type': 'application/json';
  Authorization: string;
  'Ocp-Apim-Subscription-Key': string;
  'Merchant-Serial-Number': string;
  'Idempotency-Key': string;
  'Vipps-System-Name': string;
  'Vipps-System-Version': string;
}

export interface VippsAdapterConfig {
  clientId?: string;
  clientSecret?: string;
  subscriptionKey?: string;
  merchantSerialNumber?: string;
  apiBaseUrl?: string;
  mode?: PaymentMode;
  defaultReturnUrl?: string;
  systemName?: string;
  systemVersion?: string;
  webhookSecret?: string;
  fetchImpl?: typeof fetch;
}

interface VippsSessionRecord {
  sessionId: string;
  reference: string;
  mode: PaymentMode;
  pricing: OrderPricing;
  status: PaymentLookupStatus;
  redirectUrl?: string;
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

function normalizeNorwegianMsisdn(phone: string | undefined): string | undefined {
  if (!phone) {
    return undefined;
  }
  const cleaned = phone.replace(/[\s-]/g, '').trim();
  const match = /^(?:\+47|0047)?(\d{8})$/.exec(cleaned);
  return match ? `47${match[1]}` : undefined;
}

function sanitizeVippsReference(orderNumber: string | undefined): string {
  const candidate = (orderNumber ?? '')
    .trim()
    .replace(/[^a-zA-Z0-9-]/g, '-')
    .replace(/^-+|-+$/g, '');
  if (candidate.length >= 8 && candidate.length <= 50) {
    return candidate;
  }
  return `VIPPS-${createRandomAlnum(10)}`;
}

function buildPaymentDescription(input: CreatePaymentSessionInput): string {
  const titles = input.items.map((item) => item.title.trim()).join(', ');
  const full = `Seveno bestilling (${titles})`;
  return full.length <= 100 ? full : `${full.slice(0, 97)}...`;
}

function mapVippsState(state: unknown): PaymentLookupStatus {
  const normalized = typeof state === 'string' ? state.toUpperCase() : '';
  switch (normalized) {
    case 'CREATED':
      return 'created';
    case 'AUTHORIZED':
      return 'authorized';
    case 'ABORTED':
    case 'EXPIRED':
    case 'TERMINATED':
      return 'cancelled';
    default:
      return 'pending_provider';
  }
}

export class VippsPaymentAdapter implements IPaymentProvider {
  readonly id = 'vipps' as const;
  readonly displayName = 'Vipps';
  readonly description =
    'Vipps MobilePay ePayment API v1 for NOK. Kjører i simulert testmodus når API-nøkler mangler.';
  readonly mode: PaymentMode;

  private readonly config: VippsAdapterConfig;
  private readonly sessions = new Map<string, VippsSessionRecord>();
  private readonly byReference = new Map<string, VippsSessionRecord>();

  constructor(config: VippsAdapterConfig = {}) {
    this.config = config;
    const configured = Boolean(
      config.clientId?.trim() &&
        config.clientSecret?.trim() &&
        config.subscriptionKey?.trim() &&
        config.merchantSerialNumber?.trim(),
    );
    this.mode = configured ? (config.mode ?? 'live') : 'sandbox';
  }

  isConfigured(): boolean {
    return Boolean(
      this.config.clientId?.trim() &&
        this.config.clientSecret?.trim() &&
        this.config.subscriptionKey?.trim() &&
        this.config.merchantSerialNumber?.trim(),
    );
  }

  private resolveBaseUrl(): string {
    if (this.config.apiBaseUrl?.trim()) {
      return this.config.apiBaseUrl.trim().replace(/\/+$/, '');
    }
    return this.mode === 'live' ? VIPPS_LIVE_BASE_URL : VIPPS_TEST_BASE_URL;
  }

  buildCreatePaymentRequest(input: CreatePaymentSessionInput): {
    payload: VippsCreatePaymentPayload;
    headers: VippsHeadersContract;
    pricing: OrderPricing;
  } {
    assertValidSessionInput(this.id, input);
    const pricing = calculateOrderPricing(input.items);

    const reference = sanitizeVippsReference(input.orderNumber);
    const returnUrl =
      input.returnUrl?.trim() ||
      this.config.defaultReturnUrl?.trim() ||
      'https://seveno.no/utsjekk';
    const msisdn = normalizeNorwegianMsisdn(input.customer?.phone);

    const payload: VippsCreatePaymentPayload = {
      amount: {
        currency: 'NOK',
        value: pricing.totalOre,
      },
      paymentMethod: {
        type: 'WALLET',
      },
      reference,
      returnUrl,
      userFlow: 'WEB_REDIRECT',
      paymentDescription: buildPaymentDescription(input),
      ...(msisdn ? { customer: { phoneNumber: msisdn } } : {}),
    };

    const headers: VippsHeadersContract = {
      'Content-Type': 'application/json',
      Authorization: 'Bearer <access-token-pending>',
      'Ocp-Apim-Subscription-Key': this.config.subscriptionKey?.trim() || '<missing>',
      'Merchant-Serial-Number': this.config.merchantSerialNumber?.trim() || '<missing>',
      'Idempotency-Key': input.idempotencyKey?.trim() || createRandomAlnum(16),
      'Vipps-System-Name': this.config.systemName?.trim() || 'seveno-nettbutikk',
      'Vipps-System-Version': this.config.systemVersion?.trim() || '0.1.0',
    };

    return { payload, headers, pricing };
  }

  private async fetchOAuthAccessToken(fetchFn: typeof fetch, baseUrl: string): Promise<string> {
    let tokenResponse: Response;
    try {
      tokenResponse = await fetchFn(`${baseUrl}/accesstoken/get`, {
        method: 'POST',
        headers: {
          client_id: this.config.clientId?.trim() ?? '',
          client_secret: this.config.clientSecret?.trim() ?? '',
          'Ocp-Apim-Subscription-Key': this.config.subscriptionKey?.trim() ?? '',
          'Merchant-Serial-Number': this.config.merchantSerialNumber?.trim() ?? '',
        },
      });
    } catch (error) {
      throw new PaymentProviderError(
        this.id,
        'NETWORK_ERROR',
        'Nettverksfeil ved henting av Vipps OAuth-tilgangstoken.',
        { retryable: true, cause: error },
      );
    }

    if (!tokenResponse.ok) {
      const retryable = tokenResponse.status >= 500 || tokenResponse.status === 429;
      throw new PaymentProviderError(
        this.id,
        'VIPPS_AUTH_ERROR',
        `Vipps OAuth svarte med HTTP ${tokenResponse.status}.`,
        { retryable, statusCode: tokenResponse.status },
      );
    }

    let tokenData: { access_token?: unknown };
    try {
      tokenData = (await tokenResponse.json()) as { access_token?: unknown };
    } catch (error) {
      throw new PaymentProviderError(
        this.id,
        'INVALID_RESPONSE',
        'Ugyldig JSON-svar fra Vipps OAuth-endepunkt.',
        { retryable: false, cause: error },
      );
    }

    const accessToken =
      typeof tokenData.access_token === 'string' ? tokenData.access_token.trim() : '';
    if (!accessToken) {
      throw new PaymentProviderError(
        this.id,
        'INVALID_RESPONSE',
        'Vipps OAuth-svaret mangler access_token.',
        { retryable: false },
      );
    }

    return accessToken;
  }

  async createSession(input: CreatePaymentSessionInput): Promise<PaymentSessionResult> {
    const { payload, headers, pricing } = this.buildCreatePaymentRequest(input);
    const baseUrl = this.resolveBaseUrl();

    if (!this.isConfigured() || this.mode === 'sandbox') {
      const sessionId = `vipps_sandbox_${createRandomAlnum(10)}`;
      const reference = `VIPPS-SANDBOX-${createRandomAlnum(8)}`;
      const nowIso = new Date().toISOString();

      const record: VippsSessionRecord = {
        sessionId,
        reference,
        mode: 'sandbox',
        pricing,
        status: 'ready',
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
        providerPayload: payload as unknown as Record<string, unknown>,
        metadata: {
          simulated: true,
          configured: this.isConfigured(),
          endpoint: '/epayment/v1/payments',
          method: 'POST',
          apiBaseUrl: baseUrl,
          headersContract: {
            ...headers,
            Authorization: 'Bearer <redacted-oauth-token>',
            'Ocp-Apim-Subscription-Key': '<redacted>',
          },
        },
      };
    }

    const fetchFn = this.config.fetchImpl ?? globalThis.fetch;
    if (typeof fetchFn !== 'function') {
      throw new PaymentProviderError(
        this.id,
        'FETCH_UNAVAILABLE',
        'Fetch API er ikke tilgjengelig for Vipps-kall.',
        { retryable: false },
      );
    }

    const accessToken = await this.fetchOAuthAccessToken(fetchFn, baseUrl);
    const liveHeaders: VippsHeadersContract = {
      ...headers,
      Authorization: `Bearer ${accessToken}`,
    };

    let response: Response;
    try {
      response = await fetchFn(`${baseUrl}/epayment/v1/payments`, {
        method: 'POST',
        headers: liveHeaders as unknown as Record<string, string>,
        body: JSON.stringify(payload),
      });
    } catch (error) {
      throw new PaymentProviderError(
        this.id,
        'NETWORK_ERROR',
        'Nettverksfeil ved opprettelse av Vipps ePayment-betaling.',
        { retryable: true, cause: error },
      );
    }

    if (!response.ok) {
      const retryable = response.status >= 500 || response.status === 429;
      throw new PaymentProviderError(
        this.id,
        'VIPPS_API_ERROR',
        `Vipps svarte med HTTP ${response.status} ved opprettelse av betaling.`,
        { retryable, statusCode: response.status },
      );
    }

    let data: { reference?: unknown; redirectUrl?: unknown };
    try {
      data = (await response.json()) as { reference?: unknown; redirectUrl?: unknown };
    } catch (error) {
      throw new PaymentProviderError(
        this.id,
        'INVALID_RESPONSE',
        'Ugyldig JSON-svar fra Vipps ved opprettelse av betaling.',
        { retryable: false, cause: error },
      );
    }

    const reference =
      typeof data.reference === 'string' && data.reference.trim()
        ? data.reference.trim()
        : payload.reference;
    const redirectUrl =
      typeof data.redirectUrl === 'string' && data.redirectUrl.trim()
        ? data.redirectUrl.trim()
        : undefined;
    const nowIso = new Date().toISOString();

    const record: VippsSessionRecord = {
      sessionId: reference,
      reference,
      mode: 'live',
      pricing,
      status: 'pending_provider',
      redirectUrl,
      updatedAt: nowIso,
    };
    this.sessions.set(reference, record);
    this.byReference.set(reference, record);

    return {
      providerId: this.id,
      mode: 'live',
      sessionId: reference,
      reference,
      status: 'pending_provider',
      amountOre: pricing.totalOre,
      currency: 'NOK',
      pricing,
      redirectUrl,
      providerPayload: payload as unknown as Record<string, unknown>,
      metadata: {
        simulated: false,
        configured: true,
        endpoint: '/epayment/v1/payments',
        method: 'POST',
        apiBaseUrl: baseUrl,
        idempotencyKey: headers['Idempotency-Key'],
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
        `Fant ikke Vipps-betalingssesjon "${sessionId}".`,
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
          provider: 'vipps',
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
      redirectUrl: record.redirectUrl,
      metadata: {
        simulated: false,
        provider: 'vipps',
        requiresUserRedirect: true,
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
          `Fant ikke Vipps-betaling med referanse "${reference}".`,
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
        'Betalingsreferanse mangler for statusoppslag hos Vipps.',
        { retryable: false },
      );
    }

    const fetchFn = this.config.fetchImpl ?? globalThis.fetch;
    if (typeof fetchFn !== 'function') {
      throw new PaymentProviderError(
        this.id,
        'FETCH_UNAVAILABLE',
        'Fetch API er ikke tilgjengelig for Vipps-statusoppslag.',
        { retryable: false },
      );
    }

    const baseUrl = this.resolveBaseUrl();
    const accessToken = await this.fetchOAuthAccessToken(fetchFn, baseUrl);

    let response: Response;
    try {
      response = await fetchFn(
        `${baseUrl}/epayment/v1/payments/${encodeURIComponent(trimmedRef)}`,
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Ocp-Apim-Subscription-Key': this.config.subscriptionKey?.trim() ?? '',
            'Merchant-Serial-Number': this.config.merchantSerialNumber?.trim() ?? '',
          },
        },
      );
    } catch (error) {
      throw new PaymentProviderError(
        this.id,
        'NETWORK_ERROR',
        'Nettverksfeil ved oppslag av Vipps-betalingsstatus.',
        { retryable: true, cause: error },
      );
    }

    if (!response.ok) {
      const retryable = response.status >= 500 || response.status === 429;
      throw new PaymentProviderError(
        this.id,
        'VIPPS_API_ERROR',
        `Vipps svarte med HTTP ${response.status} ved statusoppslag.`,
        { retryable, statusCode: response.status },
      );
    }

    const data = (await response.json()) as {
      state?: unknown;
      amount?: { value?: unknown };
    };
    const amountOre =
      typeof data.amount?.value === 'number'
        ? data.amount.value
        : (record?.pricing.totalOre ?? 0);

    return {
      providerId: this.id,
      mode: 'live',
      reference: trimmedRef,
      status: mapVippsState(data.state),
      amountOre,
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
    const eventType = typeof bodyRecord.name === 'string' ? bodyRecord.name : undefined;
    const reference = typeof bodyRecord.reference === 'string' ? bodyRecord.reference : undefined;

    if (!this.config.webhookSecret?.trim()) {
      return {
        providerId: this.id,
        valid: false,
        verified: false,
        eventType,
        reference,
        reason: 'Webhook-verifisering krever konfigurert Vipps webhook-hemmelighet på server.',
        payload: parsed,
      };
    }

    const contentSha = getHeaderCaseInsensitive(headers, 'x-ms-content-sha256');
    const authHeader = getHeaderCaseInsensitive(headers, 'authorization');

    if (!contentSha?.trim() || !authHeader?.trim()) {
      return {
        providerId: this.id,
        valid: false,
        verified: false,
        eventType,
        reference,
        reason: 'Manglende Vipps webhook-signaturheadere (x-ms-content-sha256 / authorization).',
        payload: parsed,
      };
    }

    return {
      providerId: this.id,
      valid: false,
      verified: false,
      eventType,
      reference,
      reason: 'Kryptografisk Vipps webhook-signaturverifisering utføres i servermiljø.',
      payload: parsed,
    };
  }
}
