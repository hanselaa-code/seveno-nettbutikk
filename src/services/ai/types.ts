import type { ChatMessage, ChatRole, ChatTurn } from '../../types/domain';

export type { ChatMessage, ChatRole, ChatTurn };

export type AiServiceErrorCode =
  | 'EMPTY_MESSAGE'
  | 'AI_NOT_CONFIGURED'
  | 'CATALOG_FETCH_FAILED'
  | 'AI_REQUEST_FAILED'
  | 'EMPTY_RESPONSE'
  | 'BLOCKED_CONTENT';

export class AiServiceError extends Error {
  readonly code: AiServiceErrorCode;
  readonly retryable: boolean;

  constructor(
    code: AiServiceErrorCode,
    message: string,
    options: { retryable?: boolean; cause?: unknown } = {},
  ) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = 'AiServiceError';
    this.code = code;
    this.retryable = options.retryable ?? false;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export interface AiBackendRequest {
  systemInstruction: string;
  history: ReadonlyArray<ChatTurn>;
  userMessage: string;
  modelName?: string;
  signal?: AbortSignal;
}

export interface AiBackendResponse {
  text: string;
  modelName: string;
}

export interface IAiBackendAdapter {
  readonly providerName: string;
  isConfigured(): boolean;
  generateReply(request: AiBackendRequest): Promise<AiBackendResponse>;
}

export interface SendAiMessageOptions {
  signal?: AbortSignal;
}

export interface AiReply {
  text: string;
  modelName: string;
  catalogProductCount: number;
  referencedProductIds: string[];
  createdAt: string;
}

export interface IAiAssistantService {
  isConfigured(): boolean;
  sendMessage(
    userMessage: string,
    history?: ReadonlyArray<ChatTurn>,
    options?: SendAiMessageOptions,
  ): Promise<AiReply>;
}
