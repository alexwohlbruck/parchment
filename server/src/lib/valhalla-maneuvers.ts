/**
 * Valhalla maneuver-type translation.
 *
 * Valhalla reports maneuvers as a numeric enum. Two code paths consume it —
 * the direct Valhalla integration and the Barrelman-proxied adapter — and they
 * previously carried separate copies of the table that had drifted apart: one
 * listed `case 4` twice, so its `'destination'` branch was unreachable and
 * arrival was reported as an ordinary turn (the client keys its flag icon off
 * `'destination'`, so the arrival marker never rendered).
 *
 * One table, one meaning per code.
 */

export type ManeuverModifier =
  | 'left'
  | 'right'
  | 'straight'
  | 'slight-left'
  | 'slight-right'
  | 'u-turn'

/** Broad instruction category for a Valhalla maneuver type. */
export function mapManeuverType(type: number): string {
  switch (type) {
    case 0:
      return 'none'
    case 1:
      return 'start'
    case 2:
      return 'start-right'
    case 3:
      return 'start-left'
    case 4:
      return 'destination'
    case 5:
      return 'destination-right'
    case 6:
      return 'destination-left'
    case 7:
    case 8:
    case 9:
    case 10:
    case 11:
    case 12:
    case 13:
    case 14:
      return 'turn'
    case 15:
    case 16:
    case 17:
      return 'continue'
    case 18:
    case 19:
    case 20:
    case 21:
    case 22:
    case 23:
      return 'ramp'
    case 24:
      return 'exit'
    case 25:
    case 26:
    case 27:
    case 28:
      return 'roundabout'
    case 29:
      return 'ferry'
    case 30:
      return 'transit'
    case 31:
      return 'transit-connection'
    case 32:
      return 'transit-remain'
    case 33:
      return 'transit-transfer'
    case 37:
      return 'merge'
    default:
      return 'continue'
  }
}

/** Turn direction for the maneuver types that have one. */
export function mapManeuverModifier(type: number): ManeuverModifier | undefined {
  switch (type) {
    case 8: // kRight
    case 10: // kSharpRight
      return 'right'
    case 9: // kSlightRight
      return 'slight-right'
    case 11: // kUturnRight
    case 12: // kUturnLeft
      return 'u-turn'
    case 13: // kSharpLeft
    case 14: // kLeft
      return 'left'
    case 7: // kSlightLeft
      return 'slight-left'
    case 15: // kContinue
    case 16: // kContinueStraight
      return 'straight'
    default:
      return undefined
  }
}
