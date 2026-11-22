import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const readRootFile = (relativePath: string): string => {
  const fullPath = resolve(ROOT, relativePath);
  expect(existsSync(fullPath), `${relativePath} must exist`).toBe(true);
  return readFileSync(fullPath, 'utf-8');
};

describe('Firebase configuration & Firestore security rules (M1)', () => {
  describe('firebase.json', () => {
    const raw = readRootFile('firebase.json');
    const config = JSON.parse(raw);

    it('configures Vite SPA hosting with clean cache headers', () => {
      expect(config.hosting).toBeDefined();
      expect(config.hosting.public).toBe('dist');
      expect(config.hosting.ignore).toEqual(
        expect.arrayContaining(['firebase.json', '**/.*', '**/node_modules/**']),
      );
      expect(config.hosting.rewrites).toEqual(
        expect.arrayContaining([{ source: '**', destination: '/index.html' }]),
      );

      const headers = config.hosting.headers as Array<{
        source: string;
        headers: Array<{ key: string; value: string }>;
      }>;
      expect(Array.isArray(headers)).toBe(true);
      const htmlHeader = headers.find((h) => h.source.includes('html'));
      expect(
        htmlHeader?.headers.some((x) => x.key === 'Cache-Control' && x.value.includes('no-cache')),
      ).toBe(true);
      const assetHeader = headers.find((h) => h.source.includes('/assets/'));
      expect(
        assetHeader?.headers.some((x) => x.key === 'Cache-Control' && x.value.includes('max-age=')),
      ).toBe(true);
    });

    it('wires firestore rules and indexes', () => {
      expect(config.firestore).toEqual({
        rules: 'firestore.rules',
        indexes: 'firestore.indexes.json',
      });
    });

    it('declares auth providers without invalid authorizedDomains key', () => {
      expect(config.auth?.providers?.anonymous).toBe(true);
      expect(config.auth?.providers?.emailPassword).toBe(true);
      expect(config.auth?.providers?.googleSignIn).toBeDefined();
      expect(config.auth?.providers?.googleSignIn?.oAuthBrandDisplayName).toBeTruthy();
      expect(config.auth?.providers?.googleSignIn?.supportEmail).toContain('@');
      expect('authorizedDomains' in (config.auth ?? {})).toBe(false);
    });

    it('configures local emulator suite ports and singleProjectMode', () => {
      expect(config.emulators?.firestore?.port).toBe(8080);
      expect(config.emulators?.auth?.port).toBe(9099);
      expect(config.emulators?.hosting?.port).toBe(5000);
      expect(config.emulators?.ui?.enabled).toBe(true);
      expect(config.emulators?.ui?.port).toBe(4000);
      expect(config.emulators?.singleProjectMode).toBe(true);
    });
  });

  describe('firestore.indexes.json', () => {
    const raw = readRootFile('firestore.indexes.json');
    const parsed = JSON.parse(raw);

    it('contains required composite indexes for products, orders, and contact_messages', () => {
      expect(Array.isArray(parsed.indexes)).toBe(true);
      expect(Array.isArray(parsed.fieldOverrides)).toBe(true);

      const hasIndex = (
        collectionGroup: string,
        fields: Array<{ fieldPath: string; order: 'ASCENDING' | 'DESCENDING' }>,
      ) =>
        parsed.indexes.some(
          (idx: { collectionGroup: string; queryScope: string; fields: unknown }) =>
            idx.collectionGroup === collectionGroup &&
            idx.queryScope === 'COLLECTION' &&
            JSON.stringify(idx.fields) === JSON.stringify(fields),
        );

      expect(
        hasIndex('products', [
          { fieldPath: 'active', order: 'ASCENDING' },
          { fieldPath: 'title', order: 'ASCENDING' },
        ]),
      ).toBe(true);
      expect(
        hasIndex('products', [
          { fieldPath: 'active', order: 'ASCENDING' },
          { fieldPath: 'categorySlug', order: 'ASCENDING' },
          { fieldPath: 'title', order: 'ASCENDING' },
        ]),
      ).toBe(true);
      expect(
        hasIndex('products', [
          { fieldPath: 'active', order: 'ASCENDING' },
          { fieldPath: 'createdAt', order: 'DESCENDING' },
        ]),
      ).toBe(true);
      expect(
        hasIndex('products', [
          { fieldPath: 'active', order: 'ASCENDING' },
          { fieldPath: 'categorySlug', order: 'ASCENDING' },
          { fieldPath: 'createdAt', order: 'DESCENDING' },
        ]),
      ).toBe(true);
      expect(
        hasIndex('orders', [
          { fieldPath: 'ownerUid', order: 'ASCENDING' },
          { fieldPath: 'createdAt', order: 'DESCENDING' },
        ]),
      ).toBe(true);
      expect(
        hasIndex('orders', [
          { fieldPath: 'status', order: 'ASCENDING' },
          { fieldPath: 'createdAt', order: 'DESCENDING' },
        ]),
      ).toBe(true);
      expect(
        hasIndex('contact_messages', [
          { fieldPath: 'status', order: 'ASCENDING' },
          { fieldPath: 'createdAt', order: 'DESCENDING' },
        ]),
      ).toBe(true);
    });
  });

  describe('firestore.rules', () => {
    const rules = readRootFile('firestore.rules');

    it('uses rules_version 2, documents assumed data model, and ends with default deny', () => {
      expect(rules).toMatch(/rules_version\s*=\s*'2'\s*;/);
      expect(rules).toContain('service cloud.firestore');
      expect(rules).toContain('Assumed Data Model');
      expect(rules).toMatch(
        /match\s+\/\{document=\*\*\}\s*\{\s*allow\s+read,\s*write:\s*if\s+false\s*;/,
      );
      expect(rules).not.toMatch(/TODO|FIXME/i);
    });

    it('contains zero blanket allow-all or unauthenticated PII read rules', () => {
      expect(rules).not.toMatch(/allow\s+(read|write|read,\s*write)\s*:\s*if\s+true\s*;/);
      expect(rules).not.toMatch(/allow\s+read\s*:\s*if\s+isSignedIn\(\)\s*;/);
    });

    it('enforces properly double-escaped regexes (no unescaped \\d, \\s, \\w, \\.)', () => {
      expect(rules).not.toMatch(/[^\\]\\[dsw.]/);
      expect(rules).toContain('^SEV-\\\\d{4}-');
      expect(rules).toContain('^\\\\d{4}$');
    });

    it('implements non-escalatable isAdmin() RBAC and locks admins collection writes', () => {
      const isAdminBlock = rules.match(/function\s+isAdmin\(\)\s*\{[\s\S]*?\n\s*\}/)?.[0] ?? '';
      expect(isAdminBlock).toBeTruthy();
      expect(isAdminBlock).toContain("'admin' in request.auth.token");
      expect(isAdminBlock).toContain("'email' in request.auth.token");
      expect(isAdminBlock).toContain("'email_verified' in request.auth.token");
      expect(isAdminBlock).toMatch(
        /'admin' in request\.auth\.token\s*&&\s*request\.auth\.token\.admin == true/,
      );
      expect(isAdminBlock).toMatch(
        /'email' in request\.auth\.token\s*&&\s*'email_verified' in request\.auth\.token[\s\S]*request\.auth\.token\.email == 'hanselaa@gmail\.com'[\s\S]*request\.auth\.token\.email_verified == true/,
      );

      expect(rules).toContain('request.auth.token.admin == true');
      expect(rules).toContain("request.auth.token.email == 'hanselaa@gmail.com'");
      expect(rules).toContain('request.auth.token.email_verified == true');
      expect(rules).toContain(
        'exists(/databases/$(database)/documents/admins/$(request.auth.uid))',
      );

      const adminsMatch = rules.match(/match\s+\/admins\/\{uid\}\s*\{[\s\S]*?\n\s*\}/);
      expect(adminsMatch?.[0]).toBeDefined();
      expect(adminsMatch?.[0]).toContain('allow get: if isSignedIn() && request.auth.uid == uid;');
      expect(adminsMatch?.[0]).toContain('allow list: if false;');
      expect(adminsMatch?.[0]).not.toMatch(/\ballow\s+read\s*:/);
      expect(adminsMatch?.[0]).toContain('allow write: if false;');
    });

    it('calls validator functions on BOTH create and update for products, orders, and contact_messages', () => {
      const productsBlock =
        rules.match(/match\s+\/products\/\{productId\}\s*\{[\s\S]*?\n\s*\}/)?.[0] ?? '';
      expect(productsBlock).toMatch(
        /allow get:\s*if\s+isAdmin\(\)\s*\|\|\s*resource\s*==\s*null\s*\|\|\s*\('active'\s+in\s+resource\.data\s*&&\s*resource\.data\.active\s*==\s*true\)\s*;/,
      );
      expect(productsBlock).toMatch(
        /allow list:\s*if\s+isAdmin\(\)\s*\|\|\s*\('active'\s+in\s+resource\.data\s*&&\s*resource\.data\.active\s*==\s*true\)\s*;/,
      );
      expect(productsBlock).toMatch(
        /allow create:[\s\S]*isAdmin\(\)[\s\S]*isValidProduct\(request\.resource\.data\)/,
      );
      expect(productsBlock).toMatch(
        /allow update:[\s\S]*isAdmin\(\)[\s\S]*isValidProduct\(request\.resource\.data\)/,
      );
      expect(productsBlock).toContain("areImmutableFieldsUnchanged(['createdAt'])");

      const ordersBlock =
        rules.match(/match\s+\/orders\/\{orderId\}\s*\{[\s\S]*?\n\s*\}/)?.[0] ?? '';
      expect(ordersBlock).toContain(
        "isAdmin() || (isSignedIn() && resource != null && 'ownerUid' in resource.data && resource.data.ownerUid == request.auth.uid)",
      );
      expect(ordersBlock).toMatch(
        /allow create:[\s\S]*isSignedIn\(\)[\s\S]*isValidOrder\(request\.resource\.data\)/,
      );
      expect(ordersBlock).toContain('request.resource.data.ownerUid == request.auth.uid');
      expect(ordersBlock).toMatch(
        /allow update:[\s\S]*isAdmin\(\)[\s\S]*isValidOrderUpdate\(request\.resource\.data\)/,
      );
      expect(ordersBlock).toContain('allow delete: if false;');

      const contactBlock =
        rules.match(/match\s+\/contact_messages\/\{messageId\}\s*\{[\s\S]*?\n\s*\}/)?.[0] ?? '';
      expect(contactBlock).toContain('allow read: if isAdmin();');
      expect(contactBlock).toMatch(
        /allow create:[\s\S]*isValidContactMessage\(request\.resource\.data\)/,
      );
      expect(contactBlock).toContain("request.resource.data.status == 'new'");
      expect(contactBlock).toMatch(
        /allow update:[\s\S]*isAdmin\(\)[\s\S]*isValidContactMessage\(request\.resource\.data\)/,
      );
    });

    it('enforces hasOnly, hasAll, numeric ranges, and string size caps', () => {
      expect(rules).toContain('hasOnlyAllowedFields');
      expect(rules).toContain('hasRequiredFields');
      expect(rules).toContain('data.priceNok > 0');
      expect(rules).toContain('data.stock >= 0');
      expect(rules).toContain('data.totalNok > 0');
      expect(rules).toContain('items.size() >= 1');
      expect(rules).toContain('items.size() <= 50');
      expect(rules).toContain('data.description.size() <= 4000');
      expect(rules).toContain('data.message.size() <= 3000');
    });

    it('guards every resource.data.<field> access in read rules and transition helpers', () => {
      const orderStatusFn =
        rules.match(/function\s+isValidOrderStatusTransition\(\)\s*\{[\s\S]*?\n\s*\}/)?.[0] ?? '';
      expect(orderStatusFn).toContain("resource != null");
      expect(orderStatusFn).toContain("'status' in resource.data");

      const paymentStatusFn =
        rules.match(/function\s+isValidPaymentStatusTransition\(\)\s*\{[\s\S]*?\n\s*\}/)?.[0] ?? '';
      expect(paymentStatusFn).toContain("resource != null");
      expect(paymentStatusFn).toContain("'paymentStatus' in resource.data");

      const contactStatusFn =
        rules.match(/function\s+isValidContactStatusTransition\(\)\s*\{[\s\S]*?\n\s*\}/)?.[0] ?? '';
      expect(contactStatusFn).toContain("resource != null");
      expect(contactStatusFn).toContain("'status' in resource.data");
    });
  });

  describe('secret hygiene', () => {
    it('contains zero hardcoded API keys in .env.example or firebase.ts', () => {
      const envExample = readRootFile('.env.example');
      const firebaseTs = readRootFile('src/lib/firebase.ts');
      expect(envExample).not.toMatch(/AIza[0-9A-Za-z_-]{10,}/);
      expect(firebaseTs).not.toMatch(/AIza[0-9A-Za-z_-]{10,}/);
    });
  });
});
