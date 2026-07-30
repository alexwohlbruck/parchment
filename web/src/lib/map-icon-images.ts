/**
 * Registers maki / lucide glyphs as MapLibre map images so native symbol
 * layers can draw them via `icon-image`.
 *
 * Saved places render as a native circle layer with a glyph on top, rather
 * than HTML markers, so the count of points on screen stops mattering. That
 * needs every glyph the user has picked to exist as a registered map image.
 *
 * Both packs already ship as raw SVG in the bundle (`@mapbox/maki` and
 * `lucide-static`), but they are drawn differently: maki glyphs are solid
 * fills on a 15-unit viewBox with no stroke, lucide glyphs are 24-unit
 * strokes with `fill="none"`. Rather than reimplement either, we recolor the
 * SVG source to white and let the browser rasterize it.
 *
 * Images are plain rasters, not SDFs. `sdf: true` expects a real distance
 * field — handing MapLibre a flat alpha mask under that flag renders soft,
 * smeared edges. The glyph is always white on a colored circle, so there is
 * nothing to tint and nothing to gain.
 *
 * NB: map images are dropped by `setStyle()`, so callers must re-register
 * after every `style.load`, not just on first init.
 */

import * as LucideIcons from 'lucide-vue-next'

export type MapIconPack = 'lucide' | 'maki'

export interface MapIconSpec {
  pack: MapIconPack
  name: string
}

/** Logical (CSS) px of the registered image; `icon-size` scales from here. */
const IMAGE_SIZE = 24
/** Rasterize at 2× so the glyph stays crisp on retina and when scaled up. */
const PIXEL_RATIO = 2

const makiSources = import.meta.glob('/node_modules/@mapbox/maki/icons/*.svg', {
  query: '?raw',
  import: 'default',
}) as Record<string, () => Promise<string>>

// Lazy, unlike the eager glob in MakiIcon.vue: lucide ships ~1,600 icons and
// inlining all of them would dwarf the rest of the bundle. A user's bookmarks
// realistically touch a couple dozen.
const lucideSources = import.meta.glob(
  '/node_modules/lucide-static/icons/*.svg',
  { query: '?raw', import: 'default' },
) as Record<string, () => Promise<string>>

/**
 * Both packs are keyed by kebab-case filenames, but icons are stored in the
 * DB in whichever form produced them — the icon picker emits lucide names in
 * PascalCase (`MapPin`), while the `bookmarks.icon` column defaults to kebab
 * (`map-pin`). Index by the case- and separator-insensitive form so either
 * spelling resolves, instead of hand-rolling a PascalCase→kebab converter
 * that has to know `Volume2` → `volume-2` but `Axis3d` → `axis-3d`.
 */
function normalizeKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '')
}

function buildIndex(
  sources: Record<string, () => Promise<string>>,
): Map<string, () => Promise<string>> {
  const index = new Map<string, () => Promise<string>>()
  for (const [path, load] of Object.entries(sources)) {
    const file = path.split('/').pop()?.replace('.svg', '')
    if (file) index.set(normalizeKey(file), load)
  }
  return index
}

const packIndexes: Record<MapIconPack, Map<string, () => Promise<string>>> = {
  maki: buildIndex(makiSources),
  lucide: buildIndex(lucideSources),
}

/**
 * Deprecated lucide names → the canonical name whose file actually exists.
 *
 * lucide renames icons and keeps the old name as an alias export — `Home` is
 * now `House`, and only `house.svg` ships. `lucide-vue-next` re-exports the
 * same component under both, so Vue components render either happily, but a
 * filename lookup finds nothing and the glyph silently vanishes. The icon
 * picker lists both spellings, so this isn't limited to icons we hardcode.
 *
 * The alias pairs aren't published as data, but the two exports are the SAME
 * component reference — so identity recovers the mapping. Built lazily on the
 * first miss, since a hit never needs it.
 */
let lucideAliases: Map<string, string> | null = null

function resolveLucideAlias(normalized: string): string | undefined {
  if (!lucideAliases) {
    lucideAliases = new Map()
    const canonicalByComponent = new Map<unknown, string>()
    const files = packIndexes.lucide

    for (const [key, component] of Object.entries(LucideIcons)) {
      if (!key.endsWith('Icon') || key === 'Icon') continue
      const name = normalizeKey(key.slice(0, -'Icon'.length))
      if (files.has(name)) canonicalByComponent.set(component, name)
    }

    for (const [key, component] of Object.entries(LucideIcons)) {
      if (!key.endsWith('Icon') || key === 'Icon') continue
      const name = normalizeKey(key.slice(0, -'Icon'.length))
      if (files.has(name)) continue
      const canonical = canonicalByComponent.get(component)
      if (canonical) lucideAliases.set(name, canonical)
    }
  }
  return lucideAliases.get(normalized)
}

/** The loader for an icon, following a lucide alias if the name is a stale one. */
function findSource(
  pack: MapIconPack,
  name: string,
): (() => Promise<string>) | undefined {
  const key = normalizeKey(name)
  const direct = packIndexes[pack]?.get(key)
  if (direct || pack !== 'lucide') return direct

  const canonical = resolveLucideAlias(key)
  return canonical ? packIndexes.lucide.get(canonical) : undefined
}

/** Image id for a glyph. Kept stable so `icon-image` can build it inline. */
export function mapIconImageId(pack: MapIconPack, name: string): string {
  return `bm-${pack}-${name}`
}

/**
 * Force the glyph white. Maki paths carry no fill and inherit black from the
 * SVG root; lucide strokes resolve `currentColor`, which has no cascade to
 * inherit from inside an `<img>`, so both need an explicit color.
 */
function recolorToWhite(svg: string, pack: MapIconPack): string {
  if (pack === 'lucide') return svg.replace(/currentColor/g, '#ffffff')
  return svg.replace(/<svg\b/, '<svg fill="#ffffff"')
}

/**
 * Look up a glyph and return it recolored, or null if the pack has no icon by
 * that name. Split out from registration so the name resolution — the part
 * that has to cope with `MapPin` vs `map-pin` vs `Volume2` — is testable
 * without a canvas.
 */
export async function resolveIconSvg(
  pack: MapIconPack,
  name: string,
): Promise<string | null> {
  const load = findSource(pack, name)
  if (!load) return null
  return recolorToWhite(await load(), pack)
}

async function rasterize(svg: string): Promise<ImageData | null> {
  const blobUrl = URL.createObjectURL(
    new Blob([svg], { type: 'image/svg+xml' }),
  )
  try {
    const img = new Image()
    img.width = IMAGE_SIZE
    img.height = IMAGE_SIZE
    img.src = blobUrl
    await img.decode()

    const side = IMAGE_SIZE * PIXEL_RATIO
    const canvas = document.createElement('canvas')
    canvas.width = side
    canvas.height = side
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(img, 0, 0, side, side)
    return ctx.getImageData(0, 0, side, side)
  } finally {
    URL.revokeObjectURL(blobUrl)
  }
}

/**
 * In-flight registrations, keyed by image id. Two features sharing an icon
 * would otherwise both miss `hasImage` and race to `addImage`, and the loser
 * throws "an image with this name already exists".
 */
const pending = new Map<string, Promise<void>>()

/**
 * Register one glyph. Resolves once the image is on the map (or immediately
 * if it already is). Unknown icon names resolve without registering — the
 * symbol layer just draws nothing for that feature, which is preferable to
 * failing the whole batch.
 */
export function ensureIconImage(
  map: any,
  pack: MapIconPack,
  name: string,
): Promise<void> {
  const id = mapIconImageId(pack, name)
  if (!map || typeof map.hasImage !== 'function') return Promise.resolve()
  if (map.hasImage(id)) return Promise.resolve()

  const inFlight = pending.get(id)
  if (inFlight) return inFlight

  if (!findSource(pack, name)) {
    console.warn(`[map-icon-images] unknown ${pack} icon "${name}"`)
    return Promise.resolve()
  }

  const task = (async () => {
    try {
      const svg = await resolveIconSvg(pack, name)
      const data = svg ? await rasterize(svg) : null
      // The style can change while we were decoding, which both clears
      // registered images and can re-add this one — re-check before writing.
      if (data && !map.hasImage(id)) {
        map.addImage(id, data, { pixelRatio: PIXEL_RATIO })
      }
    } catch (e) {
      console.warn(`[map-icon-images] failed to register ${id}:`, e)
    } finally {
      pending.delete(id)
    }
  })()

  pending.set(id, task)
  return task
}

/** Register a batch of glyphs, de-duplicated. Never rejects. */
export function ensureIconImages(
  map: any,
  specs: Iterable<MapIconSpec>,
): Promise<void> {
  const seen = new Set<string>()
  const tasks: Promise<void>[] = []
  for (const { pack, name } of specs) {
    const id = mapIconImageId(pack, name)
    if (seen.has(id)) continue
    seen.add(id)
    tasks.push(ensureIconImage(map, pack, name))
  }
  return Promise.all(tasks).then(() => undefined)
}
