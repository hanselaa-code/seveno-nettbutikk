# Seveno Nettbutikk

En produksjonsklar, norskspråklig nettbutikk for **Seveno** bygget med et nordisk, moderne designuttrykk i varme elfenben-, lin-, espresso- og bronsetoner inspirert av Seveno-logoen.

- **Offentlig GitHub-repository**: https://github.com/hanselaa-code/seveno-nettbutikk
- **Live Firebase-nettadresse**: https://spill-2p-math.web.app (Firebase-prosjekt: `spill-2p-math`)

---

## Oversikt og produktkategorier

Nettbutikken er delt inn i tre kuraterte hovedkategorier med hvert sitt startprodukt (samt tilpassede SVG-produktillustrasjoner og automatisk reservebilde for nye produkter):

| Kategori | Slug | Startprodukt | Pris (NOK) |
|---|---|---|---|
| **Seveno living** | `seveno-living` | Army sekk | 1 890 kr |
| **Seveno home** | `seveno-home` | Akryl gjennomsiktig skobeholder | 349 kr |
| **Seveno outdoor** | `seveno-outdoor` | Pergola | 24 900 kr |

### Hovedfunksjoner
- **Nordisk butikkfront (`/`, `/kategori/:categorySlug`, `/produkt/:productId`)**: Kategoriutforskning, produktdetaljer, lagerstatus, spesifikasjoner og responsiv mobilmeny.
- **Handlekurv og utsjekk (`/utsjekk`)**: Persistent handlekurv (`localStorage`) med antallsbegrensning mot lagerbeholdning, automatisk beregning av frakt (fri frakt fra `1 500 kr`, ellers `99 kr`) og 25 % inkludert MVA, samt ordrebekreftelse (`SEV-YYYY-XXXXXXXX`) lagret i Cloud Firestore (`orders`).
- **Kontaktskjema (`/kontakt`)**: Validert norskspråklig kontaktskjema som lagrer henvendelser trygt i Cloud Firestore (`contact_messages`, kun lesbart for administratorer).
- **Admin-grensesnitt (`/admin`)**: Autentiseringsbeskyttet dashboard (Firebase Auth med Google-innlogging eller e-post/passord + RBAC via `firestore.rules` `isAdmin()`) for å opprette, redigere, deaktivere/aktivere og slette produkter samt se bestillinger og henvendelser.
- **Integrert AI-hjelpebot (Seveno AI)**: Flytende norskspråklig produktassistent tilgjengelig på tvers av alle ruter. Henter oppdaterte aktive produkter direkte fra databasen på **hver eneste melding**, slik at nye produkter lagt til i `/admin` umiddelbart blir tilgjengelige for boten uten ny kodepublisering.

---

## Arkitektur og teknologistakk

- **Frontend**: React 19, TypeScript, Vite 8, Tailwind CSS v4, React Router v7, Lucide Icons
- **Backend & infrastruktur (Firebase)**:
  - **Cloud Firestore** (Standard `(default)` database) for `products`, `orders`, `contact_messages` og `admins`
  - **Firebase Authentication** (`anonymous` gjestesesjoner for utsjekk, `emailPassword` og `googleSignIn` for administrator)
  - **Firebase AI Logic** (`firebase/ai` med `GoogleAIBackend()`, standardmodell `gemini-3.8-flash` konfigurert via Firebase Remote Config `gemini_model`)
  - **Classic Firebase Hosting** med SPA-omsrkiving (`** -> /index.html`) og runtime-konfigurasjon via `/__/firebase/init.json`
- **Testing**: Vitest + React Testing Library + Firebase Emulator Suite + isolert Playwright E2E-pakke under `e2e/`

### Datamodell og sikkerhetsregler (`firestore.rules`)
- `products/{productId}`: Offentlig lesetilgang for aktive produkter (`active == true`); opprettelse, oppdatering og sletting krever `isAdmin()` og streng skjemavalidering (`isValidProduct`).
- `orders/{orderId}`: Opprettelse krever innlogget økt (`isSignedIn()`, inkludert anonym gjestesesjon) og `ownerUid == request.auth.uid`; lesing er begrenset til eier eller administrator.
- `contact_messages/{messageId}`: Opprettelse validert for alle besøkende (`status == 'new'`); lesing og oppdatering krever `isAdmin()` (beskytter personopplysninger).
- `admins/{uid}`: Kun lesbar for egen UID; skriving er blokkert fra klient (`allow write: if false`).

---

## Betalingsarkitektur (Klarna & Vipps)

Betalingslaget i `src/services/payments/` er bygget rundt et utvidbart adaptermønster slik at ekte betalingsleverandører kan kobles på uten å endre utsjekkflyten:

- `IPaymentProvider` & `PaymentProviderRegistry` (`src/services/payments/types.ts`, `registry.ts`)
- `TestOrderAdapter` (`id: 'test_order'`): Aktiv sandkasseflyt som bekrefter testbestillinger direkte.
- `KlarnaPaymentAdapter` (`id: 'klarna'`): Forberedt for Klarna Payments API v1 (`POST /payments/v1/sessions`, `purchase_country: 'NO'`, `purchase_currency: 'NOK'`, `locale: 'nb-NO'`, heltall øre via `nokToOre()` og `tax_rate: 2500` for 25 % norsk MVA).
- `VippsPaymentAdapter` (`id: 'vipps'`): Forberedt for Vipps MobilePay ePayment API v1 (`POST /accesstoken/get`, `POST /epayment/v1/payments` med `Ocp-Apim-Subscription-Key`, `Merchant-Serial-Number`, `Idempotency-Key` og beløp i øre).

### Viktig sikkerhetsmerknad for produksjon av betaling
Hemmelige API-nøkler for Klarna (`KLARNA_API_USERNAME`, `KLARNA_API_PASSWORD`) og Vipps (`VIPPS_CLIENT_ID`, `VIPPS_CLIENT_SECRET`, `VIPPS_SUBSCRIPTION_KEY`, `VIPPS_MSN`) må **aldri** legges i `VITE_*`-variabler i klientbunten. I produksjon skal `createSession`, `authorizePayment`, `getStatus` og `verifyWebhook` kalles via sikre server-endepunkter (f.eks. Cloud Functions for Firebase).

---

## Sikker konfigurasjon og runtime-oppstart

For å unngå å bake Google API-nøkler inn i Vite-klientbunten (`dist/`), bruker produksjonsbygget automatisk **Classic Firebase Hosting** sitt innebygde endepunkt `/__/firebase/init.json` ved oppstart (`initializeFirebaseFromHosting()` i `src/lib/firebase.ts` kalt fra `src/main.tsx` før React monteres).

For lokal utvikling finnes `.env.example` som mal. Kopier til `.env` (gitignorert) ved behov for lokal emulering eller manuell Firebase-konfigurasjon:

```bash
cp .env.example .env
```

---

## Lokal utvikling og testing

### Installer avhengigheter
```bash
npm install
```

### Kjør utviklingsserver (med lokal fallback-lagring)
```bash
npm run dev
```

### Kjør med Firebase Emulator Suite (Auth, Firestore, Hosting)
```bash
# Terminal 1: bygg og start emulatorer
npm run build
npx firebase emulators:start
```

### Kvalitetssjekker og enhets-/integrasjonstester
```bash
npm run typecheck
npm run lint
npm run build
npm test
```

### E2E-tester (Playwright i `e2e/`)
```bash
cd e2e
npm install
npx playwright test
```

---

## Publisering til Firebase

Prosjektet er konfigurert for Spark-plan-prosjektet `spill-2p-math` (`.firebaserc` og `firebase.json`):

1. Velg Firebase-prosjekt og registrer Web App (`Seveno Nettbutikk`):
   ```bash
   npx -y firebase-tools@latest use spill-2p-math
   npx -y firebase-tools@latest apps:create web "Seveno Nettbutikk" --project spill-2p-math
   ```
2. Distribuer Cloud Firestore-regler og -indekser til `(default)`-databasen:
   ```bash
   npx -y firebase-tools@latest deploy --only "firestore:rules,firestore:indexes" --force --project spill-2p-math
   ```
3. Aktiver Auth-tilbydere (`anonymous`, `emailPassword`, `googleSignIn`), Firebase AI Logic (`gemini-developer-api`) og Remote Config (`gemini_model = "gemini-3.8-flash"`):
   ```bash
   npx -y firebase-tools@latest deploy --only auth,remoteconfig --force --project spill-2p-math
   ```
   *(Aktiver AI Logic-tilbyderen `gemini-developer-api` og bekreft App Check-status i Firebase Console / CLI).*
4. Seed startproduktene (`army-sekk`, `akryl-gjennomsiktig-skobeholder`, `pergola`) som administrator til `products`-samlingen i Firestore.
5. Bygg (uten `VITE_FIREBASE_API_KEY` i `.env`, slik at runtime henter `/__/firebase/init.json`) og publiser til Firebase Hosting:
   ```bash
   npm run build
   npx -y firebase-tools@latest deploy --only hosting --project spill-2p-math
   ```
