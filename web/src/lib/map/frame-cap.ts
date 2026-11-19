import type { Map as MaplibreMap } from 'maplibre-gl'

/** Holds a map to one frame per `minFrameMs` by spacing out its repaint requests; 0 lifts the cap. */
export function createFrameCap(map: MaplibreMap) {
  const repaint = map.triggerRepaint.bind(map)
  let minFrameMs = 0
  let lastRequest = -Infinity
  let timer: ReturnType<typeof setTimeout> | null = null

  function request() {
    timer = null
    lastRequest = performance.now()
    repaint()
  }

  map.triggerRepaint = () => {
    if (timer) return
    const wait = lastRequest + minFrameMs - performance.now()
    if (wait <= 0) request()
    else timer = setTimeout(request, wait)
  }

  return {
    set(ms: number) {
      minFrameMs = ms
    },
    dispose() {
      if (timer) clearTimeout(timer)
      delete (map as Partial<MaplibreMap>).triggerRepaint
    },
  }
}
