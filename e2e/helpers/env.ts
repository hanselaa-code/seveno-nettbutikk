import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export type E2ETargetMode = 'local' | 'emulator' | 'live';

export interface AdminCredentials {
  configured: true;
  email: string;
  password: string;
  source: 'env' | 'emulator';
}

export interface AdminSkippedConfig {
  configured: false;
  skipReason: string;
}

export type AdminConfig = AdminCredentials | AdminSkippedConfig;

export interface AiPolicy {
  required: boolean;
  responseTimeoutMs: number;
  appCheckDebugToken: string | undefined;
}

export function getBaseUrl(): string {
  const raw = process.env.BASE_URL?.trim();
  if (!raw) return 'http://localhost:4173';
  return raw.replace(/\/+$/, '');
}

export function getTargetMode(): E2ETargetMode {
  const explicit = process.env.E2E_TARGET?.trim().toLowerCase();
  if (explicit === 'local' || explicit === 'emulator' || explicit === 'live') {
    return explicit;
  }
  if (process.env.E2E_EMULATOR === '1') {
    return 'emulator';
  }
  const baseUrl = getBaseUrl();
  if (/^https:\/\/.*\.(web\.app|firebaseapp\.com)(:\d+)?$/i.test(baseUrl)) {
    return 'live';
  }
  return 'local';
}

export function isHeadedMode(): boolean {
  return (
    process.argv.includes('--headed') ||
    process.argv.includes('--ui') ||
    process.env.HEADED === '1'
  );
}

function findPuppeteerBinary(
  category: 'chrome-headless-shell' | 'chrome',
  subDir: string,
  exeName: string,
): string | undefined {
  const baseDir = path.join(os.homedir(), '.cache', 'puppeteer', category);
  if (!fs.existsSync(baseDir)) return undefined;

  const versions = fs
    .readdirSync(baseDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .reverse();

  for (const version of versions) {
    const candidate = path.join(baseDir, version, subDir, exeName);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

export function resolveExecutablePath(): string {
  const envPath = process.env.PLAYWRIGHT_EXECUTABLE_PATH?.trim();
  if (envPath) {
    if (!fs.existsSync(envPath)) {
      throw new Error(`PLAYWRIGHT_EXECUTABLE_PATH does not exist: ${envPath}`);
    }
    return envPath;
  }

  const headed = isHeadedMode();
  const candidates: Array<string | undefined> = [
    ...(headed
      ? []
      : [
          findPuppeteerBinary(
            'chrome-headless-shell',
            'chrome-headless-shell-win64',
            'chrome-headless-shell.exe',
          ),
        ]),
    findPuppeteerBinary('chrome', 'chrome-win64', 'chrome.exe'),
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  ];

  const resolved = candidates.find((candidate): candidate is string =>
    Boolean(candidate && fs.existsSync(candidate)),
  );
  if (!resolved) {
    throw new Error(
      'No local Chromium/Chrome/Edge executable found. Set PLAYWRIGHT_EXECUTABLE_PATH or install Chrome/Puppeteer cache.',
    );
  }
  return resolved;
}

export function getEmulatorAuthUrl(): string {
  return (
    process.env.E2E_EMULATOR_AUTH_URL?.trim().replace(/\/+$/, '') ||
    'http://127.0.0.1:9099'
  );
}

export function getAdminConfig(): AdminConfig {
  const email = process.env.E2E_ADMIN_EMAIL?.trim();
  const password = process.env.E2E_ADMIN_PASSWORD?.trim();

  if (email && password) {
    return {
      configured: true,
      email,
      password,
      source: 'env',
    };
  }

  if (getTargetMode() === 'emulator') {
    return {
      configured: true,
      email: email || 'hanselaa@gmail.com',
      password: password || 'SevenoE2EAdmin!2026',
      source: 'emulator',
    };
  }

  if (process.env.E2E_SKIP_ADMIN_WITHOUT_CREDS === '1') {
    return {
      configured: false,
      skipReason:
        'Admin credentials unset and E2E_SKIP_ADMIN_WITHOUT_CREDS=1 explicitly provided.',
    };
  }

  throw new Error(
    'Admin E2E credentials missing: set E2E_ADMIN_EMAIL and E2E_ADMIN_PASSWORD (or E2E_TARGET=emulator, or E2E_SKIP_ADMIN_WITHOUT_CREDS=1 for unprivileged smoke runs).',
  );
}

export function getAiPolicy(): AiPolicy {
  const timeoutRaw = Number(process.env.E2E_AI_TIMEOUT_MS);
  return {
    required: process.env.E2E_AI_REQUIRED !== '0',
    responseTimeoutMs: Number.isFinite(timeoutRaw) && timeoutRaw > 0 ? timeoutRaw : 25_000,
    appCheckDebugToken: process.env.FIREBASE_APPCHECK_DEBUG_TOKEN?.trim() || undefined,
  };
}
