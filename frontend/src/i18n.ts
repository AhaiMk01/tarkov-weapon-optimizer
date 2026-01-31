import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import HttpApi from 'i18next-http-backend';

const supportedLngs = ['en', 'ru', 'zh', 'es', 'de', 'fr', 'it', 'ja', 'ko', 'pl', 'pt', 'tr', 'cs', 'hu', 'ro', 'sk'];

i18n
  .use(HttpApi)
  .use(initReactI18next)
  .init({
    supportedLngs,
    fallbackLng: 'en',
    debug: false,
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
