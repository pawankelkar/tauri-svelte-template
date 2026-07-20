import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from '@tauri-apps/plugin-notification'
import { toast } from '$lib/stores/toast'
import { t } from '$lib/i18n/t.svelte'
import { registerCommands, type AppCommand } from './registry.svelte'

export const DEMO_SEND_NOTIFICATION = 'demo-send-notification'

/**
 * Demo for tauri-plugin-notification.
 *
 * Notifications need an OS-level permission that has to be requested at least
 * once, so the real work here is the permission dance rather than the send.
 */
async function sendDemoNotification(): Promise<void> {
  let granted = await isPermissionGranted()

  if (!granted) {
    granted = (await requestPermission()) === 'granted'
  }

  if (!granted) {
    toast.error(t('demo.notificationDenied'))
    return
  }

  sendNotification({
    title: t('demo.notificationTitle'),
    body: t('demo.notificationBody'),
  })
}

const notificationCommands: AppCommand[] = [
  {
    id: DEMO_SEND_NOTIFICATION,
    labelKey: 'commands.demoSendNotification',
    category: 'commands.category.demo',
    run: sendDemoNotification,
  },
]

export function registerNotificationCommands(): void {
  registerCommands(notificationCommands)
}
