import type { TransitStage } from './transit-progress'

/** Waiting for or riding a vehicle: there are no turns to show. */
export function isAboard(stage: TransitStage | null): boolean {
  return stage != null && stage.kind !== 'to-stop'
}

/** Closing a panel opened from the menu goes back to the menu; anything else closes outright. */
export function panelAfterClose<P extends string>(current: P | null, openedFrom: P | null, menu: P): P | null {
  return current !== menu && openedFrom === menu ? menu : null
}
