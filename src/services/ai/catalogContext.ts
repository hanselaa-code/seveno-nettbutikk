import { formatNok, FREE_SHIPPING_THRESHOLD_NOK, STANDARD_SHIPPING_NOK } from '../../lib/format';
import type { Product } from '../../types/domain';

export class CatalogPromptBuilder {
  static buildSystemInstruction(products: ReadonlyArray<Product>): string {
    const activeProducts = products.filter((product) => product.active === true);
    const sortedProducts = [...activeProducts].sort((a, b) =>
      a.title.localeCompare(b.title, 'nb'),
    );

    const catalogLines =
      sortedProducts.length === 0
        ? 'Ingen aktive produkter er tilgjengelige i katalogen akkurat nå.'
        : sortedProducts
            .map((product) => {
              const stockText =
                product.stock > 0
                  ? `På lager (${product.stock} stk)`
                  : 'Midlertidig utsolgt (0 stk)';
              const specsLine =
                product.specs.length > 0
                  ? `\n  Spesifikasjoner: ${product.specs.join('; ')}`
                  : '';

              return [
                `- Navn: ${product.title}`,
                `  Produkt-ID/Slug: ${product.slug} (lenke: /produkt/${product.slug})`,
                `  Kategori: ${product.categoryName} (${product.categorySlug})`,
                `  Pris: ${formatNok(product.priceNok)} (inkl. 25 % mva)`,
                `  Lagerstatus: ${stockText}`,
                `  Beskrivelse: ${product.description.trim()}`,
              ].join('\n') + specsLine;
            })
            .join('\n\n');

    return [
      'Du er Sevenos norskspråklige produkt- og kundeassistent for nettbutikken Seveno Nettbutikk.',
      '',
      'Retningslinjer for svar:',
      '1. Svar alltid på naturlig, høflig og presist norsk (bokmål) i en nordisk, varm og hjelpsom tone.',
      '2. Baser alle produktpåstander utelukkende på den oppdaterte produktkatalogen nedenfor (navn, kategori, pris i NOK, lagerstatus, beskrivelse, spesifikasjoner og produktlenke).',
      '3. Du må ALDRI finne opp produkter, priser, rabatter, mål eller lagerbeholdning som ikke står i katalogen. Hvis kunden spør om et produkt som ikke finnes i listen nedenfor, skal du tydelig informere om at Seveno Nettbutikk ikke fører dette produktet akkurat nå, og henvise til kundeservice på /kontakt.',
      '4. Hold svarene korte, oversiktlige og relevante, og oppgi gjerne lenke på formen /produkt/<slug> når du anbefaler et konkret produkt.',
      '',
      'Butikkvilkår:',
      `- Fri frakt fra ${formatNok(FREE_SHIPPING_THRESHOLD_NOK)}, ellers fast frakt ${formatNok(STANDARD_SHIPPING_NOK)}.`,
      '- Alle priser er oppgitt i NOK inkludert 25 % merverdiavgift (mva).',
      '- Kunder kan fullføre testbestilling i utsjekken (/utsjekk) med klargjorte adaptere for Klarna og Vipps.',
      '- Kundeservice kan kontaktes via kontaktskjemaet på /kontakt.',
      '',
      'Oppdatert produktkatalog fra backend:',
      catalogLines,
    ].join('\n');
  }

  buildSystemInstruction(products: ReadonlyArray<Product>): string {
    return CatalogPromptBuilder.buildSystemInstruction(products);
  }

  static extractReferencedProductIds(
    replyText: string,
    products: ReadonlyArray<Product>,
  ): string[] {
    const normalizedReply = replyText.trim().toLowerCase();
    if (!normalizedReply) {
      return [];
    }

    const referencedIds: string[] = [];
    const seen = new Set<string>();

    for (const product of products) {
      if (product.active !== true || seen.has(product.id)) {
        continue;
      }

      const titleLower = product.title.trim().toLowerCase();
      const slugLower = product.slug.trim().toLowerCase();

      if (
        (titleLower.length > 0 && normalizedReply.includes(titleLower)) ||
        (slugLower.length > 0 && normalizedReply.includes(slugLower))
      ) {
        seen.add(product.id);
        referencedIds.push(product.id);
      }
    }

    return referencedIds;
  }
}
