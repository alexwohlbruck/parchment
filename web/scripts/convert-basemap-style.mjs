#!/usr/bin/env node
/**
 * Converts the vendored MapTiler Streets v2 style into Parchment's basemap
 * spec: the same layers, filters, zoom ramps and draw order, with every
 * colour literal lifted out into a named token.
 *
 * The point of the token lift is that light and dark then share ONE layer
 * spec. The previous dark map was the light one run through a colour
 * transform at runtime, which is why it collapsed into a single flat hue.
 *
 * Four things cannot carry over as-is:
 *
 *   sources     `maptiler_planet` becomes our `openmaptiles`. The four
 *               `globallandcover` layers are dropped — that is a MapTiler
 *               extension our OpenMapTiles tiles do not carry, and a layer
 *               pointed at a missing source-layer draws nothing anyway.
 *
 *   fonts       kept verbatim. `build-glyphs.mjs` generates the exact
 *               composite stacks the style names.
 *
 *   POI icons   MapTiler splits POIs into 11 families, each a flat colour
 *               from their palette. Parchment already assigns every place a
 *               category and colour (server `place-categories.ts`, surfaced
 *               through the category palette) and draws search results with
 *               it. Basemap POIs use that same mapping so a café on the map
 *               and the same café in search results are the same colour.
 *
 *   shields     Their sprite carries per-width shield images we do not have.
 *               `build-sprite.mjs` generates equivalents.
 *
 * Output (committed):
 *   src/lib/map-style/spec.json          layers, colours as "@token"
 *   src/lib/map-style/tokens.light.json  token -> colour
 *
 * Run with: bun run build:style
 */
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const WEB = resolve(HERE, '..')
const SRC = resolve(WEB, 'scripts/vendor/maptiler-streets-v2.json')
const SRC_DARK = resolve(WEB, 'scripts/vendor/maptiler-streets-v2-dark.json')
const OUT_SPEC = resolve(WEB, 'src/lib/map-style/spec.json')
const OUT_TOKENS = resolve(WEB, 'src/lib/map-style/tokens.light.json')
const OUT_TOKENS_DARK = resolve(WEB, 'src/lib/map-style/tokens.dark.json')

const SOURCE = 'openmaptiles'

/** Source-layers our OpenMapTiles basemap.pmtiles actually carries. */
const AVAILABLE = new Set([
  'aerodrome_label', 'aeroway', 'boundary', 'building', 'housenumber',
  'landcover', 'landuse', 'mountain_peak', 'park', 'place', 'poi',
  'transportation', 'transportation_name', 'water', 'water_name', 'waterway',
])

/**
 * OpenMapTiles `poi.class` → Parchment place category.
 *
 * Mirrors the preset rules in `server/src/lib/place-categories.ts`, including
 * its ordering quirks: bicycle infrastructure counts as sport before the
 * general shop rule, and lodging / transport both land in commercial_services
 * rather than getting categories of their own.
 */
const POI_CATEGORY = {
  food_and_drink: ['restaurant', 'cafe', 'bar', 'beer', 'fast_food', 'food_court', 'ice_cream', 'biergarten', 'pub', 'bakery'],
  education: ['school', 'university', 'college', 'library', 'kindergarten', 'childcare', 'driving_school', 'dancing_school'],
  medical: ['hospital', 'pharmacy', 'clinic', 'doctors', 'doctor', 'dentist', 'veterinary', 'first_aid'],
  sport_and_leisure: ['bicycle', 'bicycle_parking', 'swimming', 'pitch', 'golf', 'stadium', 'playground', 'sport'],
  store: ['shop', 'grocery', 'clothing_store', 'alcohol_shop', 'jewelry_store', 'furniture', 'florist', 'shoe', 'hairdresser', 'laundry', 'books', 'marketplace'],
  park: ['park', 'garden', 'picnic_site', 'dog_park'],
  commercial_services: [
    'railway', 'bus', 'aerialway', 'harbor', 'airport', 'subway', 'tram_stop',
    'ferry_terminal', 'station', 'bus_stop', 'bus_station',
    'office', 'bank', 'atm', 'car', 'car_rental', 'car_repair', 'fuel',
    'charging_station', 'parking', 'parking_garage', 'parking_paid', 'toilets',
    'shower', 'lodging', 'hotel', 'motel', 'hostel', 'guest_house', 'apartment',
    'chalet', 'campsite', 'camp_site', 'caravan_site', 'information', 'post',
  ],
  arts_and_entertainment: [
    'art_gallery', 'museum', 'theatre', 'cinema', 'attraction', 'castle',
    'monument', 'ruins', 'theme_park', 'aquarium', 'music', 'nightclub',
    'community_centre', 'zoo',
  ],
}

/** Icon names the sprite carries for a POI subclass; see build-sprite.mjs. */
const ICON_SUBCLASSES = [
  'artwork', 'bakery', 'bed', 'bicycle_parking', 'books', 'bus_station',
  'bus_stop', 'butcher', 'camp_site', 'car_repair', 'christian', 'cinema',
  'clinic', 'clothes', 'coffee', 'community_centre', 'convenience', 'deli',
  'department_store', 'doctors', 'doityourself', 'dry_cleaning', 'financial',
  'florist', 'food_court', 'furniture', 'garden_centre', 'golf_course',
  'guest_house', 'hairdresser', 'hostel', 'hotel', 'interior_decoration',
  'jewelry', 'kindergarten', 'marketplace', 'miniature_golf', 'mobile_phone',
  'motel', 'museum', 'nightclub', 'optician', 'pet', 'pharmacy', 'post_box',
  'post_office', 'pub', 'shoes', 'sports_centre', 'station', 'subway',
  'supermarket', 'swimming_pool', 'theatre', 'toilets', 'tram_stop',
  'university', 'veterinary', 'viewpoint', 'water_park', 'wine',
]

/**
 * Resolve a POI icon: the subclass when the sprite has one, else the class.
 *
 * There is deliberately no fallback image. A POI we have no glyph for shows
 * its bare coloured badge, which reads correctly; falling back to the `dot`
 * image stamped a filled circle on top of the badge and turned it into a
 * black disc.
 *
 * Gated on an explicit list rather than attempting the lookup: `coalesce`
 * around a missing image still draws, but logs a warning per feature per
 * tile, which buried the console on the first render.
 */
const POI_ICON = [
  'coalesce',
  ['image', ['match', ['get', 'subclass'], ICON_SUBCLASSES, ['get', 'subclass'], ['coalesce', ['get', 'class'], '']]],
  ['image', ['coalesce', ['get', 'class'], '']],
]

/**
 * Hand corrections where MapTiler's dark style has no counterpart to read.
 * Their dark Oneway layer drops `icon-color` entirely and leans on its own
 * sprite art, which would otherwise leave a light-grey arrow on a dark road.
 */
const DARK_OVERRIDES = {
  oneway_icon_color: 'hsl(0, 0%, 42%)',
  shield_fill: 'hsl(0, 0%, 100%)',
  shield_fill_2: 'hsl(0, 0%, 24%)',
}

/**
 * Route shields. MapTiler's sprite carries per-network shield art (US
 * interstate, US highway, …) that we have no equivalent for, so every shield
 * layer falls back to the generic `road_{ref_length}` rectangle the sprite
 * builder generates, tinted per flavor. The two interstate-specific overlay
 * layers are dropped — without their art they would only double-draw.
 */
const SHIELD_LAYERS = new Set([
  'Highway shield', 'Highway shield (US)', 'Highway junction',
])
const DROP_LAYERS = new Set([
  'Highway shield interstate top (US)', 'Highway shield interstate (US)',
])

/** Tint a POI by Parchment's category palette rather than MapTiler's families. */
function poiColorExpression() {
  const branches = []
  for (const [category, classes] of Object.entries(POI_CATEGORY)) {
    branches.push(classes, `@poi_${category}`)
  }
  return ['match', ['get', 'class'], ...branches, '@poi_default']
}

/**
 * Mapbox Standard's POI treatment, which is what the app already draws search
 * results with (`SEARCH_RESULTS_LAYER_CONFIG` in `constants/layers`): a flat
 * category-coloured glyph with the name in the same colour directly beneath
 * it, no icon halo, and a thin halo on the text only.
 *
 * Values are taken from Standard's own `poi-label` layer, vendored at
 * `src/components/map/styles/standard.json`. Its light/dark switch is
 * `measure-light`, which is Mapbox-only — we resolve the same two colours per
 * flavor at build time instead, so the result matches without the expression.
 */
/**
 * MapTiler names two-font stacks (`["Roboto Medium", "Noto Sans Regular"]`).
 * MapLibre joins those into one `encodeURIComponent`d path segment, turning
 * the separator into `%2C`, which no static file server decodes back into a
 * directory name — the request falls through to index.html and every label
 * vanishes. `build-glyphs.mjs` composites the fallback into single-named
 * stacks instead, so the style only ever names one font.
 */
const EXPRESSION_OPS = new Set([
  'match', 'case', 'step', 'coalesce', 'concat', 'literal', 'get', 'interpolate',
])

/** True for a plain font list like ["Roboto Medium", "Noto Sans Regular"]. */
function isFontList(node) {
  return (
    Array.isArray(node) &&
    node.length > 0 &&
    node.every(x => typeof x === 'string') &&
    !EXPRESSION_OPS.has(node[0])
  )
}

/**
 * Reduce every font list to its primary, wherever it appears — the shield
 * layers wrap theirs in `["match", …, ["literal", [...]], …]`, so a naive
 * `stack[0]` would turn the whole expression into the font "match".
 */
function singleFont(node) {
  if (isFontList(node)) return [node[0]]
  if (Array.isArray(node)) return node.map(singleFont)
  return node
}

/**
 * How many POIs earn a glyph and a name at each zoom, keyed on OpenMapTiles'
 * own `rank` (1 = most important in the tile).
 *
 * Mapbox thins its POIs with `filterrank`, which its tileset carries and ours
 * does not — without an equivalent, every POI in a downtown block gets a name
 * and the map turns to soup. Everything filtered out here still draws, as a
 * bare dot, which is what a Mapbox map actually looks like: a handful of named
 * places among a scatter of dots.
 */
const RANK_STEPS = [
  [null, 4],
  [15, 8],
  [16, 16],
  [17, 40],
  [18, Infinity],
]

/**
 * A POI's importance, with "unranked" meaning least important.
 *
 * Explicitly `has`-guarded rather than `["coalesce", ["to-number", …], 999]`:
 * `to-number` converts null to 0, so coalesce never reached its fallback and
 * every POI with no `rank` at all scored 0 — the most important rank there is.
 * That let bins, gates, benches and drinking fountains through every gate,
 * which is where the scatter of empty badges came from.
 */
const RANK = ['case', ['has', 'rank'], ['to-number', ['get', 'rank']], 999]

/**
 * `step` must be the OUTERMOST expression wherever these are used: `["zoom"]`
 * is only legal as the direct input of a top-level step/interpolate, so a
 * zoom-varying threshold can neither sit inside a comparison nor inside a
 * `case`. Both the layer filters and the badge geometry are therefore built
 * as zoom steps whose branches are already zoom-free.
 */
function rankStep(atThreshold) {
  const out = ['step', ['zoom'], atThreshold(RANK_STEPS[0][1])]
  for (const [zoom, limit] of RANK_STEPS.slice(1)) out.push(zoom, atThreshold(limit))
  return out
}

const RANK_GATE = rankStep(limit =>
  limit === Infinity ? true : ['<=', RANK, limit],
)

/**
 * Translate a legacy filter into expression syntax.
 *
 * MapTiler still writes filters the old way (`["in", "class", "bar", …]`).
 * The two syntaxes cannot be mixed — wrapping a legacy filter in an
 * expression `all` makes the validator read the whole thing as legacy and
 * reject `step` as an unknown operator — so adding a zoom-varying clause
 * means converting what is already there first.
 */
function toExpressionFilter(f) {
  if (!Array.isArray(f)) return f
  const [op, ...rest] = f
  const key = k => (k === '$type' ? ['geometry-type'] : k === '$id' ? ['id'] : ['get', k])

  switch (op) {
    case 'all':
    case 'any':
      return [op, ...rest.map(toExpressionFilter)]
    case 'none':
      return ['!', ['any', ...rest.map(toExpressionFilter)]]
    case '==': case '!=': case '<': case '<=': case '>': case '>=':
      // Already an expression when the operand is itself one.
      return Array.isArray(rest[0]) ? f : [op, key(rest[0]), rest[1]]
    case 'in':
      return Array.isArray(rest[0]) ? f : ['match', key(rest[0]), rest.slice(1), true, false]
    case '!in':
      return ['!', ['match', key(rest[0]), rest.slice(1), true, false]]
    case 'has':
      return typeof rest[0] === 'string' ? ['has', rest[0]] : f
    case '!has':
      return ['!', ['has', rest[0]]]
    default:
      return f
  }
}

/**
 * Badge geometry, matching the saved-place markers in
 * `constants/layers/core-layers.ts`: 9.5px radius reads as the ~22px disc a
 * native Mapbox POI marker occupies.
 */
const BADGE_RADIUS_FULL = 9.5

/**
 * Glyph size inside the badge — the same `1.14r / 24` the search-result and
 * saved-place markers use (`glyphSize()` in `core-layers.ts`), which holds the
 * glyph at ~57% of the disc's diameter.
 *
 * Do NOT re-derive this from Maki's 15-unit grid. An earlier revision did, got
 * 0.72, and drew a glyph LARGER than the disc it sits in: the icon spilled past
 * the ring, so a badge read as a white blob with a coloured crescent behind it
 * rather than as a marker — which in dark mode looked like the POIs had been
 * turned white. The sprite's own box is padded for the distance field, so the
 * grid unit is not what `icon-size` scales against.
 */
const BADGE_GLYPH_SIZE = Math.round(((BADGE_RADIUS_FULL * 1.14) / 24) * 1000) / 1000

const POI_LAYOUT = {
  'icon-size': BADGE_GLYPH_SIZE,
  // The glyph belongs to its badge, not to the label collision system. Circle
  // layers do not collide, so a culled glyph leaves its disc behind as an
  // empty coloured blob next to the badges that survived. Same reasoning, and
  // the same two flags, as the saved-place glyphs in `core-layers.ts`.
  'icon-allow-overlap': true,
  'icon-ignore-placement': true,
  'text-size': 13,
  // Clears the taller glyph — offset is in ems of text-size, so 1.1em ≈ 14px
  // below the icon's centre.
  'text-offset': [0, 1.1],
  'text-anchor': 'top',
  'text-padding': ['interpolate', ['linear'], ['zoom'], 16, 6, 17, 4],
  'text-max-width': 8,
  // Keep the glyph when the name would collide — Standard does the same, and
  // it is what stops a dense block from losing its icons along with its labels.
  'text-optional': true,
}

const POI_PAINT = {
  'text-halo-width': 1,
  'text-halo-blur': 0,
  'text-halo-color': '@poi_halo',
  // The glyph is knocked out of the coloured disc drawn beneath it, so it is
  // inked, not tinted — the category colour is carried by the badge.
  'icon-color': '@poi_ink',
  'icon-halo-width': 0,
}
const POI_PAINT_DROP = ['icon-halo-color', 'icon-halo-blur']

/**
 * The coloured disc a glyphed POI sits on.
 *
 * This is the part that makes a Mapbox POI look like a Mapbox POI: the
 * category colour is carried by a filled circle with the glyph knocked out of
 * it, not by tinting a bare glyph. Same construction as the saved-place
 * markers in `constants/layers/core-layers.ts`.
 *
 * Only POIs a glyph layer draws over get a badge. An earlier revision gave the
 * rest a small dot instead, which put a scatter of coloured specks on the map
 * that carried no icon and answered no click — the POI click delegates in
 * `maplibre.strategy.ts` are bound to the symbol layers, not to this one, so a
 * dot with no glyph over it is inert. Mapbox Standard does the same: its
 * `poi-label` drops `icon-opacity` to 0 below the size rank rather than
 * substituting a dot.
 */
function poiBadgeLayer(poiLayers) {
  /**
   * A glyph layer's own conditions, with the rank gate stripped back off.
   *
   * Every POI layer leaves here as `["all", <MapTiler's filter>, RANK_GATE]`,
   * and the rank half is zoom-dependent, so it cannot be reused inside a paint
   * expression. The MapTiler half can be, verbatim — which is the point: the
   * badge stops approximating what a glyph layer accepts and starts asking the
   * layer itself. Anything the filter tests for free — `has name`, the
   * subclass exclusions, geometry type — comes along.
   */
  const ownFilter = f => {
    if (!Array.isArray(f)) return true
    const isRankGate = n => Array.isArray(n) && n[0] === 'step'
    if (f[0] === 'all' && f.length === 3 && isRankGate(f[2])) return f[1]
    return isRankGate(f) ? true : f
  }

  const glyphLayers = poiLayers.map(l => {
    const own = ownFilter(l.filter)
    // `["zoom"]` is legal only as the direct input of a top-level step, so a
    // layer whose own filter reads zoom cannot be folded into the badge's.
    if (JSON.stringify(own).includes('["zoom"]')) {
      throw new Error(`POI layer ${l.id} reads zoom outside its rank gate`)
    }
    return { id: l.id, minzoom: l.minzoom ?? 0, own }
  })

  const rankLimitAt = zoom => {
    let limit = RANK_STEPS[0][1]
    for (const [at, l] of RANK_STEPS.slice(1)) if (zoom >= at) limit = l
    return limit
  }

  // Every zoom at which either half of the gate changes.
  const firstZoom = Math.min(...glyphLayers.map(l => l.minzoom))
  const bands = [...new Set([
    firstZoom,
    ...glyphLayers.map(l => l.minzoom),
    ...RANK_STEPS.slice(1).map(([z]) => z),
  ])].filter(z => z >= firstZoom).sort((a, b) => a - b)

  /**
   * A badge is drawn exactly where some glyph layer that is live at this zoom
   * would draw over it — the layers' own filters OR'd together, under the same
   * rank limit their own gates use at that zoom.
   *
   * Gating on a union of `class` values instead is what put empty discs on the
   * map: `Transport` admits a car park only if the geometry is a point, and
   * `Shopping` only if the feature is named, but a class union let every car
   * park and every unnamed shop through and left the disc standing on its own.
   */
  const earnsGlyph = zoom => {
    const live = glyphLayers.filter(l => l.minzoom <= zoom)
    if (!live.length) return false
    const owns = live.map(l => l.own)
    const any = owns.includes(true) ? true : owns.length === 1 ? owns[0] : ['any', ...owns]
    const limit = rankLimitAt(zoom)
    if (limit === Infinity) return any
    const rank = ['<=', RANK, limit]
    return any === true ? rank : ['all', any, rank]
  }

  /**
   * The gate goes in the FILTER, not in paint.
   *
   * A filter that reads `zoom` is evaluated once, when the tile is parsed into
   * buckets, at the tile's own zoom — a paint property is re-evaluated every
   * frame at the map's. The glyph layers carry their rank gate in their
   * filters, so a badge gated in paint was reading a different zoom from the
   * glyph it belonged to: the disc turned up a zoom level or two before its
   * icon, which is the empty circle over a car park that never filled in until
   * you zoomed further. Same expression, same place, same answer.
   *
   * `["zoom"]` is legal only as the direct input of a top-level `step`, so the
   * step is outermost and every branch is zoom-free.
   */
  const gateFilter = () => {
    const out = ['step', ['zoom'], earnsGlyph(bands[0])]
    for (const zoom of bands.slice(1)) out.push(zoom, earnsGlyph(zoom))
    return out
  }

  return {
    id: 'POI badge',
    type: 'circle',
    source: SOURCE,
    'source-layer': 'poi',
    minzoom: firstZoom,
    filter: ['all', ['==', ['geometry-type'], 'Point'], gateFilter()],
    paint: {
      'circle-color': poiColorExpression(),
      'circle-radius': BADGE_RADIUS_FULL,
      // A hairline ring in the halo colour keeps touching badges apart without
      // reading as an outline.
      'circle-stroke-color': '@poi_halo',
      'circle-stroke-width': 1.5,
    },
  }
}

// ---------------------------------------------------------------------------
// Colour tokens
// ---------------------------------------------------------------------------

const COLOR_RE = /^(#[0-9a-fA-F]{3,8}|rgba?\(|hsla?\()/

function isColor(v) {
  return typeof v === 'string' && COLOR_RE.test(v.trim())
}

function slug(s) {
  return String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

class Tokens {
  constructor() {
    this.byColor = new Map()
    this.light = {}
    this.dark = {}
    this.unmatched = []
  }
  /**
   * Reuse a token whenever the light style repeats a colour, so the two
   * flavors stay small enough to reason about. The dark value is read from
   * the same position in MapTiler's own Streets Dark, whose layer sequence is
   * identical — so dark is their cartography too, not a transform of light.
   */
  ref(color, darkColor, hint) {
    const key = color.trim()
    if (this.byColor.has(key)) return `@${this.byColor.get(key)}`
    let name = hint
    let n = 2
    while (name in this.light) name = `${hint}_${n++}`
    this.byColor.set(key, name)
    this.light[name] = key
    if (isColor(darkColor)) {
      this.dark[name] = darkColor.trim()
    } else {
      // No colour at the matching position — dark keeps the light value and
      // gets reported, so a silent light-on-dark patch cannot slip through.
      this.dark[name] = key
      this.unmatched.push(name)
    }
    return `@${name}`
  }
}

/** Every colour literal inside a value, in document order. */
function colorsIn(value, out = []) {
  if (isColor(value)) out.push(value.trim())
  else if (Array.isArray(value)) value.forEach(v => colorsIn(v, out))
  else if (value && typeof value === 'object') Object.values(value).forEach(v => colorsIn(v, out))
  return out
}

/**
 * Tokenize one paint/layout property, pairing its colours with the dark
 * style's by position within the same property rather than by JSON path.
 *
 * Path matching does not survive the two styles expressing the same ramp
 * differently — light writes `{stops: [[6, a], [14, b]]}` where dark writes
 * `["interpolate", ["exponential", 1], ["zoom"], 6, a, 14, b]`. Both still
 * hold two colours in the same order, so ordinal pairing lines them up.
 */
function tokenizeProperty(value, darkValue, tokens, hint, fallbackDark) {
  const darkColors = colorsIn(darkValue)
  let i = 0
  const walk = v => {
    if (isColor(v)) {
      // Ran past the end (dark expresses fewer stops) — reuse its last colour
      // rather than leaving a light value on a dark map.
      const dark = darkColors[i] ?? darkColors[darkColors.length - 1] ?? fallbackDark
      i++
      return tokens.ref(v, dark, hint)
    }
    if (Array.isArray(v)) return v.map(walk)
    if (v && typeof v === 'object') {
      const out = {}
      for (const [k, x] of Object.entries(v)) out[k] = walk(x)
      return out
    }
    return v
  }
  return walk(value)
}

/** Tokenize a whole paint or layout block, property by property. */
function tokenizeSection(section, darkSection, tokens, hint) {
  if (!section) return section
  // When dark drops a property entirely — it has no `Oneway` icon-color, no
  // `Building` outline — anything coloured in that layer is a better guess
  // than the light value.
  const fallbackDark = colorsIn(darkSection)[0]
  const out = {}
  for (const [prop, value] of Object.entries(section)) {
    out[prop] = tokenizeProperty(value, darkSection?.[prop], tokens, `${hint}_${slug(prop)}`, fallbackDark)
  }
  return out
}

// ---------------------------------------------------------------------------

async function main() {
  const style = JSON.parse(await readFile(SRC, 'utf8'))
  const darkStyle = JSON.parse(await readFile(SRC_DARK, 'utf8'))
  const darkById = new Map(darkStyle.layers.map(l => [l.id, l]))
  const tokens = new Tokens()
  const layers = []
  const dropped = []

  for (const layer of style.layers) {
    const sl = layer['source-layer']
    const dark = darkById.get(layer.id)

    if (layer.source === 'maptiler_attribution') {
      dropped.push([layer.id, 'attribution source'])
      continue
    }
    if (sl && !AVAILABLE.has(sl)) {
      dropped.push([layer.id, `source-layer "${sl}" not in our tiles`])
      continue
    }
    if (DROP_LAYERS.has(layer.id)) {
      dropped.push([layer.id, 'network-specific shield art we do not have'])
      continue
    }

    const out = { ...layer }
    if (out.source) out.source = SOURCE
    delete out.metadata

    if (out.layout?.['text-font']) {
      out.layout = { ...out.layout, 'text-font': singleFont(out.layout['text-font']) }
    }

    const hint = slug(layer.id)
    // Layer-wide fallback so a dark layer that colours nothing at all still
    // yields something darker than the light value.
    const layerDark = colorsIn(dark?.paint)[0] ?? colorsIn(dark?.layout)[0]
    if (out.paint) out.paint = tokenizeSection(out.paint, dark?.paint ?? { _: layerDark }, tokens, hint)
    if (out.layout) out.layout = tokenizeSection(out.layout, dark?.layout ?? { _: layerDark }, tokens, hint)

    // POI icon + tint come from Parchment's own category system. The label
    // takes the same colour as the icon, which is how MapTiler letters theirs
    // — only keyed to our categories rather than their families.
    if (sl === 'poi' && out.type === 'symbol') {
      const tint = poiColorExpression()
      out.filter = out.filter
        ? ['all', toExpressionFilter(out.filter), RANK_GATE]
        : RANK_GATE
      out.layout = { ...out.layout, ...POI_LAYOUT, 'icon-image': POI_ICON }
      out.paint = { ...out.paint, ...POI_PAINT, 'text-color': tint }
      for (const prop of POI_PAINT_DROP) delete out.paint[prop]
    }

    // Every shield falls back to the generic rectangle, tinted per flavor.
    if (SHIELD_LAYERS.has(layer.id)) {
      const prefix = layer.id === 'Highway junction' ? 'exit' : 'road'
      out.layout = {
        ...out.layout,
        'icon-image': ['concat', prefix, '_', ['to-string', ['get', 'ref_length']]],
      }
      out.paint = { ...out.paint, 'icon-color': '@shield_fill' }
    }

    layers.push(out)
  }

  // Dots go under the labelled POIs so a glyph always wins the pixel.
  const poiLayers = layers.filter(l => l['source-layer'] === 'poi' && l.type === 'symbol')
  const firstPoi = layers.findIndex(l => l['source-layer'] === 'poi' && l.type === 'symbol')
  if (firstPoi >= 0) layers.splice(firstPoi, 0, poiBadgeLayer(poiLayers))

  // Rewriting the POI layers strands MapTiler's 11 family colours, which
  // nothing references any more. Drop them so the dark flavor only has to
  // answer for tokens the map actually draws with.
  const used = new Set()
  const collect = v => {
    if (typeof v === 'string' && v.startsWith('@')) used.add(v.slice(1))
    else if (Array.isArray(v)) v.forEach(collect)
    else if (v && typeof v === 'object') Object.values(v).forEach(collect)
  }
  layers.forEach(collect)
  const orphaned = Object.keys(tokens.light).filter(t => !used.has(t))
  for (const t of orphaned) {
    delete tokens.light[t]
    delete tokens.dark[t]
  }

  // POI label halo. Standard switches these two with `measure-light`; we bake
  // the same pair per flavor. Identical values to SEARCH_RESULTS_LAYER_CONFIG.
  tokens.light.poi_halo = '#FFFFFF'
  tokens.dark.poi_halo = '#0D0D0D'

  // Glyph ink — the surface the glyph is knocked out to, so it tracks the map
  // beneath rather than staying white. The dark flavor fills badges with the
  // palette's night tints, which are pale; a white glyph on those washes out,
  // where a dark one reads the way Mapbox's own `{maki}-dark` badge art does.
  tokens.light.poi_ink = '#FFFFFF'
  tokens.dark.poi_ink = '#0D0D0D'

  // Shield fill is ours, not MapTiler's — their shields are sprite art.
  tokens.light.shield_fill = 'hsl(0, 0%, 100%)'
  tokens.dark.shield_fill = DARK_OVERRIDES.shield_fill_2

  for (const [name, color] of Object.entries(DARK_OVERRIDES)) {
    if (name in tokens.dark && !name.startsWith('shield_')) tokens.dark[name] = color
  }

  // Category palette tokens, resolved at runtime from the app's own palette
  // so basemap POIs match the colours search results already use.
  for (const category of [...Object.keys(POI_CATEGORY), 'default']) {
    tokens.light[`poi_${category}`] = `@@category:${category}`
    tokens.dark[`poi_${category}`] = `@@category:${category}`
  }

  await writeFile(OUT_SPEC, `${JSON.stringify({ layers }, null, 1)}\n`)
  await writeFile(OUT_TOKENS, `${JSON.stringify(tokens.light, null, 1)}\n`)
  await writeFile(OUT_TOKENS_DARK, `${JSON.stringify(tokens.dark, null, 1)}\n`)

  console.log(`layers: ${layers.length} kept, ${dropped.length} dropped`)
  for (const [id, why] of dropped) console.log(`   drop ${id} — ${why}`)
  console.log(`colour tokens: ${Object.keys(tokens.light).length - 9} + 9 category`)
  const stillUnmatched = tokens.unmatched.filter(t => !orphaned.includes(t))
  if (stillUnmatched.length)
    console.log(`no dark counterpart (kept light): ${stillUnmatched.join(', ')}`)
  if (orphaned.length) console.log(`pruned unused: ${orphaned.join(", ")}`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
