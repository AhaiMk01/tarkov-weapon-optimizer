// The reference world built from the pinned raw documents (hash-verified by pins.ts).
import { loadPinnedDocument } from './pins';
import { buildWorld, parseRawDocuments } from './rawReader';
import type { RawDocuments, RawTexts, RawWorld } from './rawReader';

export interface PinnedWorld {
  readonly lang: string;
  /** Plain parsed JSON, kept for raw-field audits that must not depend on reader strictness. */
  readonly docs: RawDocuments;
  readonly world: RawWorld;
}

/** Pinned languages: English is the adapter's fallback; Chinese exercises the full chain. */
export type PinnedLang = 'en' | 'zh';

export function pinnedTexts(lang: PinnedLang): RawTexts {
  const base: RawTexts = {
    items: loadPinnedDocument('items').text,
    itemsEn: loadPinnedDocument('items_en').text,
    barters: loadPinnedDocument('barters').text,
    traders: loadPinnedDocument('traders').text,
    tradersEn: loadPinnedDocument('traders_en').text,
  };
  if (lang === 'en') return base;
  return {
    ...base,
    itemsLang: loadPinnedDocument(`items_${lang}`).text,
    tradersLang: loadPinnedDocument(`traders_${lang}`).text,
  };
}

const cache = new Map<PinnedLang, PinnedWorld>();

export function loadPinnedWorld(lang: PinnedLang = 'en'): PinnedWorld {
  const cached = cache.get(lang);
  if (cached) return cached;
  const docs = parseRawDocuments(pinnedTexts(lang), lang);
  const loaded: PinnedWorld = { lang, docs, world: buildWorld(docs, lang) };
  cache.set(lang, loaded);
  return loaded;
}
