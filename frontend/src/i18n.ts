import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import HttpApi from 'i18next-http-backend';
import LanguageDetector from 'i18next-browser-languagedetector';

const supportedLngs = ['en', 'ru', 'zh', 'es', 'de', 'fr', 'it', 'ja', 'ko', 'pl', 'pt', 'tr', 'cs', 'hu', 'ro', 'sk'];

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
      caches: ['localStorage'],
    },
    interpolation: {
      escapeValue: false,
    },
    backend: {
      loadPath: '/locales/{{lng}}.json',
    },
    react: {
      useSuspense: false,
    },
  });

export default i18n;
