/** A source's loaded features, or none while the source is not there to ask. */
export function queryFeatures(map: any, source: string, sourceLayer?: string, filter?: any[]): any[] {
  try {
    return map.querySourceFeatures(source, { ...(sourceLayer ? { sourceLayer } : {}), ...(filter ? { filter } : {}), validate: false })
  } catch {
    return []
  }
}

