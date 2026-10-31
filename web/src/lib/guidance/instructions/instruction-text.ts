// Words for a structured instruction: the full spoken form, and the short
// banner forms. `t` is the app's i18n function, passed in to stay testable.

import type { ManeuverKind } from '@/lib/directions/maneuver'
import type { RoadLabel } from '../guidance-display'
import type { Action, Anchor, LaneAdvice, RichInstruction } from './instruction.types'

export type TFn = (key: string, named?: Record<string, unknown>) => string

const K = 'guidance.rich'
const MAX_ORDINAL = 8
const ONTO = new Set<Action['kind']>(['turn', 'end-of-road', 'fork', 'roundabout'])
const SIGNPOSTED = new Set<Action['kind']>(['fork', 'stay', 'exit'])
const TURNS = new Set<ManeuverKind>(['left', 'right', 'slight-left', 'slight-right', 'sharp-left', 'sharp-right', 'uturn'])

/** An action read mid-sentence: "In 500 feet, turn right". */
export function inline(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1)
}

/** "second", or in Spanish "segundo"/"segunda" by the noun's gender. */
function ordinal(n: number, gender: 'm' | 'f', t: TFn): string | null {
  return n >= 1 && n <= MAX_ORDINAL ? t(`${K}.ordinals.${gender}.${n}`) : null
}

function roadText(road: RoadLabel, t: TFn): string {
  return road.kind === 'named' ? road.name : t(`${K}.roads.${road.key}`)
}

function baseAction(action: Action, maneuver: ManeuverKind, t: TFn): string {
  switch (action.kind) {
    case 'turn':
    case 'stay':
      return t(`guidance.voice.maneuvers.${maneuver}`)
    case 'fork':
      return t(`${K}.fork.${action.side}`)
    case 'end-of-road':
      return t(`${K}.endOfRoad.${action.side}`)
    case 'exit':
      return action.number ? t(`${K}.exitNumber`, { number: action.number }) : t(`${K}.exit.${action.side}`)
    case 'roundabout': {
      if (action.through) return t(`${K}.roundaboutThrough`)
      if (action.exit == null) return t('guidance.voice.maneuvers.roundabout')
      const nth = ordinal(action.exit, 'f', t)
      return nth ? t(`${K}.roundabout`, { ordinal: nth }) : t(`${K}.roundaboutExit`, { exit: action.exit })
    }
    case 'stairs':
      return t(`${K}.stairs.${action.side ?? 'ahead'}`)
    case 'footbridge':
      return t(`${K}.footbridge`)
    case 'crosswalk': {
      const key = action.signals ? 'crosswalkSignals' : 'crosswalk'
      return action.road ? t(`${K}.${key}Road`, { road: action.road }) : t(`${K}.${key}`)
    }
    case 'arrive':
      if (action.home) return t(action.side ? `${K}.homeSide.${action.side}` : `${K}.home`)
      return action.side ? t(`guidance.voice.arrivedSide.${action.side}`) : t('guidance.voice.arrived')
    case 'depart':
      return t(`guidance.voice.head`, { heading: t(`guidance.voice.headings.${action.heading}`) })
  }
}

/** The instruction itself, with its road and signs: "Take exit 12 toward Brooklyn". */
export function actionText(instruction: RichInstruction, t: TFn): string {
  const { action, maneuver, target, toward } = instruction
  const road = target && roadText(target, t)
  if (action.kind === 'depart' && road) {
    const heading = t(`guidance.voice.headings.${action.heading}`)
    return t(action.along ? `${K}.headAlong` : 'guidance.voice.headOn', { heading, road })
  }
  if (instruction.park && action.kind === 'turn') {
    const park = instruction.park.name
    if (maneuver === 'straight') return park ? t(`${K}.enterPark`, { park }) : t(`${K}.enterParkUnnamed`)
    const base = baseAction(action, maneuver, t)
    return park ? t(`${K}.intoPark`, { action: base, park }) : t(`${K}.intoParkUnnamed`, { action: base })
  }
  if (action.kind === 'turn' && maneuver === 'straight' && target?.kind === 'generic') return t(`${K}.followPath`)
  if (action.kind === 'stay' && road) return t(`${K}.stay`, { action: baseAction(action, maneuver, t), road })
  if (toward && SIGNPOSTED.has(action.kind)) {
    if (action.kind === 'exit') return t(`${K}.toward`, { action: baseAction(action, maneuver, t), destination: toward })
    return t(`${K}.followSigns`, { action: t(`guidance.voice.maneuvers.${maneuver}`), destination: toward })
  }
  const base = baseAction(action, maneuver, t)
  const onto = road && ONTO.has(action.kind) && !(action.kind === 'roundabout' && action.through)
  if (onto) return t('guidance.voice.onto', { action: base, road })
  return toward && action.kind === 'turn' ? t(`${K}.toward`, { action: base, destination: toward }) : base
}

function lanesText(lanes: LaneAdvice, t: TFn): string {
  if (lanes.kind === 'lane') {
    return lanes.ordinal === 1 ? t(`${K}.lanes.edge.${lanes.from}`) : t(`${K}.lanes.nth.${lanes.from}`, { ordinal: ordinal(lanes.ordinal, 'm', t) })
  }
  if (lanes.side === 'middle') return t(lanes.count > 1 ? `${K}.lanes.middleMany` : `${K}.lanes.middle`, { n: lanes.count })
  return t(lanes.count === 2 ? `${K}.lanes.either.${lanes.side}` : `${K}.lanes.any.${lanes.side}`, { n: lanes.count })
}

/** The action as an infinitive, for "Use the right lane to turn right". */
function infinitive(instruction: RichInstruction, t: TFn): string | null {
  const { action, maneuver, target } = instruction
  if (!['turn', 'fork', 'end-of-road', 'stay', 'exit'].includes(action.kind) || maneuver === 'arrive') return null
  const base = t(action.kind === 'exit' ? `${K}.infinitive.exit` : `${K}.infinitive.${maneuver}`)
  return target && ONTO.has(action.kind) ? t('guidance.voice.onto', { action: base, road: roadText(target, t) }) : base
}

/** The landmark on its own, as the banner shows it: "At the second light". */
export function anchorText(anchor: Anchor, t: TFn): string {
  if (anchor.relation === 'at' && anchor.kind === 'traffic_signals' && (anchor.ordinal ?? 1) > 1) {
    return t(`${K}.anchors.atOrdinal`, { ordinal: ordinal(anchor.ordinal!, 'm', t) })
  }
  return t(`${K}.anchors.${anchor.relation}.${anchor.kind}`)
}

export interface VoiceOptions {
  /** Lane advice is for the approach; at the turn it's too late. */
  lanes?: boolean
}

/** The full spoken instruction: landmark, lanes, action, and what follows. */
export function voiceText(instruction: RichInstruction, t: TFn, { lanes = true }: VoiceOptions = {}): string {
  const verb = lanes && instruction.lanes ? infinitive(instruction, t) : null
  let text = verb ? t(`${K}.useLanes`, { lanes: lanesText(instruction.lanes!, t), action: verb }) : actionText(instruction, t)
  const { anchor, then } = instruction
  if (anchor) {
    if (anchor.relation === 'past') text = t(`${K}.past`, { action: inline(text) })
    else if (anchor.kind === 'overpass') text = t(`${K}.underOverpass`, { action: inline(text) })
    else text = t(`${K}.anchored`, { anchor: anchorText(anchor, t), action: inline(text) })
  }
  if (!then) return text
  const next = inline(actionText(then.instruction, t))
  const decides = ['fork', 'stay', 'exit'].includes(then.instruction.action.kind)
  if (then.immediately && decides && TURNS.has(instruction.maneuver) && instruction.action.kind === 'turn' && !anchor) {
    return t(`${K}.afterTurning.${instruction.maneuver}`, { action: next })
  }
  return t(then.immediately ? `${K}.thenImmediately` : 'guidance.voice.then', { action: text, next })
}

/** The banner's second line: the landmark, else the exit or where the signs point. */
export function bannerCue(instruction: RichInstruction, t: TFn): string | null {
  if (instruction.anchor) return anchorText(instruction.anchor, t)
  const { action, toward } = instruction
  if (action.kind === 'exit' && action.number) return toward ? t(`${K}.cues.exitToward`, { number: action.number, destination: toward }) : t(`${K}.cues.exit`, { number: action.number })
  if (action.kind === 'roundabout' && action.exit != null && !action.through) return t(`${K}.cues.roundaboutExit`, { exit: action.exit })
  return toward ? t(`${K}.cues.toward`, { destination: toward }) : null
}
