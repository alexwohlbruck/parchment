import { ref, onMounted, onUnmounted } from 'vue'
import { getIsTauri } from '@/lib/api'

/**
 * Composable for detecting fullscreen mode in Tauri applications.
 * Returns a reactive ref indicating whether the window is in fullscreen mode.
 */
export function useFullscreen() {
  const isFullscreen = ref(false)

  let unlisten: (() => void) | null = null

  onMounted(async () => {
    const isTauri = await getIsTauri()

    if (!isTauri) {
      return
    }

    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window')
      const appWindow = getCurrentWindow()

      // Helper function to update fullscreen state
      const updateFullscreenState = async () => {
        try {
          isFullscreen.value = await appWindow.isFullscreen()
        } catch (error) {
          console.error('Failed to check fullscreen state:', error)
        }
      }

      // Get initial fullscreen state
      await updateFullscreenState()

      // Listen for resize events - fullscreen changes trigger resize events
      // This is the most reliable way to detect fullscreen changes in Tauri v2
      unlisten = await appWindow.onResized(async () => {
        await updateFullscreenState()
      })
    } catch (error) {
      console.error('Failed to setup fullscreen detection:', error)
    }
  })

  onUnmounted(() => {
    if (unlisten) {
      unlisten()
      unlisten = null
    }
  })

  return {
    isFullscreen,
  }
}
