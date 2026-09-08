import { isTauri } from '@/lib/api'

/**
 * Register the service worker (production web builds only — Tauri ships the
 * same dist inside a webview where a SW adds nothing but risk, and dev runs
 * without one). Updates install silently in the background; an hourly check
 * picks them up in long-lived tabs, and the new version activates on the
 * next launch.
 */
export async function setupPWA(): Promise<void> {
  if (!import.meta.env.PROD) return
  if (isTauri) return
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    return
  }

  const { registerSW } = await import('virtual:pwa-register')
  registerSW({
    immediate: true,
    onRegisteredSW(_url, registration) {
      if (!registration) return
      setInterval(() => void registration.update(), 60 * 60 * 1000)
    },
  })
}
