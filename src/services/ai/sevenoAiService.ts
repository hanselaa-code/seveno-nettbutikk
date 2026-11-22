import { AIError, AIErrorCode, getAI, getGenerativeModel, GoogleAIBackend } from 'firebase/ai';
import type { Content } from 'firebase/ai';
import type { FirebaseApp } from 'firebase/app';
import {
  fetchAndActivate,
  getRemoteConfig,
  getString,
  isSupported,
} from 'firebase/remote-config';
import { firebaseApp, isFirebaseConfigured } from '../../lib/firebase';
import { getProductRepository } from '../../repositories/productRepository';
import type { IProductRepository } from '../../repositories/productRepository';
import type { Product } from '../../types/domain';
import { CatalogPromptBuilder } from './catalogContext';
import { AiServiceError } from './types';
import type {
  AiBackendRequest,
  AiBackendResponse,
  AiReply,
  ChatTurn,
  IAiAssistantService,
  IAiBackendAdapter,
  SendAiMessageOptions,
} from './types';

export const DEFAULT_GEMINI_MODEL = 'gemini-3.8-flash';
export const REMOTE_CONFIG_MODEL_KEY = 'gemini_model';

const DEPRECATED_MODEL_PATTERN = /^(?:models\/)?gemini-(?:1\.|2\.0|2\.5)/i;

export function sanitizeGeminiModelName(candidate: string | undefined | null): string | null {
  if (typeof candidate !== 'string') {
    return null;
  }
  const trimmed = candidate.trim();
  if (!trimmed || DEPRECATED_MODEL_PATTERN.test(trimmed)) {
    return null;
  }
  return trimmed;
}

export async function resolveGeminiModelName(options?: {
  app?: FirebaseApp | null;
  remoteConfigKey?: string;
  envModel?: string;
}): Promise<string> {
  const envValue = options?.envModel ?? import.meta.env.VITE_GEMINI_MODEL;
  const fallback = sanitizeGeminiModelName(envValue) ?? DEFAULT_GEMINI_MODEL;

  const app = options?.app;
  if (!app || typeof window === 'undefined') {
    return fallback;
  }

  const key = options?.remoteConfigKey ?? REMOTE_CONFIG_MODEL_KEY;

  try {
    const supported = await isSupported();
    if (!supported) {
      return fallback;
    }

    const remoteConfig = getRemoteConfig(app);
    remoteConfig.defaultConfig = { [key]: fallback };
    remoteConfig.settings = {
      ...remoteConfig.settings,
      minimumFetchIntervalMillis: 3_600_000,
      fetchTimeoutMillis: 3_000,
    };

    try {
      await fetchAndActivate(remoteConfig);
    } catch {
      // Fallback gracefully when Remote Config fetch fails or times out
    }

    const remoteModel = sanitizeGeminiModelName(getString(remoteConfig, key));
    return remoteModel ?? fallback;
  } catch {
    return fallback;
  }
}

export function toFirebaseHistory(turns: ReadonlyArray<ChatTurn>): Content[] {
  const cleaned: ChatTurn[] = [];

  for (const turn of turns) {
    const text = typeof turn.text === 'string' ? turn.text.trim() : '';
    if (!text) {
      continue;
    }

    if (cleaned.length === 0 && turn.role !== 'user') {
      continue;
    }

    const last = cleaned[cleaned.length - 1];
    if (last && last.role === turn.role) {
      cleaned[cleaned.length - 1] = {
        role: turn.role,
        text: `${last.text}\n${text}`,
      };
    } else {
      cleaned.push({ role: turn.role, text });
    }
  }

  if (cleaned.length > 0 && cleaned[cleaned.length - 1].role === 'user') {
    cleaned.pop();
  }

  return cleaned.map((turn) => ({
    role: turn.role,
    parts: [{ type: 'text', text: turn.text }],
  }));
}

function mapFirebaseAiError(error: unknown): AiServiceError {
  if (error instanceof AiServiceError) {
    return error;
  }

  const code =
    error instanceof AIError
      ? error.code
      : error !== null && typeof error === 'object' && 'code' in error
        ? String((error as { code: unknown }).code)
        : '';
  const message = error instanceof Error ? error.message : '';

  if (
    code === AIErrorCode.API_NOT_ENABLED ||
    code === AIErrorCode.NO_API_KEY ||
    code === AIErrorCode.NO_APP_ID ||
    code === AIErrorCode.NO_PROJECT_ID ||
    code === AIErrorCode.UNSUPPORTED
  ) {
    return new AiServiceError(
      'AI_NOT_CONFIGURED',
      'Firebase AI Logic er ikke aktivert eller mangler konfigurasjon for dette prosjektet.',
      { retryable: false, cause: error },
    );
  }

  if (code === AIErrorCode.RESPONSE_ERROR || /blocked|safety/i.test(message)) {
    return new AiServiceError(
      'BLOCKED_CONTENT',
      'Kunne ikke generere svar for denne forespørselen. Prøv å formulere spørsmålet annerledes.',
      { retryable: false, cause: error },
    );
  }

  if (code === AIErrorCode.FETCH_ERROR) {
    return new AiServiceError(
      'AI_REQUEST_FAILED',
      'Kunne ikke kontakte AI-tjenesten på grunn av nettverksfeil. Prøv igjen.',
      { retryable: true, cause: error },
    );
  }

  return new AiServiceError(
    'AI_REQUEST_FAILED',
    'Kunne ikke hente svar fra AI-assistenten akkurat nå. Prøv igjen om litt.',
    { retryable: true, cause: error },
  );
}

export interface FirebaseAiLogicAdapterConfig {
  app?: FirebaseApp | null;
  getApp?: () => FirebaseApp | null;
  modelName?: string;
  remoteConfigKey?: string;
}

export class FirebaseAiLogicAdapter implements IAiBackendAdapter {
  readonly providerName = 'firebase-ai-logic';
  private readonly explicitApp?: FirebaseApp | null;
  private readonly getAppFn?: () => FirebaseApp | null;
  private readonly explicitModelName?: string;
  private readonly remoteConfigKey?: string;
  private resolvedModelPromise: Promise<string> | null = null;

  constructor(config: FirebaseAiLogicAdapterConfig = {}) {
    this.explicitApp = config.app;
    this.getAppFn = config.getApp;
    this.explicitModelName = sanitizeGeminiModelName(config.modelName) ?? undefined;
    this.remoteConfigKey = config.remoteConfigKey;
  }

  private resolveApp(): FirebaseApp | null {
    if (this.explicitApp !== undefined) {
      return this.explicitApp;
    }
    if (this.getAppFn) {
      return this.getAppFn();
    }
    return isFirebaseConfigured() ? firebaseApp : null;
  }

  private getModelName(app: FirebaseApp): Promise<string> {
    if (this.explicitModelName) {
      return Promise.resolve(this.explicitModelName);
    }
    if (!this.resolvedModelPromise) {
      this.resolvedModelPromise = resolveGeminiModelName({
        app,
        remoteConfigKey: this.remoteConfigKey,
      });
    }
    return this.resolvedModelPromise;
  }

  isConfigured(): boolean {
    return this.resolveApp() !== null;
  }

  async generateReply(request: AiBackendRequest): Promise<AiBackendResponse> {
    const app = this.resolveApp();
    if (!app) {
      throw new AiServiceError(
        'AI_NOT_CONFIGURED',
        'AI-assistenten er ikke konfigurert ennå. Kontroller Firebase-oppsettet.',
      );
    }

    try {
      const modelName =
        sanitizeGeminiModelName(request.modelName) ?? (await this.getModelName(app));
      const ai = getAI(app, { backend: new GoogleAIBackend() });
      const model = getGenerativeModel(ai, {
        model: modelName,
        systemInstruction: request.systemInstruction,
        generationConfig: {
          maxOutputTokens: 1024,
        },
      });

      const chat = model.startChat({
        history: toFirebaseHistory(request.history),
      });

      const result = await chat.sendMessage(
        request.userMessage,
        request.signal ? { signal: request.signal } : undefined,
      );

      const text = result.response.text().trim();
      if (!text) {
        throw new AiServiceError(
          'EMPTY_RESPONSE',
          'AI-assistenten ga et tomt svar. Prøv å omformulere spørsmålet.',
          { retryable: true },
        );
      }

      return {
        text,
        modelName,
      };
    } catch (error) {
      throw mapFirebaseAiError(error);
    }
  }
}

export interface SevenoAiServiceOptions {
  productRepository?: IProductRepository;
  backendAdapter?: IAiBackendAdapter;
}

export class SevenoAiService implements IAiAssistantService {
  private readonly explicitProductRepository?: IProductRepository;
  private readonly backendAdapter: IAiBackendAdapter;

  constructor(options: SevenoAiServiceOptions = {}) {
    this.explicitProductRepository = options.productRepository;
    this.backendAdapter = options.backendAdapter ?? new FirebaseAiLogicAdapter();
  }

  isConfigured(): boolean {
    return this.backendAdapter.isConfigured();
  }

  async sendMessage(
    userMessage: string,
    history: ReadonlyArray<ChatTurn> = [],
    options?: SendAiMessageOptions,
  ): Promise<AiReply> {
    const trimmed = typeof userMessage === 'string' ? userMessage.trim() : '';
    if (!trimmed) {
      throw new AiServiceError('EMPTY_MESSAGE', 'Skriv inn et spørsmål før du sender.');
    }

    if (!this.backendAdapter.isConfigured()) {
      throw new AiServiceError(
        'AI_NOT_CONFIGURED',
        'AI-assistenten er ikke aktivert ennå. Kontroller at Firebase AI Logic er konfigurert.',
      );
    }

    const repo = this.explicitProductRepository ?? getProductRepository();
    let products: Product[];
    try {
      products = await repo.listActive();
    } catch (error) {
      throw new AiServiceError(
        'CATALOG_FETCH_FAILED',
        'Kunne ikke hente oppdatert produktkatalog fra databasen. Prøv igjen om litt.',
        { retryable: true, cause: error },
      );
    }

    const systemInstruction = CatalogPromptBuilder.buildSystemInstruction(products);
    const reply = await this.backendAdapter.generateReply({
      systemInstruction,
      history,
      userMessage: trimmed,
      signal: options?.signal,
    });

    const activeCount = products.filter((product) => product.active === true).length;

    return {
      text: reply.text,
      modelName: reply.modelName,
      catalogProductCount: activeCount,
      referencedProductIds: CatalogPromptBuilder.extractReferencedProductIds(
        reply.text,
        products,
      ),
      createdAt: new Date().toISOString(),
    };
  }
}

let defaultAiServiceSingleton: SevenoAiService | null = null;

export function createDefaultSevenoAiService(): SevenoAiService {
  return new SevenoAiService();
}

export function getSevenoAiService(): SevenoAiService {
  if (!defaultAiServiceSingleton) {
    defaultAiServiceSingleton = createDefaultSevenoAiService();
  }
  return defaultAiServiceSingleton;
}
