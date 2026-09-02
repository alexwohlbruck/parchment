import { DefaultLayerTemplate } from '../../types/layers.types'
import { LayerType } from '../../schema/layers.schema'

/**
 * OSM notes. There is no map layer behind this one — the client draws notes
 * as markers it fetches per viewport — but it is a layer as far as the user
 * is concerned, so it lives in the library and the selector like any other.
 * `configuration.id` is what the notes layer service watches for visibility.
 */
export const NOTES_LAYER_TEMPLATES: DefaultLayerTemplate[] = [
  {
    templateId: 'default:osm-notes',
    description: 'Open map issues reported by the OpenStreetMap community.',
    installedByDefault: false,
    name: 'OSM Notes',
    type: LayerType.NOTES,
    engine: ['mapbox', 'maplibre'],
    icon: 'MessageSquareIcon',
    showInLayerSelector: true,
    visible: false,
    order: 14,
    groupId: null,
    isSubLayer: false,
    integrationId: null,
    configuration: {
      id: 'osm-notes',
      type: 'symbol',
      source: 'osm-notes',
    },
  },
]
