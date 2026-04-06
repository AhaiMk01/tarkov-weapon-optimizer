import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import HttpApi from 'i18next-http-backend';
import LanguageDetector from 'i18next-browser-languagedetector';

declare const __BUILD_TIME__: string;

const supportedLngs = ['en', 'ru', 'zh', 'es', 'de', 'fr', 'it', 'ja', 'ko', 'pl', 'pt', 'tr', 'cs', 'hu', 'ro', 'sk'];

const LANG_STORAGE_KEY = 'lang';

/** Prefer `lang`; copy from legacy `i18nextLng` once if present. */
function migrateLangLocalStorage() {
  if (typeof window === 'undefined') return;
  try {
    if (localStorage.getItem(LANG_STORAGE_KEY)) return;
    const legacy = localStorage.getItem('i18nextLng');
    if (!legacy) return;
    const code = legacy.replace(/^["']|["']$/g, '').split('-')[0];
    if (supportedLngs.includes(code)) {
      localStorage.setItem(LANG_STORAGE_KEY, code);
    }
  } catch {
    /* ignore */
  }
}

migrateLangLocalStorage();

i18n
  .use(HttpApi)
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    supportedLngs,
    fallbackLng: 'en',
    load: 'languageOnly',
    debug: false,
    detection: {
      order: ['localStorage', 'navigator'],
      lookupLocalStorage: LANG_STORAGE_KEY,
      caches: ['localStorage'],
    },
    interpolation: {
      escapeValue: false,
    },
    backend: {
      loadPath: `${import.meta.env.BASE_URL}locales/{{lng}}.json?v=${__BUILD_TIME__}`,
    },
    react: {
      useSuspense: false,
    },
  });

export default i18n;
