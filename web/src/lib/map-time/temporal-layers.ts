/** A built-in layer whose drawing changes with the time it is given. */
export interface TemporalLayer {
  groupId: string
  /** Appearances that read the time; absent means every appearance does. */
  appearances?: readonly string[]
}

export const TEMPORAL_LAYERS: readonly TemporalLayer[] = [
  { groupId: 'default:group:transit', appearances: ['live'] },
  { groupId: 'default:group:daynight' },
]

/** The temporal layers currently showing in a way that reads the time, in declaration order. */
export function activeTemporalLayerIds(
  isVisible: (groupId: string) => boolean,
  appearanceOf: (groupId: string) => string | undefined,
  layers: readonly TemporalLayer[] = TEMPORAL_LAYERS,
): string[] {
  return layers
    .filter(layer => isVisible(layer.groupId))
    .filter(layer => {
      if (!layer.appearances) return true
      const appearance = appearanceOf(layer.groupId)
      return !!appearance && layer.appearances.includes(appearance)
    })
    .map(layer => layer.groupId)
}
