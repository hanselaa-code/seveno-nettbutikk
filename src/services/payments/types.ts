import {
  NORWEGIAN_VAT_RATE,
  calculateIncludedMva,
  calculateShippingNok,
} from '../../lib/format';
import type {
  OrderCustomer,
  OrderPaymentStatus,
  PaymentProviderId,
  ShippingAddress,
} from '../../types/domain';

export type PaymentMode = 'sandbox' | 'live';

export type PaymentSessionStatus = 'created' | 'ready' | 'pending_provider' | 'failed';
export type PaymentAuthorizationStatus = 'paid_test' | 'authorized' | 'pending_provider' | 'failed';
export type PaymentLookupStatus =
  | 'created'
  | 'ready'
  | 'pending_provider'
  | 'authorized'
  | 'paid_test'
  | 'cancelled'
  | 'failed';

export interface PaymentOrderLineInput {
  productId: string;
  title: string;
  quantity: number;
  unitPriceNok: number;
}

export interface OrderPricing {
  subtotalNok: number;
  shippingNok: number;
  mvaNok: number;
  totalNok: number;
  subtotalOre: number;
  shippingOre: number;
  mvaOre: number;
  totalOre: number;
}

export interface CreatePaymentSessionInput {
  items: ReadonlyArray<PaymentOrderLineInput>;
  orderNumber?: string;
  customer?: Partial<OrderCustomer>;
  shippingAddress?: Partial<ShippingAddress>;
  returnUrl?: string;
  cancelUrl?: string;
  notificationUrl?: string;
  idempotencyKey?: string;
  metadata?: Record<string, unknown>;
}

export interface PaymentSessionResult {
  providerId: PaymentProviderId;
  mode: PaymentMode;
  sessionId: string;
  reference: string;
  status: PaymentSessionStatus;
  amountOre: number;
  currency: 'NOK';
  pricing: OrderPricing;
  clientToken?: string;
  redirectUrl?: string;
  providerPayload?: Record<string, unknown>;
  metadata: Record<string, unknown>;
}

export interface PaymentAuthorizationResult {
  providerId: PaymentProviderId;
  mode: PaymentMode;
  sessionId: string;
  reference: string;
  authorized: boolean;
  status: PaymentAuthorizationStatus;
  orderPaymentStatus: Extract<OrderPaymentStatus, 'paid_test' | 'pending_provider'>;
  amountOre: number;
  currency: 'NOK';
  redirectUrl?: string;
  metadata: Record<string, unknown>;
}

export interface PaymentStatusResult {
  providerId: PaymentProviderId;
  mode: PaymentMode;
  reference: string;
  status: PaymentLookupStatus;
  amountOre: number;
  currency: 'NOK';
  updatedAt: string;
  metadata: Record<string, unknown>;
}

export interface WebhookVerificationResult {
  providerId: PaymentProviderId;
  valid: boolean;
  verified: boolean;
  eventType?: string;
  reference?: string;
  reason?: string;
  payload?: unknown;
}

export interface IPaymentProvider {
  readonly id: PaymentProviderId;
  readonly displayName: string;
  readonly description: string;
  readonly mode: PaymentMode;
  isConfigured(): boolean;
  createSession(input: CreatePaymentSessionInput): Promise<PaymentSessionResult>;
  authorizePayment(sessionId: string): Promise<PaymentAuthorizationResult>;
  getStatus(reference: string): Promise<PaymentStatusResult>;
  verifyWebhook?(
    headers: Record<string, string>,
    rawBody: string,
  ): Promise<WebhookVerificationResult>;
}

export type PaymentProviderErrorSource = PaymentProviderId | 'validation' | 'registry';

export interface PaymentProviderErrorOptions {
  retryable?: boolean;
  statusCode?: number;
  cause?: unknown;
}

export class PaymentProviderError extends Error {
  readonly providerId: PaymentProviderErrorSource;
  readonly code: string;
  readonly retryable: boolean;
  readonly statusCode?: number;

  constructor(
    providerId: PaymentProviderErrorSource,
    code: string,
    message: string,
    options: PaymentProviderErrorOptions = {},
  ) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = 'PaymentProviderError';
    this.providerId = providerId;
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.statusCode = options.statusCode;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export function nokToOre(nok: number): number {
  if (typeof nok !== 'number' || !Number.isFinite(nok) || nok < 0) {
    throw new PaymentProviderError(
      'validation',
      'INVALID_AMOUNT',
      'Beløp i NOK må være et ikke-negativt, endelig tall.',
    );
  }
  return Math.round(nok * 100 + 1e-9) || 0;
}

export function calculateOrderPricing(
  itemsOrSubtotal: ReadonlyArray<Pick<PaymentOrderLineInput, 'unitPriceNok' | 'quantity'>> | number,
): OrderPricing {
  let subtotalOre = 0;

  if (typeof itemsOrSubtotal === 'number') {
    subtotalOre = nokToOre(itemsOrSubtotal);
  } else {
    for (const item of itemsOrSubtotal) {
      if (!Number.isInteger(item.quantity) || item.quantity < 1) {
        throw new PaymentProviderError(
          'validation',
          'INVALID_QUANTITY',
          'Antall per varelinje må være et heltall på minst 1.',
        );
      }
      if (
        typeof item.unitPriceNok !== 'number' ||
        !Number.isFinite(item.unitPriceNok) ||
        item.unitPriceNok <= 0
      ) {
        throw new PaymentProviderError(
          'validation',
          'INVALID_UNIT_PRICE',
          'Enhetspris i NOK må være større enn 0.',
        );
      }
      subtotalOre += nokToOre(item.unitPriceNok) * item.quantity;
    }
  }

  const subtotalNok = subtotalOre / 100;
  const shippingNok = calculateShippingNok(subtotalNok);
  const shippingOre = nokToOre(shippingNok);
  const totalOre = subtotalOre + shippingOre;
  const totalNok = totalOre / 100;
  const mvaNok = calculateIncludedMva(totalNok);
  const mvaOre = Math.round(totalOre * (NORWEGIAN_VAT_RATE / (1 + NORWEGIAN_VAT_RATE)));

  return {
    subtotalNok,
    shippingNok,
    mvaNok,
    totalNok,
    subtotalOre,
    shippingOre,
    mvaOre,
    totalOre,
  };
}

export function assertValidSessionInput(
  providerId: PaymentProviderId,
  input: CreatePaymentSessionInput,
): void {
  if (!input || !Array.isArray(input.items) || input.items.length === 0) {
    throw new PaymentProviderError(
      providerId,
      'INVALID_SESSION_INPUT',
      'Betalingssesjon krever minst én varelinje.',
    );
  }

  for (const item of input.items) {
    const productId = typeof item?.productId === 'string' ? item.productId.trim() : '';
    const title = typeof item?.title === 'string' ? item.title.trim() : '';
    if (!productId || !title) {
      throw new PaymentProviderError(
        providerId,
        'INVALID_SESSION_INPUT',
        'Hver varelinje må ha gyldig produkt-ID og tittel.',
      );
    }
    if (!Number.isInteger(item.quantity) || item.quantity < 1) {
      throw new PaymentProviderError(
        providerId,
        'INVALID_SESSION_INPUT',
        'Antall per varelinje må være et heltall på minst 1.',
      );
    }
    if (
      typeof item.unitPriceNok !== 'number' ||
      !Number.isFinite(item.unitPriceNok) ||
      item.unitPriceNok <= 0
    ) {
      throw new PaymentProviderError(
        providerId,
        'INVALID_SESSION_INPUT',
        'Enhetspris per varelinje må være større enn 0.',
      );
    }
  }
}

const TOKEN_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function createRandomAlnum(length: number): string {
  const safeLength = Math.max(1, Math.floor(length));
  let result = '';

  if (
    typeof globalThis.crypto !== 'undefined' &&
    typeof globalThis.crypto.getRandomValues === 'function'
  ) {
    const bytes = new Uint8Array(safeLength);
    globalThis.crypto.getRandomValues(bytes);
    for (const byte of bytes) {
      result += TOKEN_ALPHABET[byte % TOKEN_ALPHABET.length];
    }
    return result;
  }

  for (let i = 0; i < safeLength; i += 1) {
    const idx = Math.floor(Math.random() * TOKEN_ALPHABET.length);
    result += TOKEN_ALPHABET[idx];
  }
  return result;
}

export function encodeBasicAuth(username: string, password: string): string {
  const raw = `${username}:${password}`;
  if (typeof globalThis.btoa === 'function') {
    if (typeof TextEncoder !== 'undefined') {
      const bytes = new TextEncoder().encode(raw);
      let binary = '';
      for (const byte of bytes) {
        binary += String.fromCharCode(byte);
      }
      return globalThis.btoa(binary);
    }
    return globalThis.btoa(raw);
  }
  throw new PaymentProviderError(
    'validation',
    'BASE64_UNAVAILABLE',
    'Base64-koding (btoa) er ikke tilgjengelig i dette kjøremiljøet.',
  );
}
