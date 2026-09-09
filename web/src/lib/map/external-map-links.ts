import type { LngLat } from '@/types/map.types'

/**
 * Deep links that open the current view in someone else's map.
 *
 * Pure URL construction, kept out of the context menu so the formats are
 * readable side by side and testable — each service disagrees about
 * coordinate order, zoom encoding and separator, which is easy to get subtly
 * wrong and hard to notice.
 */

export type ExternalMapService = 'osm' | 'google' | 'apple' | 'yandex' | '2gis'
export type MapEditor = 'id' | 'rapid' | 'josm'

export function externalMapUrl(
  service: ExternalMapService,
  { lat, lng }: LngLat,
  zoom: number,
): string {
  switch (service) {
    case 'osm':
      return `https://www.openstreetmap.org/#map=${Math.ceil(zoom)}/${lat}/${lng}`
    case 'google':
      return `https://www.google.com/maps/@${lat},${lng},${zoom}z`
    case 'apple': {
      // Apple takes a degree span rather than a zoom level.
      const span = Math.pow(2, 20 - zoom) / 1024
      return `https://maps.apple.com/frame?center=${lat}%2C${lng}&span=${span}%2C${span}`
    }
    case 'yandex':
      return `https://yandex.com/maps/?ll=${lng}%2C${lat}&z=${Math.ceil(zoom)}`
    case '2gis':
      return `https://2gis.ae/?m=${lng}%2C${lat}%2F${zoom}&immersive=on`
  }
}

/** Zoom the OSM editors open at — close enough to see individual buildings. */
const EDITOR_ZOOM = 18

export function mapEditorUrl(editor: MapEditor, { lat, lng }: LngLat): string {
  switch (editor) {
    case 'id':
      return `https://www.openstreetmap.org/edit?editor=id#map=${EDITOR_ZOOM}/${lat}/${lng}`
    case 'rapid':
      return `https://mapwith.ai/rapid?#map=${EDITOR_ZOOM}/${lat}/${lng}&photo_overlay=mapillary&photo=mapillary/147417114029979`
    case 'josm':
      // JOSM listens on localhost; a zero-size bbox just centres the editor.
      return `http://127.0.0.1:8111/load_and_zoom?left=${lng}&right=${lng}&top=${lat}&bottom=${lat}`
  }
}
