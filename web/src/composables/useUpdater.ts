/**
 * Tauri desktop app updater: check for updates and install.
 * No-op when not running in Tauri (e.g. web or mobile).
 *
 * @see https://v2.tauri.app/plugin/updater/
 */

import { ref, shallowRef } from 'vue'
import { getIsTauri } from '@/lib/api'
import type { Update } from '@tauri-apps/plugin-updater'
import type { DownloadEvent } from '@tauri-apps/plugin-updater'

const updateAvailable = shallowRef<Update | null>(null)
const checkInProgress = ref(false)
const installInProgress = ref(false)
const checkError = ref<string | null>(null)

export function useUpdater() {
  async function checkForUpdates(): Promise<Update | null> {
    const isTauri = await getIsTauri()
    if (!isTauri) return null

    checkInProgress.value = true
    checkError.value = null
    try {
      const { check } = await import('@tauri-apps/plugin-updater')
      const update = await check()
      updateAvailable.value = update ?? null
      return update
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      checkError.value = message
      updateAvailable.value = null
      return null
    } finally {
      checkInProgress.value = false
    }
  }

  async function installUpdate(onProgress?: (event: DownloadEvent) => void): Promise<void> {
    const update = updateAvailable.value
    if (!update) throw new Error('No update available to install')

    const isTauri = await getIsTauri()
    if (!isTauri) throw new Error('Not running in Tauri')

    installInProgress.value = true
    try {
      const { relaunch } = await import('@tauri-apps/plugin-process')
      await update.downloadAndInstall(onProgress)
      await relaunch()
    } finally {
      installInProgress.value = false
    }
  }

  return {
    updateAvailable,
    checkInProgress,
    installInProgress,
    checkError,
    checkForUpdates,
    installUpdate,
  }
}
