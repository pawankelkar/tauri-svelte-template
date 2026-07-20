import i18n from './config'

let tick = $state(0)
i18n.on('languageChanged', () => {
  tick++
})

export function t(key: string, options?: Record<string, unknown>): string {
  void tick
  return i18n.t(key, options)
}
