import type { Map as MaplibreMap } from 'maplibre-gl'

/** Holds a map to one frame per `minFrameMs` by deferring its repaint requests; 0 lifts the cap. */
export function createFrameCap(map: MaplibreMap) {
  const repaint = map.triggerRepaint.bind(map)
  let minFrameMs = 0
  let lastFrame = -Infinity
  let timer: ReturnType<typeof setTimeout> | null = null
  const onRender = () => (lastFrame = performance.now())

  map.on('render', onRender)
  map.triggerRepaint = () => {
    if (timer) return
    const wait = lastFrame + minFrameMs - performance.now()
    if (minFrameMs <= 0 || wait <= 0) return repaint()
    timer = setTimeout(() => {
      timer = null
      repaint()
    }, wait)
  }

  return {
    set(ms: number) {
      minFrameMs = ms
    },
    dispose() {
      map.off('render', onRender)
      if (timer) clearTimeout(timer)
      delete (map as Partial<MaplibreMap>).triggerRepaint
    },
  }
}
