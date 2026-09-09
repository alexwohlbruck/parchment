import { openUrl } from '@tauri-apps/plugin-opener'
import { getIsTauri } from '@/lib/api'

/**
 * Composable for handling external links in Tauri applications.
 * Opens URLs in the default browser when running in Tauri,
 * falls back to window.open in web environments.
 */
export function useExternalLink() {
  const openExternalLink = async (url: string, target?: string) => {
    // Validate URL
    if (!url) {
      console.warn('useExternalLink: No URL provided')
      return
    }

    // Check if we're in Tauri environment
    const isTauri = await getIsTauri()

    if (isTauri) {
      try {
        // Use Tauri opener plugin to open in default browser
        await openUrl(url)
      } catch (error) {
        console.error('Failed to open URL with Tauri opener:', error)
        // Fallback to window.open if opener fails
        window.open(url, target || '_blank', 'noopener,noreferrer')
      }
    } else {
      // Web environment - use standard window.open
      window.open(url, target || '_blank', 'noopener,noreferrer')
    }
  }

  return {
    openExternalLink,
  }
}

