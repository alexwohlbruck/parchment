type Fields = Record<string, unknown>

const isRecord = (value: unknown): value is Fields =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

function valueAt(source: unknown, keys: string[]): unknown {
  return keys.reduce<unknown>((node, key) => (isRecord(node) ? node[key] : undefined), source)
}

function withValueAt(target: unknown, [key, ...rest]: string[], value: unknown): Fields {
  const base = isRecord(target) ? target : {}
  const next = rest.length ? withValueAt(base[key], rest, value) : value
  if (next === undefined) {
    const { [key]: _, ...others } = base
    return others
  }
  return { ...base, [key]: next }
}

/** Copies `target`, taking the value at each dot path from `source`; an empty path takes all of `source`. */
export function overlayPaths(target: unknown, source: unknown, paths: string[]): unknown {
  return paths.reduce<unknown>(
    (result, path) => (path ? withValueAt(result, path.split('.'), valueAt(source, path.split('.'))) : source),
    target,
  )
}

/** Paths below `prefix` named by `keys`, relative to it; `''` when `prefix` itself is named. */
export function pathsUnder(keys: readonly string[], prefix: string): string[] {
  return keys.flatMap(key => {
    if (key === prefix) return ['']
    return key.startsWith(`${prefix}.`) ? [key.slice(prefix.length + 1)] : []
  })
}

/** Deep equality for JSON-shaped values, ignoring key order. */
export function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((item, i) => sameValue(item, b[i]))
  if (!isRecord(a) || !isRecord(b)) return false
  const keys = Object.keys(a).filter(key => a[key] !== undefined)
  return (
    keys.length === Object.keys(b).filter(key => b[key] !== undefined).length &&
    keys.every(key => sameValue(a[key], b[key]))
  )
}
