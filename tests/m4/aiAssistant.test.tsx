import fs from 'node:fs';
import path from 'node:path';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/App';
import { AiAssistantWidget } from '../../src/components/ai/AiAssistantWidget';
import { CartProvider, useCart } from '../../src/context/CartContext';
import {
  LocalProductRepository,
  getProductRepository,
} from '../../src/repositories/productRepository';
import { getStarterProducts } from '../../src/repositories/seedCatalog';
import { CatalogPromptBuilder } from '../../src/services/ai/catalogContext';
import {
  DEFAULT_GEMINI_MODEL,
  FirebaseAiLogicAdapter,
  SevenoAiService,
  resolveGeminiModelName,
  sanitizeGeminiModelName,
  toFirebaseHistory,
} from '../../src/services/ai/sevenoAiService';
import { AiServiceError } from '../../src/services/ai/types';
import type { IAiAssistantService, IAiBackendAdapter } from '../../src/services/ai/types';
import type { Product } from '../../src/types/domain';

const aiSdkMocks = vi.hoisted(() => ({
  getAI: vi.fn(),
  getGenerativeModel: vi.fn(),
  startChat: vi.fn(),
  sendMessage: vi.fn(),
  isSupported: vi.fn(),
  getRemoteConfig: vi.fn(),
  fetchAndActivate: vi.fn(),
  getString: vi.fn(),
}));

vi.mock('firebase/ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('firebase/ai')>();
  return {
    ...actual,
    getAI: aiSdkMocks.getAI,
    getGenerativeModel: aiSdkMocks.getGenerativeModel,
  };
});

vi.mock('firebase/remote-config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('firebase/remote-config')>();
  return {
    ...actual,
    isSupported: aiSdkMocks.isSupported,
    getRemoteConfig: aiSdkMocks.getRemoteConfig,
    fetchAndActivate: aiSdkMocks.fetchAndActivate,
    getString: aiSdkMocks.getString,
  };
});

import { AIError, AIErrorCode, GoogleAIBackend } from 'firebase/ai';
import type { FirebaseApp } from 'firebase/app';

function collectSourceFiles(dirPath: string): string[] {
  if (!fs.existsSync(dirPath)) {
    return [];
  }
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectSourceFiles(fullPath));
    } else if (/\.(ts|tsx|js|mjs)$/.test(entry.name)) {
      files.push(fullPath);
    }
  }
  return files;
}

describe('M4 AI Security, Model Policy & CatalogPromptBuilder', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.clearAllMocks();
  });

  it('contains zero hardcoded Gemini/Google API keys or deprecated model IDs in src/ (and dist/ if present)', () => {
    const rootDir = process.cwd();
    const srcFiles = collectSourceFiles(path.join(rootDir, 'src'));
    const distFiles = collectSourceFiles(path.join(rootDir, 'dist'));
    const allFiles = [...srcFiles, ...distFiles];

    expect(srcFiles.length).toBeGreaterThan(0);

    const apiKeyPattern = /AIza[0-9A-Za-z_-]{20,}/;
    const forbiddenEnvPattern = /VITE_GEMINI_API_KEY|GEMINI_API_KEY\s*[:=]\s*["'`][^"'`]+["'`]/;

    for (const filePath of allFiles) {
      const content = fs.readFileSync(filePath, 'utf8');
      expect(content, `Hardcoded Google API key found in ${filePath}`).not.toMatch(apiKeyPattern);
      expect(content, `Hardcoded Gemini API key reference found in ${filePath}`).not.toMatch(
        forbiddenEnvPattern,
      );
    }

    // Ensure AI service source does not configure deprecated Gemini 1.x / 2.x models
    const aiServiceSrc = fs.readFileSync(
      path.join(rootDir, 'src', 'services', 'ai', 'sevenoAiService.ts'),
      'utf8',
    );
    expect(aiServiceSrc).not.toMatch(/['"]gemini-(?:1\.|2\.0|2\.5)[^'"]*['"]/);
  });

  it('enforces current Gemini 3.x model naming and rejects deprecated models', async () => {
    expect(DEFAULT_GEMINI_MODEL).toBe('gemini-3.8-flash');
    expect(sanitizeGeminiModelName('gemini-3.8-flash')).toBe('gemini-3.8-flash');
    expect(sanitizeGeminiModelName('gemini-3.0-pro')).toBe('gemini-3.0-pro');

    expect(sanitizeGeminiModelName('gemini-2.0-flash')).toBeNull();
    expect(sanitizeGeminiModelName('gemini-2.0-pro')).toBeNull();
    expect(sanitizeGeminiModelName('gemini-2.5-flash')).toBeNull();
    expect(sanitizeGeminiModelName('gemini-2.5-pro')).toBeNull();
    expect(sanitizeGeminiModelName('gemini-1.5-flash')).toBeNull();
    expect(sanitizeGeminiModelName('   ')).toBeNull();

    // Remote Config unsupported fallback
    aiSdkMocks.isSupported.mockResolvedValueOnce(false);
    expect(await resolveGeminiModelName({ app: { name: 'app' } as FirebaseApp })).toBe(
      'gemini-3.8-flash',
    );

    // Remote Config returns deprecated model -> falls back to DEFAULT_GEMINI_MODEL
    aiSdkMocks.isSupported.mockResolvedValueOnce(true);
    aiSdkMocks.getRemoteConfig.mockReturnValueOnce({ settings: {}, defaultConfig: {} });
    aiSdkMocks.fetchAndActivate.mockResolvedValueOnce(true);
    aiSdkMocks.getString.mockReturnValueOnce('gemini-2.0-flash');
    expect(await resolveGeminiModelName({ app: { name: 'app' } as FirebaseApp })).toBe(
      'gemini-3.8-flash',
    );

    // Remote Config returns valid Gemini 3.x override
    aiSdkMocks.isSupported.mockResolvedValueOnce(true);
    aiSdkMocks.getRemoteConfig.mockReturnValueOnce({ settings: {}, defaultConfig: {} });
    aiSdkMocks.fetchAndActivate.mockResolvedValueOnce(true);
    aiSdkMocks.getString.mockReturnValueOnce('gemini-3.9-flash');
    expect(await resolveGeminiModelName({ app: { name: 'app' } as FirebaseApp })).toBe(
      'gemini-3.9-flash',
    );
  });

  it('builds Norwegian systemInstruction from active products only and extracts referenced product IDs', () => {
    const starter = getStarterProducts('2026-11-22T10:00:00.000Z');
    const inactiveProduct: Product = {
      id: 'hidden-prod',
      slug: 'skjult-produkt',
      title: 'Skjult Testprodukt',
      categorySlug: 'seveno-home',
      categoryName: 'Seveno home',
      description: 'Skal ikke eksponeres for kundeboten.',
      priceNok: 999,
      stock: 5,
      imageUrl: '/images/products/seveno-default.svg',
      specs: [],
      active: false,
      createdAt: '2026-11-22T10:00:00.000Z',
      updatedAt: '2026-11-22T10:00:00.000Z',
    };

    const prompt = CatalogPromptBuilder.buildSystemInstruction([...starter, inactiveProduct]);

    expect(prompt).toContain('Army sekk');
    expect(prompt).toContain('1 890 kr');
    expect(prompt).toContain('Akryl gjennomsiktig skobeholder');
    expect(prompt).toContain('349 kr');
    expect(prompt).toContain('Pergola');
    expect(prompt).toContain('24 900 kr');
    expect(prompt).toContain('Fri frakt fra 1 500 kr');
    expect(prompt).toContain('ALDRI finne opp produkter');
    expect(prompt).not.toContain('Skjult Testprodukt');

    const emptyPrompt = CatalogPromptBuilder.buildSystemInstruction([]);
    expect(emptyPrompt).toContain('Ingen aktive produkter er tilgjengelige i katalogen akkurat nå.');

    const refs = CatalogPromptBuilder.extractReferencedProductIds(
      'Vi anbefaler vår Army sekk og Pergola til uterommet.',
      [...starter, inactiveProduct],
    );
    expect(refs).toEqual(['army-sekk', 'pergola']);
  });
});

describe('M4 Dynamic Backend Catalog Grounding (AC-3.2) & FirebaseAiLogicAdapter', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.clearAllMocks();
  });

  it('fetches live catalog on EVERY sendMessage turn so newly created products appear immediately without re-initialization (AC-3.2)', async () => {
    const localRepo = new LocalProductRepository('ai_ac32_products_test');
    const listActiveSpy = vi.spyOn(localRepo, 'listActive');

    const generateReplyMock = vi.fn<IAiBackendAdapter['generateReply']>(async (request) => {
      if (request.systemInstruction.includes('Testlampe Bronse Edition')) {
        return {
          text: 'Ja! Vi har Testlampe Bronse Edition på lager til 4 567 kr.',
          modelName: 'gemini-3.8-flash',
        };
      }
      return {
        text: 'Vi har blant annet Army sekk, Akryl gjennomsiktig skobeholder og Pergola.',
        modelName: 'gemini-3.8-flash',
      };
    });

    const mockAdapter: IAiBackendAdapter = {
      providerName: 'mock-gemini',
      isConfigured: () => true,
      generateReply: generateReplyMock,
    };

    // Instantiate service ONCE before creating the new product
    const aiService = new SevenoAiService({
      productRepository: localRepo,
      backendAdapter: mockAdapter,
    });

    const firstReply = await aiService.sendMessage('Hvilke produkter selger dere?');
    expect(listActiveSpy).toHaveBeenCalledTimes(1);
    expect(firstReply.catalogProductCount).toBe(3);
    expect(generateReplyMock.mock.calls[0][0].systemInstruction).not.toContain(
      'Testlampe Bronse Edition',
    );

    // Create new product in repository AFTER SevenoAiService was initialized
    await localRepo.create({
      id: 'testlampe-bronse',
      slug: 'testlampe-bronse-edition',
      title: 'Testlampe Bronse Edition',
      categorySlug: 'seveno-home',
      description: 'Skulpturell bordlampe i børstet varm bronse med dimbart nordisk lys.',
      priceNok: 4567,
      stock: 7,
      specs: ['Materiale: Børstet bronse', 'Høyde: 42 cm'],
      active: true,
    });

    // Ask immediately without recreating aiService
    const secondReply = await aiService.sendMessage(
      'Har dere Testlampe Bronse Edition og hva koster den?',
    );
    expect(listActiveSpy).toHaveBeenCalledTimes(2);
    expect(secondReply.catalogProductCount).toBe(4);
    expect(secondReply.referencedProductIds).toContain('testlampe-bronse');
    expect(secondReply.text).toContain('Testlampe Bronse Edition');
    expect(secondReply.text).toContain('4 567 kr');

    const secondSystemInstruction = generateReplyMock.mock.calls[1][0].systemInstruction;
    expect(secondSystemInstruction).toContain('Testlampe Bronse Edition');
    expect(secondSystemInstruction).toContain('4 567 kr');
  });

  it('defaults SevenoAiService repository to getProductRepository() dynamically in local mode', async () => {
    const repo = getProductRepository();
    await repo.create({
      title: 'Dynamisk Bordlykt',
      categorySlug: 'seveno-outdoor',
      description: 'Værbestandig bordlykt i varm bronse for terrasse og balkong.',
      priceNok: 890,
      stock: 12,
    });

    const generateReplyMock = vi.fn<IAiBackendAdapter['generateReply']>().mockResolvedValue({
      text: 'Dynamisk Bordlykt koster 890 kr.',
      modelName: 'gemini-3.8-flash',
    });

    const service = new SevenoAiService({
      backendAdapter: {
        providerName: 'mock-gemini',
        isConfigured: () => true,
        generateReply: generateReplyMock,
      },
    });

    const reply = await service.sendMessage('Har dere bordlykt?');
    expect(reply.catalogProductCount).toBe(4);
    expect(generateReplyMock.mock.calls[0][0].systemInstruction).toContain('Dynamisk Bordlykt');
  });

  it('normalizes chat history with toFirebaseHistory and invokes firebase/ai cleanly in FirebaseAiLogicAdapter', async () => {
    const history = toFirebaseHistory([
      { role: 'model', text: 'Velkomstmelding som må strippes' },
      { role: 'user', text: 'Hei!' },
      { role: 'user', text: 'Hva koster Pergola?' },
      { role: 'model', text: 'Pergola koster 24 900 kr.' },
      { role: 'user', text: 'Siste ubesvarte spørsmål som sendes separat' },
    ]);

    expect(history).toEqual([
      { role: 'user', parts: [{ type: 'text', text: 'Hei!\nHva koster Pergola?' }] },
      { role: 'model', parts: [{ type: 'text', text: 'Pergola koster 24 900 kr.' }] },
    ]);

    // Unconfigured adapter fails cleanly with Norwegian AiServiceError
    const unconfigured = new FirebaseAiLogicAdapter({ app: null });
    expect(unconfigured.isConfigured()).toBe(false);
    await expect(
      unconfigured.generateReply({
        systemInstruction: 'Instruks',
        history: [],
        userMessage: 'Hei',
      }),
    ).rejects.toMatchObject({ code: 'AI_NOT_CONFIGURED' });

    // Configured adapter invokes getAI(app, { backend: new GoogleAIBackend() }) and getGenerativeModel
    aiSdkMocks.isSupported.mockResolvedValueOnce(false);
    aiSdkMocks.sendMessage.mockResolvedValueOnce({
      response: {
        text: () => 'Army sekk koster 1 890 kr og rommer 28 liter.',
      },
    });
    aiSdkMocks.startChat.mockReturnValueOnce({ sendMessage: aiSdkMocks.sendMessage });
    aiSdkMocks.getGenerativeModel.mockReturnValueOnce({ startChat: aiSdkMocks.startChat });
    aiSdkMocks.getAI.mockReturnValueOnce({ name: 'ai-instance' });

    const fakeApp = { name: 'seveno-app' } as FirebaseApp;
    const adapter = new FirebaseAiLogicAdapter({ app: fakeApp });

    const reply = await adapter.generateReply({
      systemInstruction: 'Katalogkontekst',
      history: [{ role: 'model', text: 'Hei!' }],
      userMessage: 'Fortell om Army sekk',
    });

    expect(aiSdkMocks.getAI).toHaveBeenCalledWith(fakeApp, {
      backend: expect.any(GoogleAIBackend),
    });
    expect(aiSdkMocks.getGenerativeModel).toHaveBeenCalledWith(
      { name: 'ai-instance' },
      expect.objectContaining({
        model: 'gemini-3.8-flash',
        systemInstruction: 'Katalogkontekst',
      }),
    );

    // Ensure deprecated Gemini 2.x sampling params are NOT passed
    const modelParamsArg = aiSdkMocks.getGenerativeModel.mock.calls[0][1] as Record<
      string,
      unknown
    >;
    const genCfg = (modelParamsArg.generationConfig ?? {}) as Record<string, unknown>;
    expect(genCfg).not.toHaveProperty('temperature');
    expect(genCfg).not.toHaveProperty('topP');
    expect(genCfg).not.toHaveProperty('topK');
    expect(genCfg).not.toHaveProperty('candidateCount');
    expect(genCfg).not.toHaveProperty('presencePenalty');
    expect(genCfg).not.toHaveProperty('frequencyPenalty');

    expect(aiSdkMocks.startChat).toHaveBeenCalledWith({ history: [] });
    expect(aiSdkMocks.sendMessage).toHaveBeenCalledWith('Fortell om Army sekk', undefined);
    expect(reply.text).toBe('Army sekk koster 1 890 kr og rommer 28 liter.');

    // SDK AIError mapping
    aiSdkMocks.getGenerativeModel.mockReturnValueOnce({
      startChat: () => ({
        sendMessage: vi.fn().mockRejectedValue(new AIError(AIErrorCode.API_NOT_ENABLED, 'disabled')),
      }),
    });
    aiSdkMocks.getAI.mockReturnValueOnce({ name: 'ai-instance' });

    await expect(
      adapter.generateReply({
        systemInstruction: 'Katalog',
        history: [],
        userMessage: 'Hei',
      }),
    ).rejects.toMatchObject({ code: 'AI_NOT_CONFIGURED' });
  });
});

describe('M4 AiAssistantWidget UI & Cross-Route Mounting', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.clearAllMocks();
    document.body.style.overflow = '';
  });

  it('opens and closes without mutating body overflow, renders Norwegian Q&A, and handles errors', async () => {
    const sendMessageMock = vi
      .fn<IAiAssistantService['sendMessage']>()
      .mockResolvedValueOnce({
        text: 'Pergola koster 24 900 kr og har justerbare lameller.',
        modelName: 'gemini-3.8-flash',
        catalogProductCount: 3,
        referencedProductIds: ['pergola'],
        createdAt: '2026-11-22T12:00:00.000Z',
      })
      .mockRejectedValueOnce(
        new AiServiceError(
          'AI_REQUEST_FAILED',
          'Kunne ikke kontakte AI-tjenesten akkurat nå. Prøv igjen.',
        ),
      );

    const mockService: IAiAssistantService = {
      isConfigured: () => true,
      sendMessage: sendMessageMock,
    };

    render(<AiAssistantWidget aiService={mockService} />);

    // Closed state has launcher and zero role="dialog"
    const launcher = screen.getByRole('button', { name: 'Spør Seveno AI' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(launcher);

    const dialog = screen.getByRole('dialog', { name: 'Seveno AI-hjelpebot' });
    expect(dialog).toBeInTheDocument();
    expect(dialog).not.toHaveAttribute('aria-modal', 'true');
    expect(document.body.style.overflow).toBe('');
    expect(screen.getByRole('heading', { name: 'Seveno AI-hjelpebot', level: 2 })).toBeInTheDocument();
    expect(screen.getByText(/Hei! Jeg er Sevenos produktassistent/i)).toBeInTheDocument();

    // Send Norwegian question
    const input = screen.getByPlaceholderText('Skriv et spørsmål på norsk...');
    await user.type(input, 'Hva koster Pergola?');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => {
      expect(
        screen.getByText('Pergola koster 24 900 kr og har justerbare lameller.'),
      ).toBeInTheDocument();
    });

    expect(sendMessageMock).toHaveBeenCalledTimes(1);
    expect(sendMessageMock.mock.calls[0][0]).toBe('Hva koster Pergola?');

    // Second turn sends multi-turn history and shows error alert on failure
    await user.type(input, 'Har dere gratis frakt?');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Kunne ikke kontakte AI-tjenesten akkurat nå. Prøv igjen.',
      );
    });

    expect(sendMessageMock).toHaveBeenCalledTimes(2);
    expect(sendMessageMock.mock.calls[1][1]?.length).toBeGreaterThanOrEqual(2);

    // Escape closes dialog and restores focus to launcher
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Spør Seveno AI' })).toHaveFocus();
  });

  it('does not intercept Escape when CartDrawer is open', async () => {
    function CartOpener() {
      const cart = useCart();
      return (
        <button type="button" onClick={() => cart.openDrawer()}>
          OpenCartForTest
        </button>
      );
    }

    const mockService: IAiAssistantService = {
      isConfigured: () => true,
      sendMessage: vi.fn(),
    };

    render(
      <MemoryRouter>
        <CartProvider>
          <CartOpener />
          <AiAssistantWidget aiService={mockService} />
        </CartProvider>
      </MemoryRouter>,
    );

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Spør Seveno AI' }));
    expect(screen.getByRole('dialog', { name: 'Seveno AI-hjelpebot' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'OpenCartForTest' }));
    await user.keyboard('{Escape}');

    // AI dialog remains open because CartDrawer was open during Escape
    expect(screen.getByRole('dialog', { name: 'Seveno AI-hjelpebot' })).toBeInTheDocument();
  });

  it('mounts AiAssistantWidget across storefront and admin routes via Layout', () => {
    for (const route of ['/', '/kategori/seveno-living', '/kontakt', '/admin']) {
      const { unmount } = render(
        <MemoryRouter initialEntries={[route]}>
          <App />
        </MemoryRouter>,
      );
      expect(screen.getByRole('button', { name: 'Spør Seveno AI' })).toBeInTheDocument();
      unmount();
    }
  });
});
