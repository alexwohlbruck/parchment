// Words for an announcement. `t` is the app's i18n function, passed in so the
// builder stays testable and framework-free.

import { maneuverKind } from '@/lib/directions/maneuver'
import type { RouteInstruction } from '@/types/directions.types'
import type { Announcement } from './announcements'
import { bannerDistance } from './guidance-display'
import type { Handoff } from './handoff'
import { formatDurationLong } from '@/lib/time-format'
import { inline } from './instructions/instruction-text'

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

function maneuverPhrase(instruction: RouteInstruction, t: TFn): string {
  const kind = maneuverKind(instruction)
  if (kind === 'board') return t('guidance.voice.maneuvers.boardAt', { stop: instruction.streetName ?? '' })
  const action = kind === 'roundabout' && instruction.exitNumber
    ? t('guidance.voice.maneuvers.roundaboutExit', { exit: instruction.exitNumber })
    : t(`guidance.voice.maneuvers.${kind}`)
  const road = instruction.streetName || instruction.streetRef
  return road ? t('guidance.voice.onto', { action, road }) : action
}

/** The words on the handoff card, which are also what's spoken. */
export function handoffText(handoff: Handoff, t: TFn): string {
  const duration = formatDurationLong(handoff.nextDuration)
  const mode = t(`guidance.handoff.modes.${handoff.nextMode === 'biking' ? 'cycling' : handoff.nextMode}`)
  const place = handoff.nextEnd
  const base = t(`guidance.handoff.${handoff.kind}`, { station: handoff.station ?? '', mode })
  const then = place
    ? t('guidance.handoff.thenTo', { mode, duration, place })
    : t('guidance.handoff.then', { mode, duration })
  return `${base}, ${then}`
}

export function announcementText(announcement: Announcement, metric: boolean, t: TFn): string {
  switch (announcement.kind) {
    case 'start': {
      const heading = t(`guidance.voice.headings.${announcement.heading}`)
      const action = announcement.step && maneuverKind(announcement.step.instruction) !== 'straight'
        ? maneuverPhrase(announcement.step.instruction, t)
        : announcement.road
          ? t('guidance.voice.headOn', { heading, road: announcement.road })
          : t('guidance.voice.head', { heading })
      if (!announcement.then) return action
      const next = t('guidance.voice.in', {
        distance: spokenDistance(announcement.then.startDistance, metric, t),
        action: inline(maneuverPhrase(announcement.then.instruction, t)),
      })
      return t('guidance.voice.then', { action, next: inline(next) })
    }
    case 'reroute':
      return t('guidance.voice.rerouting')
    case 'turn-around': {
      const heading = t(`guidance.voice.headings.${announcement.heading}`)
      return announcement.road
        ? t('guidance.voice.turnAroundOn', { heading, road: announcement.road })
        : t('guidance.voice.turnAround', { heading })
    }
    case 'dock-switch':
      return t('guidance.docks.voice.switched', { station: announcement.station })
    case 'hazard':
      return t(`guidance.voice.hazards.${announcement.hazard.kind}`)
    case 'handoff':
      return handoffText(announcement.handoff, t)
    case 'transit': {
      const { event, line, headsign, stop } = announcement
      if (event === 'wait') {
        return headsign ? t('guidance.transit.voice.boardToward', { line, headsign }) : t('guidance.transit.voice.board', { line })
      }
      return t(`guidance.transit.voice.${event}`, { line, stop })
    }
    case 'border':
      return t('guidance.voice.welcome', { region: announcement.region })
    case 'vehicle-question':
      return t(`guidance.transit.whichVehicle.${announcement.vehicle}`)
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
        const spoken = then ? t('guidance.voice.then', { action, next: inline(maneuverPhrase(then.instruction, t)) }) : action
        return announcement.pedestrians ? t('guidance.voice.watchPedestrians', { action: spoken }) : spoken
      }
      return t('guidance.voice.in', { distance: spokenDistance(distance, metric, t), action: inline(action) })
    }
  }
}
