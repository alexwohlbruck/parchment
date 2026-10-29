export interface MapSnapshot {
  image: string
  left: number
  top: number
  width: number
  height: number
}

interface SnapshotMap {
  getCanvas(): HTMLCanvasElement
  loaded(): boolean
  on(event: 'render', listener: () => void): unknown
  off(event: 'render', listener: () => void): unknown
  triggerRepaint(): void
}

export function captureMapSnapshot(map: SnapshotMap, signal: AbortSignal): Promise<MapSnapshot | null> {
  if (signal.aborted) return Promise.resolve(null)

  return new Promise(resolve => {
    let settled = false
    const timeout = setTimeout(() => finish(null), 2500)

    function finish(snapshot: MapSnapshot | null) {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      map.off('render', capture)
      signal.removeEventListener('abort', abort)
      resolve(snapshot)
    }

    function abort() {
      finish(null)
    }

    function capture() {
      if (!map.loaded()) return
      try {
        const canvas = map.getCanvas()
        const { left, top, width, height } = canvas.getBoundingClientRect()
        if (!canvas.width || !canvas.height || !width || !height) return finish(null)
        // Read during render, before WebGL discards its drawing buffer.
        const image = canvas.toDataURL('image/webp', 0.95)
        finish(image === 'data:,' ? null : { image, left, top, width, height })
      } catch {
        finish(null)
      }
    }

    signal.addEventListener('abort', abort, { once: true })
    try {
      map.on('render', capture)
      map.triggerRepaint()
    } catch {
      finish(null)
    }
  })
}
