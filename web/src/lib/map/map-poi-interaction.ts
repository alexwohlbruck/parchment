/** The gesture window Mapbox and MapLibre use for double-tap zoom. */
export const POI_DOUBLE_TAP_MS = 500

/** Both map engines require the two taps to land within 30px. */
export const POI_DOUBLE_TAP_RADIUS_PX = 30

type Point = { x: number; y: number }

export type PoiPointerEvent = {
  point: Point
  originalEvent?: Event & {
    sourceCapabilities?: { firesTouchEvents?: boolean } | null
  }
}

type CompletedTouch = {
  point: Point
  time: number
  suppress: boolean
}

function distance(a: Point, b: Point) {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

/**
 * Reference-counted POI policy. Each consumer receives its own release
 * function, so nested consumers cannot accidentally re-enable POI actions.
 */
export class MapPoiClickPolicy {
  private blockers = new Set<symbol>()
  private suppressListeners = new Set<() => void>()

  get enabled() {
    return this.blockers.size === 0
  }

  suppress() {
    const token = Symbol('map-poi-click-suppression')
    this.blockers.add(token)
    this.suppressListeners.forEach(listener => listener())

    let released = false
    return () => {
      if (released) return
      released = true
      this.blockers.delete(token)
    }
  }

  onSuppress(listener: () => void) {
    this.suppressListeners.add(listener)
    return () => this.suppressListeners.delete(listener)
  }
}

export const mapPoiClickPolicy = new MapPoiClickPolicy()

/**
 * Resolves native POI clicks into mouse clicks or single-finger taps.
 * Browsers synthesize a click after the first touch ends. We retain that click
 * for the engines' double-tap window and cancel it when a nearby second touch
 * begins. Mouse clicks stay immediate.
 */
export class PoiTapController {
  private currentTouch: {
    point: Point
    startedAt: number
    moved: boolean
    suppress: boolean
  } | null = null
  private lastTap: CompletedTouch | null = null
  private completedTouch: CompletedTouch | null = null
  private pendingAction: ReturnType<typeof setTimeout> | null = null
  private handledEvents = new WeakSet<Event>()
  private removeSuppressListener: () => void

  constructor(
    private element: HTMLElement,
    private policy: MapPoiClickPolicy = mapPoiClickPolicy,
  ) {
    element.addEventListener('touchstart', this.onTouchStart, { passive: true })
    element.addEventListener('touchmove', this.onTouchMove, { passive: true })
    element.addEventListener('touchend', this.onTouchEnd, { passive: true })
    element.addEventListener('touchcancel', this.onTouchCancel, { passive: true })
    this.removeSuppressListener = policy.onSuppress(() => this.cancelPending())
  }

  handle(
    event: PoiPointerEvent,
    action: () => void,
    prefetch?: () => void,
  ): boolean {
    if (!this.policy.enabled) {
      this.cancelPending()
      return false
    }

    const originalEvent = event.originalEvent
    if (originalEvent && this.handledEvents.has(originalEvent)) return true

    const touch = this.touchForClick(event)
    if (!touch) {
      action()
      if (originalEvent) this.handledEvents.add(originalEvent)
      return true
    }

    if (originalEvent) this.handledEvents.add(originalEvent)
    if (touch.suppress) return true

    prefetch?.()
    this.cancelPending()
    const elapsed = Math.max(
      0,
      (originalEvent?.timeStamp ?? touch.time) - touch.time,
    )
    this.pendingAction = setTimeout(() => {
      this.pendingAction = null
      if (this.policy.enabled) action()
    }, Math.max(0, POI_DOUBLE_TAP_MS - elapsed))
    return true
  }

  cancelPending() {
    if (this.pendingAction) clearTimeout(this.pendingAction)
    this.pendingAction = null
  }

  destroy() {
    this.cancelPending()
    this.removeSuppressListener()
    this.element.removeEventListener('touchstart', this.onTouchStart)
    this.element.removeEventListener('touchmove', this.onTouchMove)
    this.element.removeEventListener('touchend', this.onTouchEnd)
    this.element.removeEventListener('touchcancel', this.onTouchCancel)
  }

  private relativePoint(touch: Touch): Point {
    const rect = this.element.getBoundingClientRect()
    return { x: touch.clientX - rect.left, y: touch.clientY - rect.top }
  }

  private onTouchStart = (event: TouchEvent) => {
    if (event.touches.length !== 1) {
      this.cancelPending()
      this.currentTouch = null
      this.lastTap = null
      return
    }

    const point = this.relativePoint(event.touches[0])
    const isSecondTap = !!this.lastTap
      && event.timeStamp - this.lastTap.time < POI_DOUBLE_TAP_MS
      && distance(point, this.lastTap.point) < POI_DOUBLE_TAP_RADIUS_PX

    if (isSecondTap) this.cancelPending()
    this.currentTouch = {
      point,
      startedAt: event.timeStamp,
      moved: false,
      suppress: isSecondTap,
    }
  }

  private onTouchMove = (event: TouchEvent) => {
    if (!this.currentTouch || event.touches.length !== 1) return
    const point = this.relativePoint(event.touches[0])
    if (distance(point, this.currentTouch.point) >= POI_DOUBLE_TAP_RADIUS_PX) {
      this.currentTouch.moved = true
    }
  }

  private onTouchEnd = (event: TouchEvent) => {
    if (!this.currentTouch || event.touches.length !== 0) return

    const validTap = !this.currentTouch.moved
      && event.timeStamp - this.currentTouch.startedAt <= POI_DOUBLE_TAP_MS
    const completed: CompletedTouch = {
      point: this.currentTouch.point,
      time: event.timeStamp,
      suppress: this.currentTouch.suppress || !validTap,
    }

    this.completedTouch = completed
    this.lastTap = validTap && !completed.suppress ? completed : null
    this.currentTouch = null
  }

  private onTouchCancel = () => {
    this.cancelPending()
    this.currentTouch = null
    this.lastTap = null
    this.completedTouch = null
  }

  private touchForClick(event: PoiPointerEvent): CompletedTouch | null {
    const touch = this.completedTouch
    if (!touch) return null

    const elapsed = (event.originalEvent?.timeStamp ?? touch.time) - touch.time
    if (elapsed < 0 || elapsed > POI_DOUBLE_TAP_MS) return null

    const explicitlyFromTouch = !!event.originalEvent?.sourceCapabilities
      ?.firesTouchEvents
    if (
      !explicitlyFromTouch
      && distance(event.point, touch.point) >= POI_DOUBLE_TAP_RADIUS_PX
    ) {
      return null
    }
    return touch
  }
}
