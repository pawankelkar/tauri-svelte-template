import i18n from 'i18next'
import en from '../../../locales/en.json'

const resources = {
  en: { translation: en },
}

const rtlLanguages = ['ar', 'he', 'fa', 'ur']

i18n.init({
  resources,
  lng: 'en',
  fallbackLng: 'en',
  interpolation: {
    escapeValue: false,
  },
})

i18n.on('languageChanged', (lng) => {
  const dir = rtlLanguages.includes(lng) ? 'rtl' : 'ltr'
  document.documentElement.dir = dir
  document.documentElement.lang = lng
})

export default i18n
export { i18n }
export const availableLanguages = Object.keys(resources)
export const isRTL = (lng: string): boolean => rtlLanguages.includes(lng)
