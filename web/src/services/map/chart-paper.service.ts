import type { Map as MaplibreMap } from 'maplibre-gl'
import { CHART_MARKER_LAYER, CHART_PATTERNS, chartPattern, paperGrain, patternId } from '@/lib/map-style/chart-engraving'
import type { FlavorId } from '@/lib/map-style/build'

/** Browned edges, as a sheet that has spent years in a chart table. */
const VIGNETTE: Record<FlavorId, string> = {
  light: 'radial-gradient(ellipse at center, transparent 55%, hsla(30, 55%, 28%, 0.16) 85%, hsla(28, 60%, 20%, 0.32) 100%)',
  dark: 'radial-gradient(ellipse at center, transparent 50%, hsla(30, 40%, 4%, 0.3) 85%, hsla(30, 40%, 2%, 0.5) 100%)',
}

let grainUrl: Promise<string> | null = null
const grain = () => (grainUrl ??= paperGrain().convertToBlob().then(blob => URL.createObjectURL(blob)))

/**
 * The engraved chart's sheet: a fixed grain and vignette laid over the canvas
 * (beneath markers and controls) while the style is the chart, and the
 * pattern tiles its layers fill with. The patterns go in as the style loads,
 * ahead of the tiles that use them: the map's one missing-image resolver
 * belongs to the POI badges.
 */
export function attachChartPaper(map: MaplibreMap, flavor: () => FlavorId) {
  const sheet = document.createElement('div')
  Object.assign(sheet.style, { position: 'absolute', inset: '0', pointerEvents: 'none', display: 'none' })
  map.getCanvas().after(sheet)

  const container = map.getCanvasContainer()
  const onStyleLoad = () => {
    const active = !!map.getLayer(CHART_MARKER_LAYER)
    sheet.style.display = active ? 'block' : 'none'
    // Around the globe, the sheet itself rather than space.
    container.style.background = active ? String(map.getPaintProperty('Background', 'background-color') ?? '') : ''
    if (!active) return
    for (const name of CHART_PATTERNS) {
      const id = patternId(name, flavor())
      const drawn = !map.hasImage(id) && chartPattern(id, window.devicePixelRatio || 1)
      if (drawn) map.addImage(id, drawn.image, drawn.options)
    }
    grain().then(url => {
      sheet.style.background = `${VIGNETTE[flavor()]}, url(${url}) repeat`
    })
  }

  map.on('style.load', onStyleLoad)
  if (map.isStyleLoaded()) onStyleLoad()

  return {
    detach() {
      map.off('style.load', onStyleLoad)
      sheet.remove()
      container.style.background = ''
    },
  }
}
