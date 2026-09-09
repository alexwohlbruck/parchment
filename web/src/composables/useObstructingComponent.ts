import {
  onMounted,
  onUnmounted,
  getCurrentInstance,
  Ref,
  watch,
  ref,
  computed,
} from 'vue'
import { useAppStore, ManualBounds } from '@/stores/app.store'
import { useResizeObserver, useMutationObserver } from '@vueuse/core'

/**
 * Track UI components that obstruct the map canvas so the map service can
 * derive the unobstructed area and adjust its padding/vanishing point.
 *
 * Bounds are tracked via three sources, written to the same manualBounds
 * map in the store so the visibleMapArea computed picks them up:
 *   1. ResizeObserver — fires on layout-affecting size changes.
 *   2. MutationObserver — fires on style/class changes (visibility swaps).
 *   3. requestAnimationFrame loop — runs only while a CSS transition /
 *      animation is in flight, or while a consumer has explicitly called
 *      beginDrag(). Idles otherwise, so no battery drain when static.
 *
 * The rAF path is what keeps the map vanishing point synchronized with
 * transform-based drawer animations (transforms don't trigger ResizeObserver
 * because they're composited, not a layout change).
 *
 * Consumers can pass a `manualBounds` ref to skip auto-tracking entirely
 * and drive bounds themselves, or `boundsTransform` to post-process the
 * auto-tracked rect before it lands in the store (e.g. to cap the bottom
 * sheet's reported height when fully expanded).
 *
 * @param elementRef Optional ref to the element to track (defaults to the
 *   component's root element)
 * @param key Optional unique key for this component
 * @param manualBounds Optional reactive ref of bounds — when set, bypasses
 *   auto-tracking
 * @param enabled Optional reactive ref to toggle tracking on/off
 * @param boundsTransform Optional transform applied to the auto-tracked rect
 *   before storing (has no effect when manualBounds is provided)
 * @returns { beginDrag, endDrag } — drive the rAF loop for pointer drags
 *   that don't produce CSS transition events
 */
export function useObstructingComponent(
  elementRef?: Ref<HTMLElement | null>,
  key?: string,
  manualBounds?: Ref<ManualBounds | null>,
  enabled?: Ref<boolean>,
  boundsTransform?: (rect: ManualBounds) => ManualBounds,
) {
  const appStore = useAppStore()
  const instance = getCurrentInstance()
  const componentElement: Ref<HTMLElement | null> = elementRef || ref(null)
  let trackingId: string | undefined
  let isCurrentlyTracked = false

  // rAF state
  let rafId = 0
  let runningTransitions = 0
  let dragActive = false

  const trackComponent = () => {
    if (!instance?.proxy || isCurrentlyTracked) return

    if (key) {
      appStore.trackObstructingComponentWithKey(key, instance.proxy)
      trackingId = key
    } else {
      trackingId = appStore.trackObstructingComponents(instance.proxy)
    }
    isCurrentlyTracked = true
  }

  const untrackComponent = () => {
    if (!instance?.proxy || !isCurrentlyTracked) return

    appStore.untrackObstructingComponent(instance.proxy)
    if (trackingId) {
      appStore.clearManualBounds(trackingId)
    }
    isCurrentlyTracked = false
    stopRaf()
  }

  // Resolve the tracked ref's current value to an actual DOM element.
  // Vue template refs on components yield the component instance — we need
  // to unwrap `$el` in that case.
  const resolveElement = (): HTMLElement | null => {
    const raw = componentElement.value as unknown
    if (!raw) return null
    if (raw instanceof HTMLElement) return raw
    const maybeVueInstance = raw as { $el?: HTMLElement }
    if (maybeVueInstance.$el instanceof HTMLElement) return maybeVueInstance.$el
    return null
  }

  // Publish bounds derived from the tracked element's current rect.
  const publishAutoBounds = () => {
    if (!isCurrentlyTracked || !trackingId) return
    const el = resolveElement()
    if (!el || typeof el.getBoundingClientRect !== 'function') return

    const rect = el.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) {
      // Element is collapsed / hidden — clear any stale bounds
      appStore.clearManualBounds(trackingId)
      return
    }

    let bounds: ManualBounds = {
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: rect.height,
    }
    if (boundsTransform) bounds = boundsTransform(bounds)
    appStore.updateManualBounds(trackingId, bounds)
  }

  // rAF loop — only runs while a transition/animation is live or a drag is
  // in progress. Self-cancels when both counters reach zero.
  const tick = () => {
    publishAutoBounds()
    if (runningTransitions > 0 || dragActive) {
      rafId = requestAnimationFrame(tick)
    } else {
      rafId = 0
    }
  }
  const startRaf = () => {
    if (rafId !== 0) return
    rafId = requestAnimationFrame(tick)
  }
  const stopRaf = () => {
    if (rafId !== 0) cancelAnimationFrame(rafId)
    rafId = 0
    runningTransitions = 0
    dragActive = false
  }

  const onTransitionRun = () => {
    runningTransitions++
    startRaf()
  }
  const onTransitionEnd = () => {
    runningTransitions = Math.max(0, runningTransitions - 1)
    // Publish the final frame synchronously so post-animation bounds
    // reflect the settled position even if rAF stops this frame.
    publishAutoBounds()
  }

  // Public API for manual drag coordination
  const beginDrag = () => {
    dragActive = true
    startRaf()
  }
  const endDrag = () => {
    dragActive = false
    publishAutoBounds()
  }

  let detachElementListeners: (() => void) | null = null

  const attachElementListeners = (node: HTMLElement) => {
    node.addEventListener('transitionrun', onTransitionRun)
    node.addEventListener('transitionend', onTransitionEnd)
    node.addEventListener('transitioncancel', onTransitionEnd)
    node.addEventListener('animationstart', onTransitionRun)
    node.addEventListener('animationend', onTransitionEnd)
    node.addEventListener('animationcancel', onTransitionEnd)
    detachElementListeners = () => {
      node.removeEventListener('transitionrun', onTransitionRun)
      node.removeEventListener('transitionend', onTransitionEnd)
      node.removeEventListener('transitioncancel', onTransitionEnd)
      node.removeEventListener('animationstart', onTransitionRun)
      node.removeEventListener('animationend', onTransitionEnd)
      node.removeEventListener('animationcancel', onTransitionEnd)
    }
  }

  onMounted(() => {
    if (!instance?.proxy) return

    // If no custom element provided, use the component's root element
    if (!elementRef && instance.proxy.$el) {
      componentElement.value = instance.proxy.$el
    }

    // Set up tracking ID
    trackingId = key || `auto_${Date.now()}_${Math.random()}`

    // Watch enabled state if provided
    if (enabled) {
      watch(
        enabled,
        isEnabled => {
          if (isEnabled) trackComponent()
          else untrackComponent()
        },
        { immediate: true },
      )
    } else {
      trackComponent()
    }

    // If manual bounds are provided, consumer drives bounds entirely.
    if (manualBounds) {
      watch(
        manualBounds,
        bounds => {
          if (!trackingId || !isCurrentlyTracked) return
          if (bounds) appStore.updateManualBounds(trackingId, bounds)
          else appStore.clearManualBounds(trackingId)
        },
        { immediate: true, deep: true },
      )
      return
    }

    // Auto-track via the element. Watch the resolved element so we handle
    // refs that mount later (e.g. drawers rendered through a teleport/portal)
    // as well as refs bound to a Vue component instance (where the DOM node
    // lives at `.$el`).
    const resolvedElementRef = computed(() => resolveElement())
    watch(
      resolvedElementRef,
      (node, prev) => {
        if (prev && detachElementListeners) {
          detachElementListeners()
          detachElementListeners = null
        }
        if (node) {
          attachElementListeners(node)
          publishAutoBounds()
        }
      },
      { immediate: true, flush: 'post' },
    )

    // Layout-affecting size changes (e.g. viewport resize, content reflow)
    useResizeObserver(resolvedElementRef, () => {
      publishAutoBounds()
    })

    // Visibility / class swaps that don't trigger a CSS transition
    useMutationObserver(
      resolvedElementRef,
      () => {
        publishAutoBounds()
      },
      {
        attributes: true,
        attributeFilter: ['style', 'class', 'hidden'],
        childList: false,
      },
    )
  })

  onUnmounted(() => {
    if (!instance?.proxy) return
    if (isCurrentlyTracked) untrackComponent()
    if (detachElementListeners) {
      detachElementListeners()
      detachElementListeners = null
    }
    stopRaf()
  })

  return { beginDrag, endDrag }
}
