import { locale } from '@tauri-apps/plugin-os'
import i18n, { availableLanguages } from './config'

export async function initializeLanguage(
  savedLanguage: string | null,
): Promise<void> {
  try {
    if (savedLanguage) {
      if (availableLanguages.includes(savedLanguage)) {
        await i18n.changeLanguage(savedLanguage)
      } else {
        await i18n.changeLanguage('en')
      }
      return
    }

    const systemLocale = await locale()

    if (systemLocale) {
      const parts = systemLocale.split('-')
      const langCode = (parts[0] ?? 'en').toLowerCase()

      if (availableLanguages.includes(langCode)) {
        await i18n.changeLanguage(langCode)
        return
      }
    }

    await i18n.changeLanguage('en')
  } catch {
    await i18n.changeLanguage('en')
  }
}
