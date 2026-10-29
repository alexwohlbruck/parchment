// Rich words for the prompts the announcer raises, where the route has more to
// say than the standard phrasing; null hands back to the standard phrasing.

import { maneuverKind } from '@/lib/directions/maneuver'
import type { Announcement } from '../announcements'
import { laneHint, type LanePlan } from '../lanes'
import type { NavRoute, NavStep } from '../nav-route'
import { announcementText, spokenDistance } from '../phrases'
import { chained, departure, richInstruction, type InstructionContext } from './rich-instruction'
import { inline, voiceText, type TFn } from './instruction-text'

export interface RichSource {
  route: NavRoute
  /** The traveller's route distance and speed when the prompt is spoken. */
  from: number
  speed: number
  lanes: ReadonlyMap<number, LanePlan>
  /** The destination is the traveller's saved home. */
  home: boolean
}

function instructionFor(source: RichSource, step: NavStep, then: NavStep | null | undefined) {
  const context: InstructionContext = { from: source.from, speed: source.speed, lanes: source.lanes.get(step.index) }
  const first = richInstruction(source.route, step, context)
  if (!then) return first
  const next = richInstruction(source.route, then, { from: step.startDistance, speed: source.speed, lanes: source.lanes.get(then.index) })
  return chained(first, next, then.startDistance - step.startDistance, source.speed)
}

export function richAnnouncementText(announcement: Announcement, source: RichSource, metric: boolean, t: TFn): string | null {
  switch (announcement.kind) {
    case 'maneuver': {
      const { phase, step, then, distance } = announcement
      if (phase === 'continue') return null
      const text = voiceText(instructionFor(source, step, then), t, { lanes: phase !== 'now' })
      if (phase !== 'now') return t('guidance.voice.in', { distance: spokenDistance(distance, metric, t), action: inline(text) })
      return announcement.pedestrians ? t('guidance.voice.watchPedestrians', { action: text }) : text
    }
    case 'start': {
      const { step, then } = announcement
      const turns = step && maneuverKind(step.instruction) !== 'straight'
      const text = voiceText(turns ? instructionFor(source, step, null) : departure(source.route, step), t, { lanes: false })
      if (!then) return text
      const next = voiceText(instructionFor(source, then, null), t)
      const later = t('guidance.voice.in', { distance: spokenDistance(then.startDistance, metric, t), action: inline(next) })
      return t('guidance.voice.then', { action: text, next: inline(later) })
    }
    case 'arrived':
      return source.home ? voiceText({ action: { kind: 'arrive', side: announcement.side, home: true }, maneuver: 'arrive' }, t) : null
    case 'turn-around': {
      const heading = t(`guidance.voice.headings.${announcement.heading}`)
      return announcement.road
        ? t('guidance.rich.turnAroundAlong', { heading, road: announcement.road })
        : t('guidance.rich.turnAround', { heading })
    }
    default:
      return null
  }
}

/** The standard phrasing, with the lanes to use ahead of a turn. */
function standardText(announcement: Announcement, lanes: ReadonlyMap<number, LanePlan>, metric: boolean, t: TFn): string {
  const text = announcementText(announcement, metric, t)
  const plan = announcement.kind === 'maneuver' && announcement.phase !== 'now' ? lanes.get(announcement.step.index) : undefined
  const hint = plan && laneHint(plan)
  if (!hint) return text
  const which = t(`guidance.voice.lanes.${hint.side}${hint.count > 1 ? 'Many' : ''}`, { n: hint.count })
  return t('guidance.voice.useLanes', { lanes: which, action: text })
}

/** What to say: rich guidance for premium travellers where it has more to say, else the standard phrasing. */
export function speechFor(announcement: Announcement, source: RichSource, premium: boolean, metric: boolean, t: TFn): string {
  return (premium && richAnnouncementText(announcement, source, metric, t)) || standardText(announcement, source.lanes, metric, t)
}
