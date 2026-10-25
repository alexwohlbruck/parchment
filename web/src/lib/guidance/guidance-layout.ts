import type { Rect } from '@/lib/map/map-padding'
import type { TransitStage } from './transit-progress'

/** Waiting for or riding a vehicle: there are no turns to show. */
export function isAboard(stage: TransitStage | null): boolean {
  return stage != null && stage.kind !== 'to-stop'
}

/**
 * The part of a bottom-anchored card that covers the map at rest. An expanded
 * card grows upward over the map without moving the camera, so its extra
 * height is taken back off the top. Rounded, so a card animating open
 * publishes the same rect every frame.
 */
export function restingFootprint(rect: Rect, expandedBy: number): Rect {
  const extra = Math.min(Math.max(0, expandedBy), rect.height)
  return {
    x: Math.round(rect.x),
    y: Math.round(rect.y + extra),
    width: Math.round(rect.width),
    height: Math.round(rect.height - extra),
  }
}

/** Closing a panel opened from the menu goes back to the menu; anything else closes outright. */
export function panelAfterClose<P extends string>(current: P | null, openedFrom: P | null, menu: P): P | null {
  return current !== menu && openedFrom === menu ? menu : null
}
