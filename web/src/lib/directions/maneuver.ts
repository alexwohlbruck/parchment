import type { RouteInstruction } from '@/types/directions.types'

export type ManeuverKind =
  | 'straight'
  | 'slight-left'
  | 'slight-right'
  | 'left'
  | 'right'
  | 'sharp-left'
  | 'sharp-right'
  | 'keep-left'
  | 'keep-right'
  | 'uturn'
  | 'roundabout'
  | 'arrive'
  | 'board'

/**
 * One vocabulary over both routing adapters: Barrelman sends type + modifier
 * ("continue" + "slight-left" for a keep), direct GraphHopper folds it into
 * the type ("keep-left", "turn-sharp-right", "roundabout-enter").
 */
export function maneuverKind(instruction: Pick<RouteInstruction, 'type' | 'modifier'>): ManeuverKind {
  const type = instruction.type ?? ''
  const modifier = instruction.modifier
  if (type === 'board') return 'board'
  if (/arrive|destination/.test(type)) return 'arrive'
  if (/roundabout/.test(type)) return 'roundabout'
  if (modifier === 'u-turn' || /u-turn/.test(type)) return 'uturn'
  const side = modifier?.includes('left') || /left/.test(type) ? 'left' : modifier?.includes('right') || /right/.test(type) ? 'right' : null
  if (!side) return 'straight'
  if (/keep/.test(type) || (type === 'continue' && modifier?.startsWith('slight'))) return `keep-${side}`
  if (modifier?.startsWith('sharp') || /sharp/.test(type)) return `sharp-${side}`
  if (modifier?.startsWith('slight') || /slight/.test(type)) return `slight-${side}`
  return side
}
