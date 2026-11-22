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
  PaymentSessionResult,
  PaymentStatusResult,
} from './types';

export interface TestOrderAdapterConfig {
  referenceGenerator?: () => string;
}

interface TestOrderSessionRecord {
  sessionId: string;
  reference: string;
  pricing: OrderPricing;
  status: PaymentLookupStatus;
  authorized: boolean;
  updatedAt: string;
  orderNumber?: string;
}

function defaultReferenceGenerator(): string {
  const year = new Date().getUTCFullYear();
  return `TEST-${year}-${createRandomAlnum(8)}`;
}

export class TestOrderAdapter implements IPaymentProvider {
  readonly id = 'test_order' as const;
  readonly displayName = 'Testbestilling';
  readonly description = 'Fullfører bestilling umiddelbart i testmodus uten ekte belastning.';
  readonly mode = 'sandbox' as const;

  private readonly referenceGenerator: () => string;
  private readonly sessions = new Map<string, TestOrderSessionRecord>();
  private readonly byReference = new Map<string, TestOrderSessionRecord>();

  constructor(config: TestOrderAdapterConfig = {}) {
    this.referenceGenerator = config.referenceGenerator ?? defaultReferenceGenerator;
  }

  isConfigured(): boolean {
    return true;
  }

  async createSession(input: CreatePaymentSessionInput): Promise<PaymentSessionResult> {
    assertValidSessionInput(this.id, input);

    const pricing = calculateOrderPricing(input.items);
    const reference = this.referenceGenerator().trim();
    const sessionId = `test_sess_${createRandomAlnum(10)}`;
    const nowIso = new Date().toISOString();

    const record: TestOrderSessionRecord = {
      sessionId,
      reference,
      pricing,
      status: 'ready',
      authorized: false,
      updatedAt: nowIso,
      orderNumber: input.orderNumber,
    };

    this.sessions.set(sessionId, record);
    this.byReference.set(reference, record);

    return {
      providerId: this.id,
      mode: this.mode,
      sessionId,
      reference,
      status: 'ready',
      amountOre: pricing.totalOre,
      currency: 'NOK',
      pricing,
      metadata: {
        simulated: true,
        configured: true,
        orderNumber: input.orderNumber,
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
        `Fant ikke betalingssesjon "${sessionId}".`,
        { retryable: false },
      );
    }

    record.status = 'paid_test';
    record.authorized = true;
    record.updatedAt = new Date().toISOString();

    return {
      providerId: this.id,
      mode: this.mode,
      sessionId: record.sessionId,
      reference: record.reference,
      authorized: true,
      status: 'paid_test',
      orderPaymentStatus: 'paid_test',
      amountOre: record.pricing.totalOre,
      currency: 'NOK',
      metadata: {
        simulated: true,
      },
    };
  }

  async getStatus(reference: string): Promise<PaymentStatusResult> {
    const trimmedRef = typeof reference === 'string' ? reference.trim() : '';
    const record = trimmedRef
      ? (this.byReference.get(trimmedRef) ?? this.sessions.get(trimmedRef))
      : undefined;

    if (!record) {
      throw new PaymentProviderError(
        this.id,
        'PAYMENT_NOT_FOUND',
        `Fant ikke testbetaling med referanse "${reference}".`,
        { retryable: false },
      );
    }

    return {
      providerId: this.id,
      mode: this.mode,
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
}
