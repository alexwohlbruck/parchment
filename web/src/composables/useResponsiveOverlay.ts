import { ref, watch, type Ref } from 'vue'
import { useResponsive } from '@/lib/utils'

/**
 * Common props shared by all responsive overlay components
 */
export interface ResponsiveOverlayBaseProps {
  open?: boolean
  showDragHandle?: boolean
  showCloseButton?: boolean
  peekHeight?: number | string
  customSnapPoints?: (number | string)[]
}

/**
 * Props for positioning (used by Popover, Dropdown, HoverCard)
 */
export interface ResponsiveOverlayPositionProps {
  align?: 'start' | 'center' | 'end'
  side?: 'top' | 'right' | 'bottom' | 'left'
  sideOffset?: number
}

/**
 * Props for title/description (used by Dialog, Dropdown)
 */
export interface ResponsiveOverlayTitleProps {
  title?: string
  description?: string
}

/**
 * Default values for base props
 */
export const responsiveOverlayBaseDefaults = {
  showDragHandle: true,
  showCloseButton: true,
} as const

/**
 * Default values for position props
 */
export const responsiveOverlayPositionDefaults = {
  align: 'center' as const,
  side: 'bottom' as const,
  sideOffset: 0,
}

export interface UseResponsiveOverlayOptions {
  /** Initial open state from props */
  open?: boolean
  /** Emit function from the component */
  emit: (event: 'update:open', value: boolean) => void
  /** Whether to clean up body styles on close (for vaul-vue workaround) */
  cleanupBodyStyles?: boolean
}

export interface UseResponsiveOverlayReturn {
  /** Whether the current screen is mobile */
  isMobileScreen: Ref<boolean>
  /** Internal open state (reactive) */
  internalOpen: Ref<boolean>
  /** Handler for open state changes */
  handleOpenChange: (value: boolean) => void
  /** Open the overlay */
  open: () => void
  /** Close the overlay */
  close: () => void
}

/**
 * Composable for shared responsive overlay logic.
 * Handles open state management, prop syncing, and mobile detection.
 */
export function useResponsiveOverlay(
  options: UseResponsiveOverlayOptions,
): UseResponsiveOverlayReturn {
  const { emit, cleanupBodyStyles = false } = options
  const { isMobileScreen } = useResponsive()
  const internalOpen = ref(options.open ?? false)

  // Watch for external prop changes
  watch(
    () => options.open,
    newValue => {
      if (newValue !== undefined) {
        internalOpen.value = newValue
      }
    },
  )

  // Emit changes to parent
  watch(internalOpen, newValue => {
    emit('update:open', newValue)
  })

  function handleOpenChange(value: boolean) {
    internalOpen.value = value

    // Clean up body styles that vaul-vue sets.
    // This prevents reka-ui dialogs from capturing stale
    // body styles and restoring them when the dialog closes.
    if (cleanupBodyStyles) {
      document.body.style.overflow = ''
      document.body.style.pointerEvents = ''
    }
  }

  function open() {
    handleOpenChange(true)
  }

  function close() {
    handleOpenChange(false)
  }

  return {
    isMobileScreen,
    internalOpen,
    handleOpenChange,
    open,
    close,
  }
}

/**
 * Compute snap points from props
 */
export function computeSnapPoints(
  customSnapPoints?: (number | string)[],
  peekHeight?: number | string,
): (number | string)[] {
  return customSnapPoints || [peekHeight ?? '250px', 0.5, 1]
}

