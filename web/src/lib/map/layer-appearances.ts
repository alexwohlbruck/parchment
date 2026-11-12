import { bikeSuitabilityColor } from '@server/lib/bike-suitability'

/** One way a built-in layer can draw; a layer shows exactly one at a time. */
export interface LayerAppearance {
  id: string
  /** i18n key of its name. */
  name: string
  /** Child groups switched on while it is the one showing. */
  groupIds?: string[]
  /** The strokes its preview tile draws, in order, one per preview path. */
  swatch: Swatch[]
  /** A colour ramp under the picker, where colour is the data itself. */
  legend?: { from: string; to: string; colors: string[] }
}

export interface Swatch {
  color: string
  dash?: string
}

export const CYCLING_GROUP_ID = 'default:group:cycling'

const CYCLING_INFRASTRUCTURE = ['cycleways', 'bicycle-paths', 'proposed-bikeways', 'bike-routes'].map(
  g => `${CYCLING_GROUP_ID}:${g}`,
)

const ramp = (...scores: number[]) => scores.map(s => bikeSuitabilityColor(s))

export const LAYER_APPEARANCES: Record<string, LayerAppearance[]> = {
  [CYCLING_GROUP_ID]: [
    {
      id: 'infrastructure',
      name: 'layers.appearances.cycling.infrastructure',
      groupIds: CYCLING_INFRASTRUCTURE,
      swatch: [
        { color: 'hsl(160, 64%, 32%)' },
        { color: 'hsl(158, 46%, 50%)', dash: '5 3' },
        { color: 'hsl(158, 50%, 38%)' },
        { color: 'hsl(158, 16%, 62%)', dash: '3 3' },
      ],
    },
    {
      id: 'suitability',
      name: 'layers.appearances.cycling.suitability',
      groupIds: ['default:group:bike-suitability'],
      swatch: ramp(10, 92, 70, 35).map(color => ({ color })),
      legend: {
        from: 'layers.appearances.cycling.stressful',
        to: 'layers.appearances.cycling.comfortable',
        colors: ramp(0, 30, 50, 65, 80, 100),
      },
    },
  ],
  'default:group:transit': [
    {
      id: 'live',
      name: 'layers.appearances.transit.live',
      swatch: [{ color: '#0a7bd6' }, { color: '#e0322f' }, { color: '#f5a623', dash: '2 4' }, { color: '#2a9d55', dash: '2 4' }],
    },
    {
      id: 'full-service',
      name: 'layers.appearances.transit.fullService',
      swatch: [{ color: '#0a7bd6' }, { color: '#e0322f' }, { color: '#f5a623' }, { color: '#2a9d55' }],
    },
  ],
}

/** The appearance a layer shows: the stored choice while it still exists, else its first. */
export function resolveAppearance(layerId: string, stored: string | undefined): LayerAppearance | undefined {
  const options = LAYER_APPEARANCES[layerId]
  return options?.find(a => a.id === stored) ?? options?.[0]
}

/** Whether each child group an appearance owns should show: only the chosen one's, and only while the layer is on. */
export function appearanceGroupVisibility(
  layerId: string,
  layerVisible: boolean,
  appearance: LayerAppearance,
): Map<string, boolean> {
  const visibility = new Map<string, boolean>()
  for (const option of LAYER_APPEARANCES[layerId] ?? []) {
    for (const groupId of option.groupIds ?? []) {
      visibility.set(groupId, layerVisible && option.id === appearance.id)
    }
  }
  return visibility
}
