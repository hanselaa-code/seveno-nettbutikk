import { MessageCircle, Send, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useOptionalCart } from '../../context/CartContext';
import { getSevenoAiService } from '../../services/ai/sevenoAiService';
import type { ChatMessage, ChatTurn, IAiAssistantService } from '../../services/ai/types';

export interface AiAssistantWidgetProps {
  aiService?: IAiAssistantService;
}

export const AI_WELCOME_MESSAGE =
  'Hei! Jeg er Sevenos produktassistent. Spør meg gjerne om mål, materialer, priser eller lagerstatus på våre produkter.';

const QUICK_QUESTIONS = [
  'Hvilke produkter har dere?',
  'Fortell om Pergola',
  'Hva koster frakt?',
] as const;

export function AiAssistantWidget({ aiService }: AiAssistantWidgetProps) {
  const optionalCart = useOptionalCart();
  const isCartDrawerOpen = optionalCart?.isDrawerOpen ?? false;

  const resolvedService = useMemo(
    () => aiService ?? getSevenoAiService(),
    [aiService],
  );

  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>(() => [
    {
      id: 'welcome-message',
      role: 'model',
      text: AI_WELCOME_MESSAGE,
      createdAt: new Date().toISOString(),
    },
  ]);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const launcherRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const wasOpenRef = useRef(false);
  const sendingRef = useRef(false);
  const isMountedRef = useRef(true);
  const msgSequenceRef = useRef(0);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (isOpen) {
      wasOpenRef.current = true;
      inputRef.current?.focus();
    } else if (wasOpenRef.current) {
      wasOpenRef.current = false;
      launcherRef.current?.focus();
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isCartDrawerOpen) {
        setIsOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, isCartDrawerOpen]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    if (typeof messagesEndRef.current?.scrollIntoView === 'function') {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [isOpen, messages, isLoading]);

  const submitQuestion = async (rawText: string) => {
    const trimmed = rawText.trim();
    if (!trimmed || sendingRef.current) {
      return;
    }

    sendingRef.current = true;
    setErrorMessage(null);
    setInput('');
    setIsLoading(true);

    const historyTurns: ChatTurn[] = messages.map((msg) => ({
      role: msg.role,
      text: msg.text,
    }));

    msgSequenceRef.current += 1;
    const userMessage: ChatMessage = {
      id: `user-${msgSequenceRef.current}`,
      role: 'user',
      text: trimmed,
      createdAt: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, userMessage]);

    try {
      const reply = await resolvedService.sendMessage(trimmed, historyTurns);
      if (!isMountedRef.current) {
        return;
      }

      msgSequenceRef.current += 1;
      const modelMessage: ChatMessage = {
        id: `model-${msgSequenceRef.current}`,
        role: 'model',
        text: reply.text,
        createdAt: reply.createdAt,
        referencedProductIds: reply.referencedProductIds,
      };
      setMessages((prev) => [...prev, modelMessage]);
    } catch (error) {
      if (!isMountedRef.current) {
        return;
      }
      setErrorMessage(
        error instanceof Error && error.message
          ? error.message
          : 'Kunne ikke kontakte Seveno AI akkurat nå. Prøv igjen om litt.',
      );
    } finally {
      sendingRef.current = false;
      if (isMountedRef.current) {
        setIsLoading(false);
      }
    }
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void submitQuestion(input);
  };

  return (
    <>
      {!isOpen && (
        <button
          ref={launcherRef}
          type="button"
          onClick={() => setIsOpen(true)}
          aria-label="Spør Seveno AI"
          aria-expanded={false}
          aria-controls="seveno-ai-dialog"
          className="fixed bottom-4 right-4 z-30 inline-flex min-h-[44px] items-center gap-2 rounded-full bg-bronze px-4 py-2.5 text-sm font-semibold text-white shadow-nordic transition-colors hover:bg-bronze-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bronze sm:bottom-6 sm:right-6"
        >
          <MessageCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>Spør Seveno AI</span>
        </button>
      )}

      {isOpen && (
        <div
          id="seveno-ai-dialog"
          role="dialog"
          aria-label="Seveno AI-hjelpebot"
          className="fixed bottom-4 right-4 z-30 flex max-h-[min(34rem,calc(100vh-6rem))] w-[calc(100vw-2rem)] max-w-sm flex-col overflow-hidden rounded-xl border border-sand bg-canvas shadow-nordic sm:bottom-6 sm:right-6 sm:w-96"
        >
          <div className="flex items-center justify-between gap-3 border-b border-sand bg-ivory px-4 py-3">
            <div className="flex min-w-0 items-center gap-2.5">
              <svg
                width="28"
                height="28"
                viewBox="0 0 32 32"
                fill="none"
                aria-hidden="true"
                className="shrink-0"
              >
                <circle cx="16" cy="16" r="14" stroke="#7D5832" strokeWidth="2" />
                <path
                  d="M11 10.5H21L14.5 22.5"
                  stroke="#7D5832"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <div className="min-w-0">
                <h2 className="font-serif text-lg font-semibold leading-tight text-espresso">
                  Seveno AI-hjelpebot
                </h2>
                <p className="truncate text-xs text-taupe">
                  Produktassistent med oppdatert katalog
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setIsOpen(false)}
              aria-label="Lukk AI-hjelpebot"
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-sand bg-canvas text-espresso transition-colors hover:border-bronze hover:bg-linen focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bronze"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>

          <div
            role="log"
            aria-live="polite"
            aria-label="Samtalehistorikk"
            className="flex-1 space-y-3 overflow-y-auto bg-ivory/60 p-4"
          >
            {messages.map((msg) => {
              const isUser = msg.role === 'user';
              return (
                <div
                  key={msg.id}
                  className={
                    isUser
                      ? 'ml-auto max-w-[85%] rounded-lg bg-bronze px-3.5 py-2.5 text-sm text-white'
                      : 'mr-auto max-w-[85%] whitespace-pre-wrap rounded-lg border border-sand bg-canvas px-3.5 py-2.5 text-sm leading-relaxed text-espresso'
                  }
                >
                  {msg.text}
                </div>
              );
            })}

            {messages.length === 1 && !isLoading && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {QUICK_QUESTIONS.map((question) => (
                  <button
                    key={question}
                    type="button"
                    onClick={() => void submitQuestion(question)}
                    className="rounded-full border border-sand bg-canvas px-3 py-1.5 text-xs font-medium text-espresso transition-colors hover:border-bronze hover:bg-linen focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bronze"
                  >
                    {question}
                  </button>
                ))}
              </div>
            )}

            {isLoading && (
              <div
                role="status"
                className="mr-auto inline-flex items-center gap-2 rounded-lg border border-sand bg-canvas px-3.5 py-2 text-xs font-medium text-taupe"
              >
                Henter produktsvar ...
              </div>
            )}

            {errorMessage && (
              <p
                role="alert"
                className="rounded-md border border-error/30 bg-canvas px-3 py-2 text-xs font-medium text-error"
              >
                {errorMessage}
              </p>
            )}

            <div ref={messagesEndRef} />
          </div>

          <form
            onSubmit={handleSubmit}
            className="flex items-center gap-2 border-t border-sand bg-canvas p-3"
          >
            <label htmlFor="seveno-ai-input" className="sr-only">
              Spørsmål til Seveno AI
            </label>
            <input
              id="seveno-ai-input"
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Skriv et spørsmål på norsk..."
              disabled={isLoading}
              className="min-h-[44px] min-w-0 flex-1 rounded-md border border-sand bg-ivory px-3 py-2 text-sm text-espresso placeholder:text-taupe focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bronze disabled:opacity-60"
            />
            <button
              type="submit"
              disabled={isLoading || !input.trim()}
              aria-busy={isLoading}
              className="inline-flex min-h-[44px] shrink-0 items-center justify-center gap-1.5 rounded-md bg-bronze px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-bronze-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bronze disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Send className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Send</span>
            </button>
          </form>
        </div>
      )}
    </>
  );
}
