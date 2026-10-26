/** A source's loaded features, or none while the source is not there to ask. */
export function queryFeatures(map: any, source: string, sourceLayer?: string, filter?: any[]): any[] {
  try {
    return map.querySourceFeatures(source, { ...(sourceLayer ? { sourceLayer } : {}), ...(filter ? { filter } : {}), validate: false })
  } catch {
    return []
  }
}

/**
 * Whether a vector tile's raw bytes hold a layer of this name, without parsing
 * it: a layer's name is its message's first field, so the name's bytes follow
 * that field's tag and length wherever the layer is.
 */
export function hasLayer(raw: ArrayBuffer | Uint8Array | undefined, name: string): boolean {
  if (!raw) return false
  const bytes = raw instanceof Uint8Array ? raw : new Uint8Array(raw)
  const want = new TextEncoder().encode(name)
  const head = [0x0a, want.length]
  outer: for (let i = bytes.indexOf(head[0]); i >= 0 && i + 2 + want.length <= bytes.length; i = bytes.indexOf(head[0], i + 1)) {
    if (bytes[i + 1] !== head[1]) continue
    for (let k = 0; k < want.length; k++) if (bytes[i + 2 + k] !== want[k]) continue outer
    return true
  }
  return false
}
