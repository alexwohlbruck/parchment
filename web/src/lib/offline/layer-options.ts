import type { Layer, LayerGroup } from '@/types/map.types'
import { LayerType } from '@/types/map.types'
import type { PortolanIndexEntry } from '@/types/portolan.types'
import type { OfflineLayerOption, OfflineSource, OfflineSourceKind } from '@/types/offline.types'
import { isEnumerableTemplate } from './tiles'

export const BASEMAP_OPTION_ID = 'basemap'
export const TERRAIN_OPTION_ID = 'terrain-3d'

/** Raster zooms past these cost far more than they add on a phone screen. */
const MAX_ZOOM: Record<OfflineSourceKind, number> = { vector: 16, raster: 16, 'raster-dem': 12 }
const DEFAULT_MAX_ZOOM: Record<OfflineSourceKind, number> = { vector: 14, raster: 16, 'raster-dem': 12 }

/** Hosts whose usage policies forbid saving tiles in bulk. */
const NO_BULK_HOSTS =
  /(^|\.)(tile\.openstreetmap\.org|arcgisonline\.com|opentopomap\.org|openrailwaymap\.org|openseamap\.org|mapbox\.com)$/

/** Latin, Greek, Cyrillic, and the punctuation and arrows labels use. */
const GLYPH_RANGES = [0, 256, 512, 768, 1024, 8192, 8448]

export interface StyleSourceSpec {
  type: string
  tiles?: string[]
  minzoom?: number
  maxzoom?: number
  bounds?: number[]
}

function allowsBulk(template: string): boolean {
  try {
    const url = new URL(template)
    return /^https?:$/.test(url.protocol) && !NO_BULK_HOSTS.test(url.hostname)
  } catch {
    return false
  }
}

export function toOfflineSource(spec: StyleSourceSpec | undefined): OfflineSource | null {
  if (!spec || !Array.isArray(spec.tiles) || !spec.tiles.length) return null
  if (spec.type !== 'vector' && spec.type !== 'raster' && spec.type !== 'raster-dem') return null
  const kind = spec.type as OfflineSourceKind
  if (!spec.tiles.every(t => isEnumerableTemplate(t) && allowsBulk(t))) return null
  return {
    kind,
    tiles: spec.tiles,
    minzoom: spec.minzoom ?? 0,
    maxzoom: Math.min(spec.maxzoom ?? DEFAULT_MAX_ZOOM[kind], MAX_ZOOM[kind]),
    ...(spec.bounds?.length === 4 ? { bounds: spec.bounds as OfflineSource['bounds'] } : {}),
  }
}

function uniqueSources(sources: (OfflineSource | null)[]): OfflineSource[] {
  const seen = new Map<string, OfflineSource>()
  for (const s of sources) if (s && !seen.has(s.tiles[0])) seen.set(s.tiles[0], s)
  return [...seen.values()]
}

function layerSourceSpec(
  layer: Layer,
  styleSources: Record<string, StyleSourceSpec>,
): StyleSourceSpec | undefined {
  const source = layer.configuration?.source
  if (typeof source === 'string') return styleSources[source]
  return source as StyleSourceSpec | undefined
}

export function glyphFiles(glyphs: string | undefined, fontstacks: string[]): string[] {
  if (!glyphs) return []
  return fontstacks.flatMap(stack =>
    GLYPH_RANGES.map(start =>
      glyphs.replace('{fontstack}', stack).replace('{range}', `${start}-${start + 255}`),
    ),
  )
}

export function spriteFiles(sprite: string | undefined): string[] {
  if (!sprite) return []
  return ['', '@2x'].flatMap(scale => [`${sprite}${scale}.json`, `${sprite}${scale}.png`])
}

export interface PortolanSet {
  base: string
  feeds: PortolanIndexEntry[]
  tileQuery: (url: string) => string
}

function portolanOption(portolan: PortolanSet): Pick<OfflineLayerOption, 'sources' | 'files'> {
  const feedUrl = (feed: string, file: string) => `${portolan.base}/${encodeURIComponent(feed)}/${file}`
  return {
    sources: portolan.feeds.map(f => ({
      kind: 'vector' as const,
      tiles: [portolan.tileQuery(feedUrl(f.feed, '{z}/{x}/{y}.mvt'))],
      minzoom: 0,
      maxzoom: Math.min(f.maxzoom ?? 15, MAX_ZOOM.vector),
      ...(f.bounds?.length === 4 ? { bounds: f.bounds as OfflineSource['bounds'] } : {}),
      files: [feedUrl(f.feed, 'style.json')],
    })),
    files: [`${portolan.base}/index.json`],
  }
}

export interface LayerOptionInputs {
  styleSources: Record<string, StyleSourceSpec>
  glyphs?: string
  sprite?: string
  fontstacks: string[]
  layers: Layer[]
  groups: LayerGroup[]
  portolan: PortolanSet
}

/** Every choice the download sheet offers, built from the map as it stands. */
export function buildLayerOptions(input: LayerOptionInputs): OfflineLayerOption[] {
  const { styleSources, layers, groups } = input

  // A hidden layer's source stays in the style, so the basemap must not claim it.
  const layerIds = new Set<string>()
  const layerTiles = new Set<string>()
  for (const l of layers) {
    const source = l.configuration?.source
    if (typeof source === 'string') layerIds.add(source)
    else if (source) {
      if (source.id) layerIds.add(source.id)
      if (Array.isArray(source.tiles)) source.tiles.forEach((t: string) => layerTiles.add(t))
    }
  }
  const ownedByLayer = (template: string) =>
    layerTiles.has(template) || template.includes('/proxy/portolan/')
  const styleEntries = Object.entries(styleSources).filter(
    ([id, spec]) => !layerIds.has(id) && !(Array.isArray(spec.tiles) && spec.tiles.some(ownedByLayer)),
  )

  const basemap: OfflineLayerOption = {
    id: BASEMAP_OPTION_ID,
    name: 'basemap',
    required: true,
    sources: uniqueSources(
      styleEntries.filter(([, s]) => s.type !== 'raster-dem').map(([, s]) => toOfflineSource(s)),
    ),
    files: [...spriteFiles(input.sprite), ...glyphFiles(input.glyphs, input.fontstacks)],
  }

  const options: OfflineLayerOption[] = [basemap]

  const terrain = uniqueSources(
    styleEntries.filter(([, s]) => s.type === 'raster-dem').map(([, s]) => toOfflineSource(s)),
  )
  if (terrain.length) {
    options.push({ id: TERRAIN_OPTION_ID, name: 'terrain', icon: 'Mountain', sources: terrain, files: [] })
  }

  const childGroups = new Map<string, string[]>()
  for (const g of groups) {
    if (!g.parentGroupId) continue
    childGroups.set(g.parentGroupId, [...(childGroups.get(g.parentGroupId) ?? []), g.id])
  }
  const descendants = (id: string): string[] => [
    id,
    ...(childGroups.get(id) ?? []).flatMap(descendants),
  ]

  const layerOption = (id: string, name: string, icon: string | null | undefined, members: Layer[]) => {
    const sources = uniqueSources(members.map(l => toOfflineSource(layerSourceSpec(l, styleSources))))
    const extra = members.some(l => l.type === LayerType.TRANSIT) ? portolanOption(input.portolan) : null
    const all = uniqueSources([...sources, ...(extra?.sources ?? [])])
    if (!all.length) return
    options.push({ id, name, icon, sources: all, files: extra?.files ?? [] })
  }

  for (const group of groups) {
    if (group.parentGroupId) continue
    const ids = new Set(descendants(group.id))
    layerOption(group.id, group.name, group.icon, layers.filter(l => l.groupId && ids.has(l.groupId)))
  }
  for (const layer of layers) {
    if (layer.groupId || !layer.showInLayerSelector) continue
    layerOption(layer.id, layer.name, layer.icon, [layer])
  }

  return options
}
