// App content kept in TypeScript (bot characters, openings, story chapters) stays English in its
// data file; translatable() turns chosen fields into getters that read the reader's language from
// the `content` namespace, falling back to the English. Every field registered here is exported
// to locales/en/content.json (see content.test.ts), which translate_content.py translates.
import i18n, { requireContent } from './index';

// The content namespace is ~150 KB per language: it loads with the first data module that needs it.
void requireContent();

/** Every translatable content string: key → English. */
export const CONTENT_REGISTRY = new Map<string, string | string[]>();

export function translatable<T extends object>(item: T, prefix: string, fields: (keyof T & string)[]): T {
  for (const field of fields) {
    const english = item[field] as unknown;
    if (typeof english !== 'string' && !(Array.isArray(english) && english.every(v => typeof v === 'string'))) continue;
    const key = `${prefix}.${field}`;
    CONTENT_REGISTRY.set(key, english as string | string[]);
    Object.defineProperty(item, field, {
      enumerable: true,
      configurable: true,
      get: () => (Array.isArray(english)
        ? i18n.t(key, { ns: 'content', returnObjects: true, defaultValue: english }) as string[]
        : i18n.t(key, { ns: 'content', defaultValue: english })),
    });
  }
  return item;
}

/** A record of labels (category titles...) whose values follow the language. */
export function translatableRecord<K extends string>(record: Record<K, string>, prefix: string): Record<K, string> {
  return translatable(record, prefix, Object.keys(record) as (K & string)[]);
}
