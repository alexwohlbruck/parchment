/** Run when the main thread is idle, or soon where the browser cannot say; returns a cancel. */
export function idle(run: () => void): () => void {
  if (typeof requestIdleCallback === 'function') {
    const handle = requestIdleCallback(run, { timeout: 1000 })
    return () => cancelIdleCallback(handle)
  }
  const handle = setTimeout(run, 0)
  return () => clearTimeout(handle)
}

/** A source's loaded features, or none while the source is not there to ask. */
export function queryFeatures(map: any, source: string, sourceLayer?: string, filter?: any[]): any[] {
  try {
    return map.querySourceFeatures(source, { ...(sourceLayer ? { sourceLayer } : {}), ...(filter ? { filter } : {}) })
  } catch {
    return []
  }
}
