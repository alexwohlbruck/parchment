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

import { buildingColor, BUILDING_TINT } from '../src/lib/map-style/building-color.mjs'
import { isTransitPoi } from '../src/lib/map-style/transit-poi.mjs'

const SOURCE = 'openmaptiles'

/** Footprint outline that stands in for the roofline in the plan view. */
const BUILDING_ROOF_EDGE_LAYER = 'Building roof edge'

/**
 * Where the 3D buildings switch on.
 *
 * MapTiler starts them at 15, which is close enough that a skyline only comes
 * together once most of it is off screen — you cannot see Lower Manhattan as a
 * skyline at all. 14 is as low as the data goes: our tiles carry the full
 * `building` layer with `render_height` on every feature at 14, and at 13
 * essentially nothing (one feature in the tile over Lower Manhattan), so a
 * lower number would switch the layer on over an empty source.
 */
const BUILDING_3D_MINZOOM = 14

/** How much zoom the buildings take to grow in, past the layer's minzoom. */
const BUILDING_GROW_ZOOM = 0.4


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
 * Gated on an explicit list rather than attempting the lookup: `coalesce`
 * around a missing image still draws, but logs a warning per feature per
 * tile, which buried the console on the first render.
 *
 * `prefix` picks the form: bare glyphs for the glyph-only treatment, and
 * `badge-` for the badge treatment, whose sprite carries the disc and the
 * knocked-out glyph as one image (see `build-sprite.mjs`).
 */
function poiIcon(prefix = '') {
  const named = name => (prefix ? ['concat', prefix, name] : name)
  return [
    'coalesce',
    ['image', named(['match', ['get', 'subclass'], ICON_SUBCLASSES, ['get', 'subclass'], ['coalesce', ['get', 'class'], '']])],
    ['image', named(['coalesce', ['get', 'class'], ''])],
  ]
}

const POI_ICON = poiIcon()

/**
 * Transit classes, which wear a rounded square plate rather than a disc.
 *
 * Mapbox draws stops this way and it is worth copying: shape separates a stop
 * from a shop far more sharply than colour does at badge size, and a station is
 * a different *kind* of thing from a place — you route to it rather than visit
 * it. The square art is `tile-` in the sprite; see `build-sprite.mjs`.
 */
/** The icon stem for a feature: its subclass where the sprite has one, else its class. */
const POI_ICON_STEM = [
  'match',
  ['get', 'subclass'],
  ICON_SUBCLASSES,
  ['get', 'subclass'],
  ['coalesce', ['get', 'class'], ''],
]

/**
 * The badge image, named rather than drawn from the sheet.
 *
 * A badge is four colours — a lift, an outline, a tinted plate and the glyph —
 * and a symbol layer offers two. The sprite's art carries the shape; the name
 * carries the colours, and `poi-badge.ts` composites the two the first time
 * MapLibre asks for one. Naming them here rather than resolving colours in that
 * module is what keeps the palette live and every colour decision in the style.
 *
 * A square plate for transit, a disc for everything else — see `TILE_PREFIX`.
 */
const poiTint = kind => [
  'case',
  isTransitPoi(),
  `@poi_transit_${kind}`,
  ['match', ['get', 'class'],
    ...Object.entries(POI_CATEGORY).flatMap(([category, classes]) => [classes, `@poi_${kind}_${category}`]),
    `@poi_${kind}_default`],
]

const POI_PLATE_ICON = [
  'concat',
  'poi|',
  ['case', isTransitPoi(), 'tile-', 'badge-'],
  POI_ICON_STEM,
  '|', poiTint('plate'),
  '|', poiTint('ink'),
  '|', poiTint('ring'),
  '|', '@poi_lift',
]

/** True where the feature is a transit stop, for size and colour. */
const IS_TRANSIT_POI = isTransitPoi()

/**
 * Hand corrections where MapTiler's dark style has no counterpart to read, or
 * where the counterpart it has does not survive our own palette.
 *
 * Their dark Oneway layer drops `icon-color` entirely and leans on its own
 * sprite art, which would otherwise leave a light-grey arrow on a dark road.
 *
 * Sand is theirs — `hsl(195, 64%, 22%)`, a cyan — and it is the most saturated
 * fill on our night map by a wide margin: the ground sits at 37% saturation,
 * woodland at 47%, grass at 33%. Every one of those is a cool hue too, so the
 * beach did not read as a lighter shade of anything, it read as a band of
 * turquoise laid between the town and the sea. Ours keeps the light map's warm
 * hue instead of inverting it, drops the saturation to where the rest of the
 * palette sits, and takes a lightness a few points above the ground so a beach
 * is a pale strip against the land and clearly above the water. Sand is also
 * what deserts draw with, so it has to hold at continent scale without
 * glowing.
 */
const DARK_OVERRIDES = {
  oneway_icon_color: 'hsl(0, 0%, 42%)',
  sand_fill_color: 'hsl(42, 19%, 30%)',
}

/**
 * Route shields, rebuilt on Mapbox Standard's `road-number-shield` — see that
 * layer in `src/components/map/styles/standard.json`.
 *
 * MapTiler splits the job across four layers: a generic one, a US one, and two
 * that stack interstate art on top. We collapse all four into one, the way
 * Standard does, because the art is now per-network in our own sprite and a
 * single `icon-image` expression can choose it: network and ref length are
 * concatenated into a sprite name, with `default-{n}` behind a `coalesce` for
 * any network we have no marker for.
 *
 * `Highway junction` stays separate — exit tabs come off a different subclass
 * and want their own placement.
 */
const SHIELD_LAYER = 'Highway shield'
const JUNCTION_LAYER = 'Highway junction'
const DROP_LAYERS = new Map([
  // MapTiler filters this on `class in ("path_pedestrian")`, which is not a
  // class any feature carries — the layer has never drawn anything, and what
  // it would have drawn is what `Path` already does.
  ['Path minor', 'filters on a class no feature has'],
  ['Highway shield (US)', `folded into "${'Highway shield'}"`],
  ['Highway shield interstate top (US)', `folded into "${'Highway shield'}"`],
  ['Highway shield interstate (US)', `folded into "${'Highway shield'}"`],
])

/**
 * The sprite names the shield art actually ships, read back from the sheet the
 * sprite builder writes.
 *
 * The style has to know this because the text colour depends on which marker
 * gets drawn, not on the route's network: a five-character interstate ref has
 * no interstate art, falls through to the white `default-5` plaque, and would
 * be lettered in white on white if the colour followed the network alone.
 * Standard solves the same problem at runtime with `to-boolean(coalesce(image
 * …))`; reading the manifest at build time says the same thing in one place
 * and keeps it impossible for the two to drift.
 */
async function shieldImages() {
  const sheet = JSON.parse(await readFile(resolve(WEB, 'public/sprites/parchment.json'), 'utf8'))
  return new Set(Object.keys(sheet).filter(name => /^[a-z-]+-\d$/.test(name)))
}

/**
 * Institutional land use, which MapTiler draws on top of natural land cover.
 *
 * That ordering says a campus boundary matters more than what is physically on
 * the ground inside it, and in a city it is plainly wrong: NYU's landuse
 * polygon covers Washington Square Park, so the park came out as a pale blue
 * university tint with only the one corner outside the campus showing green.
 * Several blocks around it went the same way.
 *
 * A zone is an administrative fact and land cover is a physical one, so the
 * physical one wins: these sink below the `landcover` fills. The tint still
 * reads on the built-up parts of a campus, where there is no cover to hide it.
 *
 * `Stadium` is deliberately not in the list, though MapTiler groups it with
 * these: its classes are `pitch` and `playground` as well as `stadium`, and a
 * ballfield is a physical surface like the grass around it rather than a zone
 * drawn over one. Sunk, it came out as a pale patch of the park it sits in —
 * its own colour showing through half-opacity grass — which is the same failure
 * as the campus, one layer down.
 */
const INSTITUTIONAL_LANDUSE = ['Cemetery', 'Hospital', 'School']

/** Sports surfaces — `pitch`, `playground` and `stadium` share one layer. */
const PITCH_LAYER = 'Stadium'

// ---------------------------------------------------------------------------
// Pedestrian paths and areas
// ---------------------------------------------------------------------------

/**
 * Sidewalks, footpaths and plazas, on Mapbox Standard's treatment — see
 * `road-path`, `road-path-case` and `road-pedestrian-polygon-fill` in
 * `styles/standard.json`.
 *
 * MapTiler draws these the other way round: a wide *white* band with a thin
 * grey dashed line on top of it, which reads as a dotted trail rather than as
 * something paved. Standard draws a near-white surface with a fine grey
 * casing, so a sidewalk reads as a narrow version of the road next to it. That
 * is what these rebuild.
 *
 * The casing is `line-width` around a `line-gap-width`, which is how you draw
 * an outline around a line rather than under it: the gap is the surface, and
 * the stroke straddles its two edges.
 */
const PATH_CASING_LAYER = 'Path outline'
const PATH_LAYER = 'Path'
const PEDESTRIAN_AREA_LAYER = 'Pedestrian'
const PEDESTRIAN_AREA_CASING_LAYER = 'Pedestrian area outline'

/** The lowest road layer — the casings, which everything else stacks onto. */
const FIRST_ROAD_LAYER = 'Minor road outline'

// ---------------------------------------------------------------------------
// Road ink
// ---------------------------------------------------------------------------

/**
 * The whole road network's colour, in one place, for both flavors.
 *
 * MapTiler paints motorways orange and trunk roads yellow, which is the
 * convention nearly every digital map inherited from paper road atlases, where
 * the colour did real work: it was how you found a route at a glance on a sheet
 * with no zoom. On a screen it mostly reads as a warning. So the daylight map
 * gives up the hue and keeps the hierarchy, which is what the hierarchy was for
 * — a motorway is a shade of the ground rather than a colour laid over it, and
 * everything below it is white, separated by how heavy its casing is.
 *
 * Lifted out of the layers because the same six colours are spread across nine
 * of them — surface, tunnel, and under-construction each split the network the
 * same three ways — and MapTiler's own values only agree with each other by
 * coincidence. `applyRoadInk` puts them back.
 *
 * Night keeps MapTiler's blue-slate family, with the minor roads pulled in
 * towards the majors: theirs are a saturated cyan that reads as water at a
 * glance, which on a map with real water on it is the one thing a road must
 * not do.
 */
const ROAD_INK = {
  light: {
    highway: 'hsl(42, 22%, 87%)',
    highway_casing: 'hsl(40, 16%, 72%)',
    major: 'hsl(0, 0%, 100%)',
    major_casing: 'hsl(40, 15%, 77%)',
    minor: 'hsl(0, 0%, 100%)',
    minor_casing: 'hsl(40, 14%, 84%)',
  },
  dark: {
    highway: 'hsl(211, 47%, 33%)',
    highway_casing: 'hsl(211, 41%, 39%)',
    major: 'hsl(211, 44%, 40%)',
    major_casing: 'hsl(212, 38%, 52%)',
    minor: 'hsl(211, 22%, 34%)',
    minor_casing: 'hsl(213, 20%, 24%)',
  },
}

/**
 * The daylight land, in one place: the ground everything sits on and every
 * class of land drawn onto it.
 *
 * MapTiler's land is a pale near-neutral with the landuse classes barely
 * tinted over it, which is a restrained map and a flat one — at a glance a
 * park, a campus and a block of housing are the same colour, so the only thing
 * carrying the city is its road network. Apple's daylight map is the argument
 * for the opposite: a warm cream ground with land that is allowed to be
 * coloured, so a neighbourhood has a shape before a single label is read.
 *
 * So the ground goes back to a cream — warmer and more saturated than
 * MapTiler's, which the app's near-white chrome (#F7F6F9, #F6F9F7, #F9F6F6,
 * #F9F8F6) sits over as a surface rather than blending into — and the land
 * classes come up with it, and further than Apple takes them: a storybook
 * green for anything planted, a sky blue for water, amber for campuses, rose
 * for hospitals, sand for beaches. Saturation is what a map has instead of
 * labels at a glance, and this one can afford to spend it.
 *
 * Lightness is the part that does not move. Every contrast on the daylight map
 * is a lightness relationship — buildings sit just off the ground, roof edges
 * far below it, pavement between the two — so saturating a class without
 * moving it in value adds colour and disturbs nothing that was tuned.
 */
const LIGHT_LAND = {
  background_background_color: 'hsl(44, 52%, 93%)',
  background_background_color_2: 'hsl(44, 46%, 92%)',
  residential_fill_color: 'hsl(43, 40%, 88%)',
  residential_fill_color_2: 'hsl(43, 44%, 90%)',
  pier_fill_color: 'hsl(44, 44%, 92%)',
  bridge_outline_line_color: 'hsl(44, 44%, 92%)',
  // Industrial land is a neutral in MapTiler too, just a warm one; the two
  // translucent members keep their alpha, which is what they are for.
  industrial_fill_color: 'hsl(40, 18%, 89%)',
  industrial_fill_color_2: 'hsla(40, 18%, 86%, 0.2)',
  industrial_fill_color_3: 'hsl(40, 14%, 87%)',
  industrial_fill_color_4: 'hsl(40, 18%, 89%)',
  industrial_fill_color_5: 'hsla(40, 18%, 86%, 0.5)',
  // Anything planted, in one green family. Grass reads far paler than it looks
  // here — its layer draws at half opacity over the ground, deliberately, so
  // that a park edge softens rather than cuts — so the token is pitched about
  // as far past the intended green as the blend pulls it back: on the map it
  // lands near hsl(97, 55%, 70%), a shade below the wood it borders.
  grass_fill_color: 'hsl(101, 70%, 60%)',
  wood_fill_color: 'hsl(92, 50%, 68%)',
  stadium_fill_color: 'hsl(98, 64%, 72%)',
  // A pitch is a made surface with a boundary, so it gets an edge — the
  // same green a shade down, which reads as the line around a field rather
  // than as a second colour.
  stadium_outline_color: 'hsl(98, 60%, 60%)',
  cemetery_fill_color: 'hsl(90, 34%, 82%)',
  // A campus is amber, not the pale blue MapTiler gives it: blue on a map with
  // water on it is a colour that already means something else. Yellow rather
  // than orange, and light: the polygons are large, and at this size an orange
  // one stops reading as a wash over the ground and starts reading as a slab.
  school_fill_color: 'hsl(48, 88%, 85%)',
  hospital_fill_color: 'hsl(4, 78%, 88%)',
  sand_fill_color: 'hsl(46, 92%, 80%)',
  airport_zone_fill_color: 'hsl(42, 18%, 91%)',
  // The flat building fill, for the zooms below the extrusions. Its layer draws
  // at 0.3, so the token is well past where the buildings land.
  building_fill_color: 'hsl(38, 28%, 64%)',
  building_fill_outline_color: 'hsla(38, 24%, 74%, 0.3)',
  building_fill_outline_color_2: 'hsl(38, 24%, 74%)',
  // The water the land meets. MapTiler's is already a bright blue, but a pale
  // one, and next to greens this saturated it reads as the thing that faded.
  water_fill_color: 'hsl(202, 88%, 68%)',
  water_intermittent_fill_color: 'hsl(203, 84%, 78%)',
  river_line_color: 'hsl(206, 82%, 66%)',
  river_tunnel_line_color: 'hsl(206, 82%, 66%)',
  aqueduct_line_color: 'hsl(202, 88%, 68%)',
}

/** `class` values each rung of the hierarchy covers, as the tunnel layers split them. */
const ROAD_RUNG = { highway: ['motorway'], major: ['trunk', 'primary'] }

/** A `match` on road class picking one of the three rungs, for the mixed layers. */
const roadMatch = (suffix = '') => [
  'match', ['get', 'class'],
  ROAD_RUNG.highway, `@road_highway${suffix}`,
  ROAD_RUNG.major, `@road_major${suffix}`,
  `@road_minor${suffix}`,
]

/** The same, for the `*_construction` classes the under-construction layer carries. */
const constructionMatch = () => [
  'match', ['get', 'class'],
  ROAD_RUNG.highway.map(c => `${c}_construction`), '@road_highway',
  ROAD_RUNG.major.map(c => `${c}_construction`), '@road_major',
  '@road_minor',
]

/**
 * How opaque a tunnelled way is drawn.
 *
 * A tunnel is under the ground, and MapTiler draws the road ones at full
 * strength with only a dashed casing to say so — which at a glance reads as a
 * road, so an interchange with a tunnel through it looks like a junction that
 * is not there. Letting the ground show through is the cheapest way to say
 * "below", and it costs no extra layer.
 *
 * Applied as a ceiling rather than a value: the river, railway and footway
 * tunnels are already fainter than this, and setting them *to* it would make
 * them more prominent, which is the opposite of the point.
 */
const TUNNEL_OPACITY = 0.6

/** Every tunnelled way, faded to at most `TUNNEL_OPACITY`. */
function fadeTunnels(layers) {
  for (const layer of layers) {
    if (!/tunnel/i.test(layer.id) || layer.type !== 'line') continue
    const current = layer.paint?.['line-opacity']
    layer.paint = {
      ...layer.paint,
      'line-opacity': Math.min(typeof current === 'number' ? current : 1, TUNNEL_OPACITY),
    }
  }
}

/**
 * Repaint every road layer from `ROAD_INK`.
 *
 * Tunnels and roads under construction are included deliberately: they are the
 * same network seen through a different treatment, and leaving them on
 * MapTiler's values is how a tunnel ends up orange on a map with no orange in
 * it. Their dashes and lower opacity already say what they are.
 */
function applyRoadInk(layers) {
  const repaint = {
    'Minor road': '@road_minor',
    'Minor road outline': '@road_minor_casing',
    'Major road': '@road_major',
    'Major road outline': '@road_major_casing',
    Highway: '@road_highway',
    'Highway outline': '@road_highway_casing',
    Tunnel: roadMatch(),
    'Tunnel outline': roadMatch('_casing'),
    'Road under construction': constructionMatch(),
  }
  for (const layer of layers) {
    const color = repaint[layer.id]
    if (color && layer.paint) layer.paint['line-color'] = color
  }
}

/**
 * How much wider the lower rungs of the network are drawn than MapTiler draws
 * them.
 *
 * Their ramps are cut for a map whose roads carry colour: a motorway is orange
 * and a residential street is white, so the street can be a hairline and still
 * be found. This map gave the colour up (see `ROAD_INK`) and left the hierarchy
 * to weight alone — which put the whole burden on a stroke that was never sized
 * to carry it, and a residential grid came out as a mesh of threads.
 *
 * Weighted rather than flat, so widening the bottom of the network does not
 * flatten it into the top: a service road gains half again, a secondary barely
 * moves, and the gaps between the rungs stay in the same order.
 *
 * Only the `Minor road` pair. The trunk-and-above layers were legible already,
 * and lifting them too would just restore the same ratios one size up.
 */
const ROAD_WIDEN = {
  secondary: 1.15,
  tertiary: 1.3,
  minor: 1.5,
  service: 1.5,
  track: 1.5,
}
/** For the `match`'s fallback arm — an unclassified road is a minor one. */
const ROAD_WIDEN_DEFAULT = 1.5

/**
 * The least ink a minor road's casing may show either side of its surface.
 *
 * MapTiler's two ramps converge as they climb — at z16 a residential street's
 * casing is 4px against a 4px surface, which is no casing at all — so the
 * street loses its edge over exactly the range you browse at and comes back
 * once you are past it. Widening both ramps together preserves that, so the
 * casing is given a floor as well: whatever the scale says, it clears the
 * surface by this much on each side.
 */
const MINOR_CASING_WEIGHT = { 12: 0.5, 14: 0.75, 16: 1, 20: 1.5 }

/** The scale for one `match` arm, by the first class it names. */
const widenFor = className =>
  (className && ROAD_WIDEN[className]) || ROAD_WIDEN_DEFAULT

/** Round off the float noise a scale leaves behind; widths are drawn in px. */
const px = n => Math.round(n * 100) / 100

/**
 * Walk the per-class arms of one zoom stop.
 *
 * A stop is either a bare width — the low-zoom end, where every class draws the
 * same — or a `match` on `class`. `visit` is handed each arm's width and the
 * first class that arm names, and returns the width to put back.
 */
function mapClassWidths(value, visit) {
  if (typeof value === 'number') return visit(value, null)
  if (!Array.isArray(value) || value[0] !== 'match') return value
  const out = value.slice()
  for (let i = 2; i < out.length - 1; i += 2) {
    const arm = Array.isArray(out[i]) ? out[i][0] : out[i]
    out[i + 1] = visit(out[i + 1], arm)
  }
  out[out.length - 1] = visit(out[out.length - 1], null)
  return out
}

/**
 * Stop a widened stop from putting a rung above the one over it.
 *
 * The arms of these `match`es run high rank to low, and MapTiler draws several
 * of the pairs at the same width — secondary and tertiary are both 8px at z16.
 * Scaling those by different factors is what ranks them, and it ranks them the
 * wrong way round: the smaller factor on the higher rung leaves the lower rung
 * wider. So each arm is raised to at least the widest arm below it, which
 * flattens an inversion back to a tie rather than narrowing a road that the
 * whole pass exists to widen.
 */
function flattenInversions(value) {
  if (!Array.isArray(value) || value[0] !== 'match') return value
  const out = value.slice()
  let widest = out[out.length - 1]
  for (let i = out.length - 2; i >= 3; i -= 2) {
    widest = Math.max(out[i], widest)
    out[i] = widest
  }
  return out
}

/** The width one stop draws for the arm at `index`, for comparing two ramps. */
function classWidthAt(value, index) {
  if (typeof value === 'number') return value
  if (!Array.isArray(value) || value[0] !== 'match') return null
  return index === null ? value[value.length - 1] : value[index * 2 + 3]
}

/** `['interpolate', interpolation, ['zoom'], z1, v1, ...]` as `[zoom, value]` pairs. */
function zoomStops(expression) {
  const stops = []
  for (let i = 3; i < expression.length; i += 2) stops.push([expression[i], i + 1])
  return stops
}

/**
 * Widen the bottom of the road network, and stop its casings collapsing.
 *
 * Done here rather than in `spec.json` so a regenerated spec keeps it: the spec
 * is MapTiler's layers with our colours substituted, and every other departure
 * from their cartography is a pass over the layer list like this one.
 */
function widenLowerRoads(layers) {
  const surface = layers.find(l => l.id === 'Minor road')
  const casing = layers.find(l => l.id === 'Minor road outline')
  if (!surface || !casing) return

  for (const layer of [surface, casing]) {
    const width = layer.paint?.['line-width']
    if (!Array.isArray(width) || width[0] !== 'interpolate') continue
    for (const [, at] of zoomStops(width)) {
      width[at] = mapClassWidths(width[at], (w, className) =>
        px(w * widenFor(className)),
      )
    }
  }

  // Both ramps carry the same class groupings at the stops that have them, so
  // an arm's index means the same thing in each and the two can be compared
  // arm by arm.
  const surfaceWidth = surface.paint['line-width']
  const casingWidth = casing.paint['line-width']
  const surfaceAt = Object.fromEntries(
    zoomStops(surfaceWidth).map(([zoom, at]) => [zoom, surfaceWidth[at]]),
  )
  for (const [zoom, at] of zoomStops(casingWidth)) {
    const weight = MINOR_CASING_WEIGHT[zoom]
    const beneath = surfaceAt[zoom]
    if (weight === undefined || beneath === undefined) continue
    let arm = -1
    casingWidth[at] = mapClassWidths(casingWidth[at], (w, className) => {
      arm++
      const under = classWidthAt(beneath, className === null ? null : arm)
      return under === null ? w : px(Math.max(w, under + weight * 2))
    })
  }

  for (const width of [surfaceWidth, casingWidth]) {
    for (const [, at] of zoomStops(width)) width[at] = flattenInversions(width[at])
  }
}

/** The paved surface's width. Standard's ramp, which is exponential, not linear. */
const PATH_SURFACE_WIDTH = [
  'interpolate', ['exponential', 1.5], ['zoom'], 12, 0, 18, 6, 22, 80,
]
/**
 * The casing straddling the surface's edges.
 *
 * `line-width` is the whole stroke and it is centred on the edge, so half of
 * this lands on the pavement and half on the ground beside it — a 3px casing
 * reads as a 1.5px line either side.
 */
const PATH_CASING_WIDTH = [
  'interpolate', ['exponential', 1.5], ['zoom'], 14, 1.2, 18, 3, 22, 4.5,
]

/**
 * Draw every casing, then every surface — the ordering the whole effect rests
 * on, and the reason these four layers have to sit together.
 *
 * A path running across a plaza is one continuous pavement in life. Drawn
 * naively, the path's casing is painted over the plaza and the path shows up as
 * a channel scored across it. Putting all the casings underneath all the
 * surfaces means the plaza's own fill covers the casing of every path inside
 * it, while a path leaving the plaza keeps its casing the moment it is over
 * open ground — and the path's surface covers the plaza's outline where the two
 * meet, so there is no seam at the join either.
 *
 * The block lands where the paths already were, after the roads. That is also
 * where Standard puts its pedestrian polygon, and it costs the one case where a
 * road crosses a square: the square is drawn over it. Pedestrian areas are
 * car-free by definition, so that is the cheaper of the two errors.
 */
/** Ground level: not a bridge, and not stacked above the surface. */
const AT_GRADE = [
  'all',
  ['!=', ['get', 'brunnel'], 'bridge'],
  ['<=', ['case', ['has', 'layer'], ['to-number', ['get', 'layer']], 0], 0],
]
/** Carried over whatever it crosses. */
const ELEVATED = [
  'any',
  ['==', ['get', 'brunnel'], 'bridge'],
  ['>', ['case', ['has', 'layer'], ['to-number', ['get', 'layer']], 0], 0],
]

function withCondition(layer, condition, suffix) {
  const base = layer.filter ? toExpressionFilter(layer.filter) : null
  return {
    ...layer,
    id: suffix ? `${layer.id}${suffix}` : layer.id,
    filter: base ? ['all', base, condition] : condition,
  }
}

/** Whatever zoom the path casing starts at, so the plaza edge matches it. */
function pathCasingMinzoom(layers) {
  return layers.find(l => l.id === PATH_CASING_LAYER)?.minzoom ?? 12
}

function orderPedestrianSurfaces(layers) {
  const take = id => {
    const at = layers.findIndex(l => l.id === id)
    return at < 0 ? null : layers.splice(at, 1)[0]
  }
  const area = take(PEDESTRIAN_AREA_LAYER)
  const areaCasing = take(PEDESTRIAN_AREA_CASING_LAYER)
  const pathCasing = take(PATH_CASING_LAYER)
  const path = take(PATH_LAYER)
  if (!pathCasing || !path) return

  // At grade, a pavement is the lowest thing on the street: a road crossing it
  // is drawn over it, and so is any building standing on it. Plazas are only
  // ever at grade — their layer already excludes anything with a `brunnel`.
  const ground = [
    areaCasing,
    withCondition(pathCasing, AT_GRADE),
    area,
    withCondition(path, AT_GRADE),
  ].filter(Boolean)

  // A footbridge is the exception, and the reason this is split at all: it
  // crosses over the road rather than under it, so it is drawn after every road
  // and rail — but still below the buildings.
  const elevated = [
    withCondition(pathCasing, ELEVATED, ' bridge'),
    withCondition(path, ELEVATED, ' bridge'),
  ]

  const roads = layers.findIndex(l => l.id === FIRST_ROAD_LAYER)
  layers.splice(roads < 0 ? layers.length : roads, 0, ...ground)

  const buildings = layers.findIndex(l => l['source-layer'] === 'building')
  layers.splice(buildings < 0 ? layers.length : buildings, 0, ...elevated)
}

/**
 * Road markings belong to the roadway, so a building standing over one hides it.
 *
 * MapTiler draws the one-way arrows up with the labels, well past the buildings,
 * which leaves them floating over a tower the moment the camera tilts. Moving
 * the layer below the buildings is all it takes: the buildings are opaque and
 * are drawn afterwards, so they simply paint over it.
 *
 * The same move is *not* available to the POI layers, which is why only this one
 * is made. MapLibre decides depth-testing by the first 3D layer in the style —
 * everything at or after it draws with depth disabled (`opaquePassCutoff` in
 * `painter.ts`) — so the only way to have a building occlude a symbol is to
 * order the symbol underneath it, and a POI ordered underneath a building
 * disappears under its roof in plan view as well. Mapbox solves that with
 * `symbol-z-elevate`, lifting the symbol to roof height; MapLibre has no
 * equivalent, and `symbol-height-offset` takes metres rather than a reference to
 * whatever the symbol is standing on.
 */
const ROAD_MARKING_LAYER = 'Oneway'

function sinkRoadMarkings(layers) {
  const at = layers.findIndex(l => l.id === ROAD_MARKING_LAYER)
  if (at < 0) return
  const [marking] = layers.splice(at, 1)
  const buildings = layers.findIndex(l => l['source-layer'] === 'building')
  layers.splice(buildings < 0 ? layers.length : buildings, 0, marking)
}

/**
 * Sand, on top of every green it can sit inside.
 *
 * Grass draws at half opacity so a park edge softens rather than cuts, and it
 * is the last cover in MapTiler's order; a pitch is opaque and, since it stops
 * being sunk with the campuses, draws later still. Sand is almost always inside
 * one of the two — a baseball infield, a bunker, a playground pit — so under
 * either it is invisible or washed green. The rule for surfaces is size: the
 * smaller, more specific one is what you are looking at, so sand goes last.
 */
const SURFACES_BELOW_SAND = ['Grass', PITCH_LAYER]

function raiseSandAboveSurfaces(layers) {
  const sand = layers.findIndex(l => l.id === 'Sand')
  const last = Math.max(...SURFACES_BELOW_SAND.map(id => layers.findIndex(l => l.id === id)))
  if (sand < 0 || last < 0 || sand > last) return
  const [fill] = layers.splice(sand, 1)
  layers.splice(last, 0, fill)
}


/**
 * The outline around a pitch.
 *
 * `fill-outline-color` rather than a line layer: it is one pixel wide at every
 * zoom, which is what a boundary line wants to be, and it costs no extra layer
 * or geometry. It rides the fill's own opacity ramp, so the edge fades in with
 * the surface it belongs to instead of arriving before it.
 */
function outlinePitches(layers) {
  const pitch = layers.find(l => l.id === PITCH_LAYER)
  if (!pitch) return
  pitch.paint = { ...pitch.paint, 'fill-outline-color': '@stadium_outline_color' }
}

function sinkInstitutionalLanduse(layers) {
  const moved = INSTITUTIONAL_LANDUSE.map(id => {
    const at = layers.findIndex(l => l.id === id)
    return at < 0 ? null : layers.splice(at, 1)[0]
  }).filter(Boolean)
  const firstCover = layers.findIndex(l => l['source-layer'] === 'landcover')
  layers.splice(firstCover < 0 ? 0 : firstCover, 0, ...moved)
}

/** Longest ref the sprite has `network` art for; longer ones get a plaque. */
function longestRef(art, network) {
  let max = 0
  for (let n = 1; n <= 9; n++) if (art.has(`${network}-${n}`)) max = n
  return max
}

/** The sprite name for a feature's marker, falling back to the plaque. */
function shieldImageExpression() {
  const len = ['to-string', ['get', 'ref_length']]
  return [
    'coalesce',
    ['image', ['concat', ['coalesce', ['get', 'network'], 'default'], '-', len]],
    ['image', ['concat', 'default-', len]],
  ]
}

/**
 * The one route-marker layer, on Standard's geometry: markers appear as points
 * while the map is zoomed out and switch to riding the line at z11, spaced
 * further apart as they get closer.
 */
function routeShieldLayer(layer, art) {
  const interstateMax = longestRef(art, 'us-interstate')
  return {
    minzoom: 6,
    layout: {
      ...layer.layout,
      'icon-image': shieldImageExpression(),
      'icon-rotation-alignment': 'viewport',
      'symbol-placement': ['step', ['zoom'], 'point', 11, 'line'],
      'symbol-spacing': ['interpolate', ['linear'], ['zoom'], 11, 400, 14, 600],
      'icon-size': 1,
      'text-field': ['get', 'ref'],
      'text-font': ['Geist Bold'],
      'text-size': 9,
      'text-letter-spacing': 0.05,
      'text-max-angle': 38,
      'text-rotation-alignment': 'viewport',
      'text-offset': [0, 0.05],
    },
    paint: {
      // White only where the interstate marker is genuinely what gets drawn —
      // a longer ref falls back to the white plaque; see `shieldImages`.
      'text-color': [
        'case',
        [
          'all',
          ['==', ['get', 'network'], 'us-interstate'],
          ['<=', ['get', 'ref_length'], interstateMax],
        ],
        '@shield_ink_reversed',
        '@shield_ink',
      ],
    },
    filter: [
      'all',
      ['has', 'ref'],
      ['<=', ['get', 'ref_length'], 6],
      ['match', ['get', 'class'], ['pedestrian', 'service', 'path'], false, true],
    ],
  }
}

/** Exit tabs: a green plaque with white numerals, as on the sign itself. */
function exitShieldLayer(layer) {
  return {
    layout: {
      ...layer.layout,
      'icon-image': ['concat', 'motorway-exit-', ['to-string', ['get', 'ref_length']]],
      'text-field': ['get', 'ref'],
      'text-font': ['Geist Bold'],
      'text-size': 9,
      'text-offset': [0, 0.05],
    },
    paint: {
      'text-color': '@shield_ink_reversed',
      'text-halo-width': 0,
    },
  }
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
  if (isFontList(node)) return [GEIST[node[0]] ?? GEIST_DEFAULT]
  if (Array.isArray(node)) return node.map(singleFont)
  return node
}

/**
 * MapTiler's Roboto weights, mapped onto the Geist stacks `build-glyphs.mjs`
 * generates. Italic has no Geist face and comes out upright; see that script.
 */
const GEIST_DEFAULT = 'Geist Regular'
const GEIST = {
  'Roboto Regular': 'Geist Regular',
  'Roboto Medium': 'Geist Medium',
  'Roboto Bold': 'Geist Bold',
  'Roboto Italic': 'Geist Regular',
  'Roboto Condensed Italic': 'Geist Regular',
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
 * The badge is one image now, drawn at its natural size.
 *
 * It used to be a circle layer with a glyph layer over it, and the two could
 * not be kept together: circle layers take no part in collision, so either a
 * culled glyph left an empty disc behind, or `icon-allow-overlap` kept every
 * glyph and the badges piled up on each other. `build-sprite.mjs` now bakes
 * the disc with the glyph knocked out of it into a single SDF, so a badge is
 * an ordinary icon and MapLibre places it like one — which is what lets both
 * overlap flags go back to false.
 */
const POI_LAYOUT = {
  'icon-image': POI_PLATE_ICON,
  // Stops draw smaller than places. A transit plate is a wayfinding mark
  // rather than a destination, and at full badge size a dense downtown turns
  // into a wall of them.
  'icon-size': ['case', IS_TRANSIT_POI, 0.78, 1],
  'icon-allow-overlap': false,
  'icon-ignore-placement': false,
  // A weight above the map's own labels. A POI name is a thing you are reading
  // the map *for*, and at 13px over a busy background Regular sits back into
  // the streets around it. Medium rather than SemiBold keeps a step below the
  // transit stops, which are heavier again.
  'text-font': ['Geist Medium'],
  'text-size': 13,
  // Clears the badge — offset is in ems of text-size, so 1.1em ≈ 14px below
  // the icon's centre.
  'text-offset': [0, 1.1],
  'text-anchor': 'top',
  'text-padding': ['interpolate', ['linear'], ['zoom'], 16, 6, 17, 4],
  'text-max-width': 8,
  // Keep the badge when the name would collide — Standard does the same, and
  // it is what stops a dense block from losing its icons along with its labels.
  'text-optional': true,
}

const POI_PAINT = {
  'text-halo-width': 1,
  'text-halo-blur': 0,
  'text-halo-color': '@poi_halo',
  // No `icon-color` and no halo: the badge arrives already coloured. Both used
  // to be set here, and between them they could only ever produce two colours —
  // the plate and one ring, with the glyph left as a hole showing the map. See
  // `poi-badge.ts` for why that is a wall rather than a tuning problem.
}

// ---------------------------------------------------------------------------
// Glyph-only POI treatment (MapTiler Streets v4)
// ---------------------------------------------------------------------------

/**
 * The second POI treatment: a tinted glyph on a halo, no disc under it.
 *
 * Transcribed from MapTiler Streets v4 (vendored alongside v2, key stripped).
 * Their v4 tiles split POIs across `poi_food`, `poi_shopping`, … source-layers
 * that our OpenMapTiles basemap does not have, so their layers cannot be
 * dropped in as-is. What ports is the treatment — family colour, halo, sizes,
 * offsets — applied to the family layers we already derive from v2, whose
 * filters do match our tiles. Icon art stays ours: `build-sprite.mjs` keeps
 * generating it, so nothing here reaches for a MapTiler sprite server.
 *
 * Their family colours, per flavor. `Station` is the one deviation: v4 paints
 * dark-mode stations `hsl(0, 0%, 0%)` because its dark sprite carries its own
 * coloured station art, and a black SDF glyph on our dark map would vanish, so
 * it takes the Transport blue instead.
 */
const V4_FAMILY = {
  Food: { light: 'hsl(18, 44%, 54%)', dark: 'hsl(28, 57%, 72%)' },
  Shopping: { light: 'hsl(18, 2%, 53%)', dark: 'hsl(0, 0%, 70%)' },
  Transport: { light: 'hsl(215, 81%, 35%)', dark: 'hsl(215, 90%, 65%)' },
  Healthcare: { light: 'hsl(6, 96%, 35%)', dark: 'hsl(6, 80%, 70%)' },
  Public: { light: 'hsl(51, 10%, 40%)', dark: 'hsl(52, 10%, 70%)' },
  Tourism: { light: 'hsl(283, 55%, 35%)', dark: 'hsl(283, 55%, 80%)' },
  Culture: { light: 'hsl(315, 35%, 50%)', dark: 'hsl(315, 46%, 81%)' },
  Park: { light: 'hsl(82, 83%, 25%)', dark: 'hsl(82, 75%, 40%)' },
  Education: { light: 'hsl(204, 23%, 50%)', dark: 'hsl(204, 40%, 64%)' },
  Sport: { light: 'hsl(129, 37%, 45%)', dark: 'hsl(129, 65%, 53%)' },
  Station: { light: 'hsl(215, 83%, 48%)', dark: 'hsl(215, 90%, 65%)' },
}

/** v4 fades its halo out as the map zooms in, rather than holding it flat. */
const V4_HALO_BLUR = ['interpolate', ['linear'], ['zoom'], 12, 1, 14, 0.5, 16, 0]

/**
 * v4 keeps a `dot` fallback, which is right for a glyph-only map: an
 * unrecognised POI shows as a small mark rather than disappearing. The badge
 * treatment deliberately has none — there a fallback stamps a filled circle
 * over the disc it is supposed to sit in.
 */
const V4_ICON = [...POI_ICON, ['image', 'dot']]

function poiGlyphTreatment(layerId) {
  const family = V4_FAMILY[layerId] ? `@poi_v4_${slug(layerId)}` : '@poi_v4_public'
  return {
    layout: {
      'icon-image': V4_ICON,
      'icon-anchor': 'center',
      // v4 holds these at natural size (a full 15px of Maki art) until z18.
      // Against our label sizes that reads as oversized, so the whole ramp is
      // scaled down — same shape, roughly three quarters the size.
      'icon-size': ['interpolate', ['linear'], ['zoom'], 15, 0.65, 18, 0.75, 22, 1],
      // Glyph-only, so nothing is left behind when one loses a collision —
      // which is why this treatment can let the collision system do its job
      // instead of forcing every icon to draw.
      'icon-allow-overlap': false,
      'icon-ignore-placement': false,
      'symbol-sort-key': RANK,
      'text-anchor': 'top',
      'text-offset': [0, 0.8],
      'text-size': ['interpolate', ['linear'], ['zoom'], 12, 10, 16, 12, 22, 14],
      'text-max-width': 8,
      'text-padding': 2,
      'text-optional': true,
    },
    paint: {
      'icon-color': family,
      // With no disc behind it, the halo is the only thing separating a glyph
      // from the map under it, so it carries more weight here than v4's 2px.
      'icon-halo-color': '@poi_v4_halo',
      'icon-halo-width': 3.5,
      'icon-halo-blur': V4_HALO_BLUR,
      'text-color': family,
      'text-halo-color': '@poi_v4_halo',
      'text-halo-width': 2.5,
      'text-halo-blur': V4_HALO_BLUR,
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
   *
   * Both colours form the key, not just the light one. Sharing on light alone
   * looks harmless — a token is only a name — but it silently hands every
   * later layer the *first* layer's dark value, and light is exactly where
   * unrelated things collide: MapTiler paints sixteen different things white
   * in daylight, so glaciers, minor roads, runways, cable cars and the halo
   * behind every label in the style all collapsed onto one token and every one
   * of them came out glacier blue at night. Keying on the pair keeps a shared
   * name to things that genuinely agree in both flavors.
   */
  ref(color, darkColor, hint) {
    const light = color.trim()
    const dark = isColor(darkColor) ? darkColor.trim() : null
    const key = `${light}\u0000${dark ?? ''}`
    if (this.byColor.has(key)) return `@${this.byColor.get(key)}`
    let name = hint
    let n = 2
    while (name in this.light) name = `${hint}_${n++}`
    this.byColor.set(key, name)
    this.light[name] = light
    if (dark) {
      this.dark[name] = dark
    } else {
      // No colour at the matching position — dark keeps the light value and
      // gets reported, so a silent light-on-dark patch cannot slip through.
      this.dark[name] = light
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
  // Build the sprite before the style: the shield layers read back which
  // markers the sheet actually carries. See `shieldImages`.
  const shieldArt = await shieldImages()
  const tokens = new Tokens()
  const layers = []
  const dropped = []
  let buildingLayerId = null

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
      dropped.push([layer.id, DROP_LAYERS.get(layer.id)])
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
      // The name takes the badge's glyph colour, transit included — a blue
      // square above a purple label reads as two unrelated marks. The glyph
      // rather than the plate: the plate is a pale tint and would be unreadable
      // as lettering, where the ink is the pair's contrasting half.
      const tint = poiTint('ink')
      out.filter = out.filter
        ? ['all', toExpressionFilter(out.filter), RANK_GATE]
        : RANK_GATE
      out.layout = { ...out.layout, ...POI_LAYOUT }
      out.paint = { ...out.paint, ...POI_PAINT, 'text-color': tint }
      // MapTiler tints its glyphs with these; ours arrive already coloured, and
      // a non-SDF image ignores them anyway. Left in they are dead paint that
      // keeps a handful of their family tokens alive.
      for (const dead of ['icon-color', 'icon-halo-color', 'icon-halo-width', 'icon-halo-blur']) {
        delete out.paint[dead]
      }
    }

    // Buildings are solid. MapTiler draws them at 0.4, which lets the streets
    // and land under a tower show through it — readable on their flat-shaded
    // map, muddy on ours, and it makes anything drawn over a building blend
    // with the ground beneath rather than with the building.
    if (out.type === 'fill-extrusion') {
      out.minzoom = BUILDING_3D_MINZOOM
      // Buildings grow in over the first stretch of zoom past the layer's own
      // minzoom, rather than springing up at full height the instant it
      // switches on. This lives in the style, not in JS: `zoom` is one of the
      // few things an expression can read, so MapLibre interpolates it on the
      // GPU for free. `["zoom"]` is legal only as the direct input of a
      // top-level interpolate, hence the ramp wrapping the value rather than
      // multiplying it.
      // MapTiler writes these as legacy identity functions, which are not
      // expressions and cannot sit inside one. Translate first.
      const asExpression = value =>
        value && typeof value === 'object' && !Array.isArray(value) && value.property
          ? ['coalesce', ['to-number', ['get', value.property]], 0]
          : value
      const grow = value => [
        'interpolate', ['linear'], ['zoom'],
        out.minzoom, 0,
        out.minzoom + BUILDING_GROW_ZOOM, asExpression(value),
      ]
      out.paint = {
        ...out.paint,
        'fill-extrusion-opacity': 1,
        'fill-extrusion-height': grow(out.paint['fill-extrusion-height']),
        'fill-extrusion-base': grow(out.paint['fill-extrusion-base']),
      }
      // Round off the building corners. A layout property, so it reshapes the
      // extrusion geometry itself rather than shading it — MapLibre 6.2+ only,
      // which is why we carry a v6 fork. Measured in metres along each adjacent
      // edge, clamped internally to 20% of the shorter one so a narrow building
      // cannot collapse, and corners under 5 degrees are left alone.
      out.layout = { ...out.layout, 'fill-extrusion-rounded-corner-distance': 1.5 }
      buildingLayerId = out.id
    }

    // One-way arrows sit inside the road casing rather than overhanging it.
    // The sprite is 21px square, so MapTiler's 0.7-1.0 draws a 15-21px arrow —
    // wider than a residential street is at the zooms this layer switches on
    // at, which is why they read as arrows floating over the map rather than as
    // markings painted on the road. Roughly half that keeps them inside it.
    //
    // The numbers were first cut against a sprite sheet that rendered 1.7x too
    // large on a retina display, so they are scaled by that factor here: the
    // sizing that was judged by eye is preserved, now that the sheet is right.
    // Written as an interpolate rather than the legacy stops function it
    // replaces: style-spec 25 warns on those.
    if (layer.id === 'Oneway') {
      out.layout = {
        ...out.layout,
        'icon-size': ['interpolate', ['linear'], ['zoom'], 16, 0.58, 19, 0.94],
      }
    }

    if (layer.id === SHIELD_LAYER) Object.assign(out, routeShieldLayer(out, shieldArt))
    if (layer.id === JUNCTION_LAYER) Object.assign(out, exitShieldLayer(out))

    // MapTiler's white-band-plus-dashed-line path becomes Standard's paved
    // surface with a fine casing; see `orderPedestrianSurfaces`.
    if (layer.id === PATH_CASING_LAYER) {
      out.paint = {
        'line-color': '@path_casing',
        'line-width': PATH_CASING_WIDTH,
        'line-gap-width': PATH_SURFACE_WIDTH,
      }
      out.layout = { ...out.layout, 'line-join': 'round', 'line-cap': 'round' }
    }
    if (layer.id === PATH_LAYER) {
      // No dasharray: a sidewalk is continuous pavement, and dashing it is what
      // made these read as trails rather than as something you walk on.
      out.paint = { 'line-color': '@path_surface', 'line-width': PATH_SURFACE_WIDTH }
      out.layout = { ...out.layout, 'line-join': 'round', 'line-cap': 'round' }
    }
    if (layer.id === PEDESTRIAN_AREA_LAYER) {
      // Opaque, where MapTiler had it at 0.7. A plaza has to be the same colour
      // as the paths running into it or the joins show as a change of tone.
      out.paint = { 'fill-color': '@path_surface' }
    }

    layers.push(out)
  }

  outlinePitches(layers)
  sinkInstitutionalLanduse(layers)
  raiseSandAboveSurfaces(layers)
  applyRoadInk(layers)
  widenLowerRoads(layers)
  fadeTunnels(layers)
  // Before the pedestrian pass, so the footbridges it inserts land above the
  // arrows rather than below them: an arrow is painted on the road, and a
  // footbridge crossing over that road covers it.
  sinkRoadMarkings(layers)

  // The plaza's own outline, which MapTiler has no equivalent of — without it a
  // pedestrian area ends in a hard colour change against the ground, where
  // every path running into it is neatly cased.
  const area = layers.find(l => l.id === PEDESTRIAN_AREA_LAYER)
  if (area) {
    layers.splice(layers.indexOf(area) + 1, 0, {
      id: PEDESTRIAN_AREA_CASING_LAYER,
      type: 'line',
      source: SOURCE,
      'source-layer': area['source-layer'],
      // The same zoom and the same stroke as the path casing, deliberately: a
      // plaza edge and the edge of a path running into it are one continuous
      // line, and any difference between them shows exactly where they meet.
      // Defaulting this to the plaza's own minzoom put it at 14 against the
      // path's 12, so between those zooms the paths were cased and the plazas
      // were not.
      minzoom: pathCasingMinzoom(layers),
      filter: area.filter,
      layout: { 'line-join': 'round' },
      paint: { 'line-color': '@path_casing', 'line-width': PATH_CASING_WIDTH },
    })
  }
  orderPedestrianSurfaces(layers)

  // The roofline edge, for the plan view.
  //
  // The shader draws that edge on the top of each *wall*, which is exactly
  // right when the camera is tilted and useless when it is not: looking
  // straight down there are no walls on screen, only roofs, and the buildings
  // lose their outlines. A line on the footprint is the missing half — under
  // the orthographic top-down camera a roof sits precisely over its own
  // footprint, so the two coincide.
  //
  // It is only correct at that angle, though. Tilt at all and the footprint
  // separates from the roof and the line reads as a smear on the ground, so its
  // opacity is driven from `maplibre.strategy` on pitch rather than being
  // baked here. Starting at 0 keeps it invisible until that runs.
  const building3d = layers.findIndex(l => l.type === 'fill-extrusion')
  if (building3d >= 0) {
    layers.splice(building3d + 1, 0, {
      id: BUILDING_ROOF_EDGE_LAYER,
      type: 'line',
      source: SOURCE,
      'source-layer': 'building',
      minzoom: layers[building3d].minzoom ?? 15,
      layout: { 'line-join': 'round' },
      paint: {
        'line-color': '@building_roof_edge',
        'line-width': ['interpolate', ['linear'], ['zoom'], 15, 0.5, 18, 1.1],
        'line-opacity': 0,
      },
    })
  }

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

  // The badge's lift. A cast shadow is a daylight idea: on the night map a
  // dark blur behind an already-pale badge on dark ground does nothing, so the
  // dark flavor gets a faint light bloom instead — the same job, the way the
  // night does it.
  tokens.light.poi_lift = 'rgba(0,0,0,0.34)'
  tokens.dark.poi_lift = 'rgba(255,255,255,0.16)'

  // Shield lettering is ours, not MapTiler's — their shields are sprite art.
  //
  // Both flavors get the same two values, which is deliberate: the markers are
  // full-colour art rather than tintable SDFs, so a blue interstate marker is
  // blue on the night map too, and its numerals have to stay white to be
  // legible against it. Mapbox does the same — a route marker is a physical
  // sign, and darkness does not repaint it.
  for (const flavor of [tokens.light, tokens.dark]) {
    flavor.shield_ink = 'hsl(0, 0%, 12%)'
    flavor.shield_ink_reversed = 'hsl(0, 0%, 100%)'
  }

  // Pedestrian surfaces. Light follows Standard: a near-white pavement with a
  // grey casing. Dark cannot — Standard's values are for a light map — so it
  // sits a few points above the night ground the way the pavement sits above
  // the earth in daylight, with a casing darker than the surface rather than
  // lighter, since at night the surface is the bright thing.
  // Transit blue. Its own token rather than a category colour: a stop is
  // wayfinding, not a category of place, and every transit system's own maps
  // agree it is blue.
  // Only as a tint pair, the same as every category: `@@tint-*` runs a literal
  // through the icon-tile treatment where `@@category-*` (below) runs a live
  // palette colour through it. Both land in `build.ts`, which is the only place
  // that knows the flavor and can therefore pick the direction.
  const TRANSIT_BLUE = { light: 'hsl(214, 78%, 52%)', dark: 'hsl(214, 80%, 62%)' }
  for (const flavor of ['light', 'dark']) {
    tokens[flavor].poi_transit_plate = `@@tint-plate:${TRANSIT_BLUE[flavor]}`
    tokens[flavor].poi_transit_ink = `@@tint-ink:${TRANSIT_BLUE[flavor]}`
    tokens[flavor].poi_transit_ring = `@@tint-ring:${TRANSIT_BLUE[flavor]}`
  }

  // The pitch edge is authored, not lifted, so the night value is set here
  // rather than in `DARK_OVERRIDES`: a shade off its own fill in each flavor,
  // which at night means lighter, since there the fill is the dark thing.
  tokens.dark.stadium_outline_color = 'hsl(183, 20%, 27%)'

  tokens.light.path_surface = 'hsl(44, 40%, 96%)'
  tokens.light.path_casing = 'hsl(42, 16%, 81%)'
  tokens.dark.path_surface = 'hsl(216, 14%, 33%)'
  tokens.dark.path_casing = 'hsl(216, 20%, 20%)'

  for (const [rung, color] of Object.entries(ROAD_INK.light)) tokens.light[`road_${rung}`] = color
  for (const [rung, color] of Object.entries(ROAD_INK.dark)) tokens.dark[`road_${rung}`] = color

  Object.assign(tokens.light, LIGHT_LAND)

  for (const [name, color] of Object.entries(DARK_OVERRIDES)) {
    if (name in tokens.dark) tokens.dark[name] = color
  }

  // Category palette tokens, resolved at runtime from the app's own palette
  // so basemap POIs match the colours search results already use.
  //
  // The pale plate, its contrasting ink and the ring around it, from the same
  // palette colour and through the same function the place header's icon tile
  // uses — which is what makes a café on the map and a café in the header the
  // same mark. The raw colour is not emitted: nothing draws with it directly
  // any more. `build.ts` picks what each of the three resolves to per flavor.
  for (const category of [...Object.keys(POI_CATEGORY), 'default']) {
    for (const kind of ['plate', 'ink', 'ring']) {
      tokens.light[`poi_${kind}_${category}`] = `@@category-${kind}:${category}`
      tokens.dark[`poi_${kind}_${category}`] = `@@category-${kind}:${category}`
    }
  }

  // MapTiler Streets v4's own family palette, for the glyph-only treatment.
  // Kept separate from the category tokens above: that palette is Parchment's
  // and follows the app, this one is a faithful copy of someone else's map.
  for (const [layerId, colors] of Object.entries(V4_FAMILY)) {
    tokens.light[`poi_v4_${slug(layerId)}`] = colors.light
    tokens.dark[`poi_v4_${slug(layerId)}`] = colors.dark
  }
  tokens.light.poi_v4_halo = 'hsl(0, 0%, 100%)'
  tokens.dark.poi_v4_halo = 'hsl(0, 0%, 0%)'

  // Buildings sit just above their own ground, in both flavors.
  //
  // The roof is the brightest face a building has and every wall is a fraction
  // of it, so the roof colour sets where the whole block lands. MapTiler's
  // values are tuned for a translucent layer over a visible ground and are no
  // guide here: light started 10 points *below* its land, which sank the
  // buildings into the midtones, and dark started 31 points *above* its land,
  // which made them glow like lit boxes at night.
  //
  // A few points above the ground is enough. The shading supplies the rest of
  // the separation — walls fall to roughly 72% of the roof, which in the dark
  // flavor puts them just under the land they stand on.
  //
  //                        ground             roof
  //   light   hsl(44, 52%, 93%)    hsl(38, 30%, 87%)
  //   dark    hsl(216, 37%, 24%)   hsl(217, 32%, 32%)
  //
  // Daylight is the one place the roof goes the other way — six points *below*
  // the cream and a good deal less saturated. It stays in the warm family, so a
  // roof reads as a made surface rather than a grey object dropped on the land,
  // but it must not land *on* the ground's colour: a block has to be a thing
  // standing on the map, and at a glance that separation is carried by value.
  // Close enough to share the family, far enough to be another material. Cream land with grey
  // buildings on it is how a city block reads as built rather than as more
  // ground, and it is the relationship Apple's daylight map is built on. The
  // walls fall from there, so the elevation still lights from above.
  tokens.light.building_3d_fill_extrusion_color = 'hsl(38, 30%, 87%)'
  tokens.dark.building_3d_fill_extrusion_color = 'hsl(217, 32%, 32%)'

  // Matches the shader's roofline edge: darker than the roof it outlines.
  tokens.light.building_roof_edge = 'hsl(38, 24%, 71%)'
  tokens.dark.building_roof_edge = 'hsl(217, 30%, 22%)'

  // The second POI treatment, as per-layer overrides `build.ts` merges in when
  // the glyph-only style is selected. Emitted rather than duplicating every
  // POI layer, so the filters and draw order stay defined in exactly one place.
  const poiStyles = {
    glyph: Object.fromEntries(
      layers
        .filter(l => l['source-layer'] === 'poi' && l.type === 'symbol')
        .map(l => [l.id, poiGlyphTreatment(l.id)]),
    ),
  }
  console.log(`glyph-only POI treatment: ${Object.keys(poiStyles.glyph).length} layers`)

  // Per-flavor layer overrides, for the handful of places where day and night
  // need a different *expression* rather than a different colour. Tokens cover
  // the ordinary case; this covers the rest. Same shape as `poiStyles`, and
  // merged by `build.ts` the same way.
  const flavorStyles = Object.fromEntries(
    Object.entries(BUILDING_TINT).map(([flavor, amount]) => [
      flavor,
      buildingLayerId && {
        [buildingLayerId]: { paint: { 'fill-extrusion-color': buildingColor(amount) } },
      },
    ]),
  )

  await writeFile(OUT_SPEC, `${JSON.stringify({ layers, poiStyles, flavorStyles }, null, 1)}\n`)
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
