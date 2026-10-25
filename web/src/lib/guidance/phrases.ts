// Words for an announcement. `t` is the app's i18n function, passed in so the
// builder stays testable and framework-free.

import { maneuverKind } from '@/lib/directions/maneuver'
import type { RouteInstruction } from '@/types/directions.types'
import type { Announcement } from './announcements'
import { bannerDistance } from './guidance-display'

type TFn = (key: string, named?: Record<string, unknown>) => string

const SPOKEN_UNITS = {
  ft: ['feet', 'feet'],
  mi: ['mile', 'miles'],
  m: ['meters', 'meters'],
  km: ['kilometer', 'kilometers'],
} as const

export function spokenDistance(meters: number, metric: boolean, t: TFn): string {
  const { value, unit } = bannerDistance(meters, metric)
  const [one, many] = SPOKEN_UNITS[unit]
  return t(`guidance.voice.units.${Number(value) === 1 ? one : many}`, { value })
}

/** An action read mid-sentence: "In 500 feet, turn right". */
function inline(action: string): string {
  return action.charAt(0).toLowerCase() + action.slice(1)
}

function maneuverPhrase(instruction: RouteInstruction, t: TFn): string {
  const kind = maneuverKind(instruction)
  const action = kind === 'roundabout' && instruction.exitNumber
    ? t('guidance.voice.maneuvers.roundaboutExit', { exit: instruction.exitNumber })
    : t(`guidance.voice.maneuvers.${kind}`)
  const road = instruction.streetName || instruction.streetRef
  return road ? t('guidance.voice.onto', { action, road }) : action
}

export function announcementText(announcement: Announcement, metric: boolean, t: TFn): string {
  switch (announcement.kind) {
    case 'reroute':
      return t('guidance.voice.rerouting')
    case 'arrived':
      return announcement.side
        ? t(`guidance.voice.arrivedSide.${announcement.side}`)
        : t('guidance.voice.arrived')
    case 'arrive': {
      const distance = spokenDistance(announcement.distance, metric, t)
      return announcement.side
        ? t(`guidance.voice.arriveSide.${announcement.side}`, { distance })
        : t('guidance.voice.arrive', { distance })
    }
    case 'maneuver': {
      const { phase, step, distance, then } = announcement
      if (phase === 'continue') {
        const road = step.instruction.streetName || step.instruction.streetRef
        const length = spokenDistance(distance, metric, t)
        return road ? t('guidance.voice.continueOn', { road, distance: length }) : t('guidance.voice.continue', { distance: length })
      }
      const action = maneuverPhrase(step.instruction, t)
      if (phase === 'now') {
        return then ? t('guidance.voice.then', { action, next: inline(maneuverPhrase(then.instruction, t)) }) : action
      }
      return t('guidance.voice.in', { distance: spokenDistance(distance, metric, t), action: inline(action) })
    }
  }
}
