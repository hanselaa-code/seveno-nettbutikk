import { defineConfig, devices } from '@playwright/test';
import { getBaseUrl, resolveExecutablePath } from './helpers/env';

const baseURL = getBaseUrl();
const executablePath = resolveExecutablePath();

export default defineConfig({
  testDir: './specs',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  timeout: 45_000,
  expect: {
    timeout: 12_000,
  },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: process.env.PW_VIDEO === '1' ? 'retain-on-failure' : 'off',
    locale: 'nb-NO',
    launchOptions: {
      executablePath,
    },
  },
  projects: [
    {
      name: 'desktop-chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
      },
    },
    {
      name: 'mobile-chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
        deviceScaleFactor: 2,
      },
    },
  ],
  ...(process.env.PW_START_SERVER === '1'
    ? {
        webServer: {
          command: 'npm --prefix .. run preview -- --port 4173 --strictPort',
          url: baseURL,
          reuseExistingServer: !process.env.CI,
          timeout: 60_000,
        },
      }
    : {}),
});
