import i18n from 'i18next'
import en from '../../../locales/en.json'
import fr from '../../../locales/fr.json'

const resources = {
  en: { translation: en },
  fr: { translation: fr },
}

/**
 * Display names for the language picker, written in their own language.
 *
 * Adding a locale is a one-file change: import its JSON, add it to `resources`,
 * and add its label here. A unit test asserts the two stay in sync.
 */
export const languageLabels: Record<string, string> = {
  en: 'English',
  fr: 'Français',
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
