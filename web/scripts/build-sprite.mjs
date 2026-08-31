#!/usr/bin/env node
/**
 * Builds the basemap sprite sheet from Maki (CC0) plus any local overrides.
 *
 * Icons are emitted as SDFs, not plain rasters, because the style tints them
 * per POI family and per theme via `icon-color` — which MapLibre only honours
 * for SDF sprites. Anything else would mean baking one sheet per flavor.
 *
 * Route shields are the exception: they are full-colour art that must not be
 * tinted, so the sheet is mixed and the manifest carries `sdf` per icon. See
 * `shieldArt`.
 *
 * Output (committed, so a checkout renders without running this):
 *   public/sprites/parchment.png     / .json
 *   public/sprites/parchment@2x.png  / .json
 *
 * Run with: bun run build:sprite
 */
import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import ShelfPack from '@mapbox/shelf-pack'
import { SDF_BUFFER, SDF_CUTOFF, SDF_RADIUS } from '../src/lib/map-style/sdf.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const WEB = resolve(HERE, '..')
const MAKI = resolve(WEB, 'node_modules/@mapbox/maki/icons')
const LOCAL = resolve(WEB, 'src/assets/map-icons')
const OUT = resolve(WEB, 'public/sprites')

// The field's own constants live beside the code that decodes it again at
// runtime; see `sdf.mjs`.
const BUFFER = SDF_BUFFER
const RADIUS = SDF_RADIUS
const CUTOFF = SDF_CUTOFF

const INF = 1e20

/**
 * OpenMapTiles' `poi.class` taxonomy came from Maki, but the two spell names
 * differently: Maki hyphenates (`fast-food`), OpenMapTiles uses underscores
 * (`fast_food`). Rather than carry a 40-branch `match` in the style, the
 * sheet publishes an underscored alias for every hyphenated icon, so
 * `icon-image: ["get", "class"]` resolves directly.
 *
 * These are the classes Maki genuinely names something else.
 */
/**
 * Route shields, named `{network}-{ref_length}` the way Mapbox Standard names
 * its own — see `road-number-shield` in `styles/standard.json`, which resolves
 * `icon-image` by concatenating the route's network with the length of its
 * ref, and falls back to `default-N` for a network it has no art for.
 *
 * These are the one part of the sheet that is *not* an SDF. An interstate
 * marker is blue with a red crown and white numerals; a US route is a white
 * escutcheon outlined in black. None of that survives a single-channel
 * distance field, which carries a silhouette and nothing else. They are drawn
 * as full-colour rasters instead and marked `sdf: false`, so `icon-color`
 * passes them by — which also means they keep their real colours in the dark
 * flavor, as Mapbox's do. A route marker is a physical sign with legislated
 * colours; a night map does not repaint the roads.
 *
 * Shapes follow the MUTCD, which is where Mapbox's come from too: M1-1 for the
 * interstate, M1-4 for the US route. Both are public-domain designs, so this is
 * a redraw from the same source rather than a copy of their sprite.
 */
const SHIELD_HEIGHT = 18
/** Plaques are shorter than shields, as a rectangular route marker is. */
const PLAQUE_HEIGHT = 14

/**
 * Border weight, in design pixels. A marker is only 15px tall, so this is the
 * difference between a fine keyline and a black blob: much over a pixel and
 * the border eats the shape it is supposed to describe. The interstate's white
 * ring runs a little heavier, as it does on the real sign.
 */
const BORDER = 0.9

/**
 * How wide each marker is at a given ref length. The text is set over the art
 * by the layer rather than baked in, so these have to clear `text-size` 9 bold
 * at `text-letter-spacing` 0.05 — roughly 6px per character — plus the border.
 *
 * Plaques are free to grow with the ref, and do. The two pointed markers stay
 * near-square, as the MUTCD draws them — M1-1 is 24x24 inches for a two-digit
 * route and 30x24 for three — so they widen far less. Let them follow the
 * plaque ramp and a three-digit shield comes out a squashed lozenge that reads
 * as anything but a shield.
 *
 * Both ramps are set from the text rather than from the sign: at `text-size` 9
 * a digit is about 5.6px, and a pointed marker also has to clear its border and
 * the taper toward the foot. Sized from the sign alone the digits crowd the
 * edge of the field, which is what happened when these were first cut against a
 * sprite sheet that was rendering 1.7x too large.
 *
 * They stop at four characters for the same reason — beyond that no proportion
 * saves the shape, and there is no such route anyway. Longer refs fall through
 * to `default-N`, which is exactly what Standard's `coalesce` is for.
 */
const PLAQUE_WIDTHS = { 1: 15, 2: 18, 3: 24, 4: 29, 5: 34, 6: 39 }
const POINTED_WIDTHS = { 1: 18, 2: 21, 3: 25, 4: 30 }

/**
 * Sign colours, at map weight rather than at literal MUTCD values.
 *
 * The specified inks — PMS 294 blue, PMS 187 red — are made to be read at
 * speed from a distance in daylight, and at 15 pixels over a pale basemap they
 * go muddy: the navy reads as a dark blob and the brick red as brown. These
 * keep the hues and lift them, which is the same adjustment Mapbox makes.
 *
 * The plaque rule is grey rather than the near-black it was. A 1px black
 * keyline around a small white box is heavier than anything else on the map
 * and pulls the eye to a route number ahead of the road it belongs to.
 */
const SHIELD_COLORS = {
  interstateField: '#1B54A8',
  interstateCrown: '#D22E3F',
  white: '#FFFFFF',
  ink: '#3D3D3D',
  rule: '#9A9A9A',
  exit: '#2A7D4A',
}

const svgDoc = (w, h, body) =>
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`,
  )

/**
 * The interstate marker (MUTCD M1-1): a white-bordered blue escutcheon whose
 * top third is red. The crown is drawn as a full shield clipped to a band, so
 * the red meets the white border on the same curve the blue does.
 */
function interstateSvg(w) {
  const h = SHIELD_HEIGHT
  const path = shieldPath(INTERSTATE_OUTLINE, w, h, 0.5)
  const inner = shieldPath(INTERSTATE_OUTLINE, w, h, 0.5 + BORDER * 1.4)
  const { interstateField, interstateCrown, white } = SHIELD_COLORS
  return svgDoc(
    w,
    h,
    `<defs><clipPath id="c"><path d="${inner}"/></clipPath></defs>` +
      `<path d="${path}" fill="${white}"/>` +
      `<path d="${inner}" fill="${interstateField}"/>` +
      `<rect x="0" y="0" width="${w}" height="${h * 0.34}" fill="${interstateCrown}" clip-path="url(#c)"/>`,
  )
}

/**
 * The US route marker (MUTCD M1-4): a white escutcheon with a black border and
 * black numerals. Same silhouette as the interstate, cut the other way round.
 */
function usRouteSvg(w) {
  const h = SHIELD_HEIGHT
  const { white, ink } = SHIELD_COLORS
  return svgDoc(
    w,
    h,
    `<path d="${shieldPath(US_ROUTE_OUTLINE, w, h, 0.5)}" fill="${ink}"/>` +
      `<path d="${shieldPath(US_ROUTE_OUTLINE, w, h, 0.5 + BORDER)}" fill="${white}"/>`,
  )
}

/**
 * The two marker silhouettes, traced in a unit square with y running down, so
 * one description serves every ref width and both inset rings.
 *
 * The interstate (M1-1) is a flat-crowned escutcheon: the top edge runs
 * straight across the middle two thirds, the corners sweep out to the full
 * width just below it, and the sides fall vertically before tapering to a
 * point on the centre line.
 *
 * The US route (M1-4) is the older cut-corner shape — two raised shoulders
 * with a shallow dip between them, and a broader, blunter foot. It is what
 * tells a US route from an interstate at a glance, so it is worth the extra
 * curve even at this size.
 */
const INTERSTATE_OUTLINE =
  'M0.155,0 L0.845,0 C0.93,0 1,0.07 1,0.17 L1,0.42 ' +
  'C1,0.63 0.85,0.85 0.60,0.98 C0.56,1 0.44,1 0.40,0.98 ' +
  'C0.15,0.85 0,0.63 0,0.42 L0,0.17 C0,0.07 0.07,0 0.155,0 Z'

const US_ROUTE_OUTLINE =
  'M0.5,0.03 C0.44,0.005 0.38,0 0.28,0 C0.12,0 0,0.09 0,0.25 L0,0.53 ' +
  'C0,0.73 0.11,0.89 0.30,0.97 C0.37,1 0.63,1 0.70,0.97 ' +
  'C0.89,0.89 1,0.73 1,0.53 L1,0.25 C1,0.09 0.88,0 0.72,0 ' +
  'C0.62,0 0.56,0.005 0.5,0.03 Z'

/**
 * Map a unit outline onto the box inset by `pad`.
 *
 * The inset scales the shape rather than offsetting its edges, so a border
 * comes out slightly thinner at the crown than at the point. At a one- or
 * two-pixel rule on a 15px marker that is well under a pixel, and it keeps the
 * two rings exactly concentric, which an offset curve would not.
 */
function shieldPath(outline, w, h, pad) {
  const sx = (w - pad * 2) / 1
  const sy = (h - pad * 2) / 1
  return outline.replace(/-?\d*\.?\d+,-?\d*\.?\d+/g, pair => {
    const [x, y] = pair.split(',').map(Number)
    return `${(pad + x * sx).toFixed(2)},${(pad + y * sy).toFixed(2)}`
  })
}

/**
 * State routes and every network we have no art for: a white plaque with a
 * hairline rule, which is what Standard falls back to. Real state markers are
 * per-state art keyed off a field OpenMapTiles does not carry.
 */
function plaqueSvg(width, { fill, stroke, radius = 3 }) {
  const h = PLAQUE_HEIGHT
  return svgDoc(
    width,
    h,
    `<rect x="0.5" y="0.5" width="${width - 1}" height="${h - 1}" rx="${radius}" ry="${radius}" ` +
      `fill="${fill}"${stroke ? ` stroke="${stroke}" stroke-width="1"` : ''}/>`,
  )
}

function shieldArt() {
  const art = new Map()
  for (const [len, width] of Object.entries(POINTED_WIDTHS)) {
    art.set(`us-interstate-${len}`, interstateSvg(width))
    art.set(`us-highway-${len}`, usRouteSvg(width))
  }
  for (const [len, width] of Object.entries(PLAQUE_WIDTHS)) {
    art.set(`us-state-${len}`, plaqueSvg(width, {
      fill: SHIELD_COLORS.white,
      stroke: SHIELD_COLORS.ink,
      radius: 2,
    }))
    art.set(`default-${len}`, plaqueSvg(width, {
      fill: SHIELD_COLORS.white,
      stroke: SHIELD_COLORS.rule,
    }))
    // Exit tabs carry white numerals, so the plaque is the green of a US exit
    // sign rather than white; Standard hard-codes the same text colour.
    art.set(`motorway-exit-${len}`, plaqueSvg(width, { fill: SHIELD_COLORS.exit }))
  }
  return art
}

/**
 * The `dot` an unrecognised POI falls back to in the glyph-only treatment.
 *
 * Drawn rather than aliased to Maki's `circle`, which is a filled disc on the
 * full 15-unit grid — at the icon sizes the POI layers use that reads as a
 * blob, not as a dot.
 */
function dotSvg() {
  return Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 15 15">' +
      '<circle cx="7.5" cy="7.5" r="2.75" fill="#000"/>' +
      '</svg>',
  )
}

const ALIASES = {
  // Names the style uses that Maki spells differently, or does not have
  oneway: 'arrow',
  international: 'airport',

  // poi.class values Maki names differently
  railway: 'rail',
  bicycle_rental: 'bicycle-share',
  motorcycle_parking: 'scooter',
  ferry_terminal: 'ferry',
  atm: 'bank',
  office: 'commercial',

  // poi.class values MapTiler's POI layers admit that Maki has no art for at
  // all. Without these the layer draws no icon, and an unnamed feature then
  // draws no symbol whatsoever — leaving the badge circle underneath standing
  // on its own. `apartment` and `first_aid` alone accounted for most of the
  // empty discs over Manhattan.
  apartment: 'building',
  archeological_site: 'monument',
  archery: 'pitch',
  athletics: 'pitch',
  biergarten: 'beer',
  book: 'library',
  caravan_site: 'campsite',
  chalet: 'lodging',
  chemist: 'pharmacy',
  childcare: 'school',
  climbing: 'mountain',
  courthouse: 'town-hall',
  dancing_school: 'theatre',
  driving_school: 'car',
  equestrian: 'horse-riding',
  first_aid: 'doctor',
  fitness: 'fitness-centre',
  fountain: 'drinking-water',
  gallery: 'art-gallery',
  mall: 'shop',
  monastery: 'religious-christian',
  motor: 'car',
  multi: 'pitch',
  opera: 'theatre',
  planetarium: 'museum',
  reservoir: 'water',
  ruins: 'monument',
  running: 'pitch',
  sauna: 'swimming',
  shower: 'toilet',
  sport: 'pitch',
  sports_hall: 'fitness-centre',
  swimming_area: 'swimming',
  theme_park: 'amusement-park',
  townhall: 'town-hall',

  // poi.subclass values, which give a more specific icon than the class when
  // the sheet has one. Everything listed here MUST resolve — `layers.ts`
  // gates its subclass lookup on this exact set so MapLibre is never asked
  // for an image that does not exist.
  artwork: 'art-gallery',
  bed: 'furniture',
  bicycle_parking: 'bicycle',
  books: 'library',
  bus_station: 'bus',
  bus_stop: 'bus',
  butcher: 'slaughterhouse',
  camp_site: 'campsite',
  car_repair: 'car-repair',
  christian: 'religious-christian',
  clinic: 'doctor',
  clothes: 'clothing-store',
  coffee: 'cafe',
  community_centre: 'town-hall',
  convenience: 'grocery',
  deli: 'grocery',
  department_store: 'shop',
  doctors: 'doctor',
  doityourself: 'hardware',
  dry_cleaning: 'laundry',
  financial: 'bank',
  food_court: 'restaurant',
  golf_course: 'golf',
  guest_house: 'lodging',
  hostel: 'lodging',
  hotel: 'lodging',
  interior_decoration: 'furniture',
  jewelry: 'jewelry-store',
  kindergarten: 'school',
  marketplace: 'grocery',
  miniature_golf: 'golf',
  motel: 'lodging',
  nightclub: 'bar',
  pet: 'dog-park',
  post_box: 'post',
  post_office: 'post',
  pub: 'beer',
  shoes: 'shoe',
  sports_centre: 'fitness-centre',
  station: 'rail',
  subway: 'rail-metro',
  supermarket: 'grocery',
  swimming_pool: 'swimming',
  toilets: 'toilet',
  tram_stop: 'rail-light',
  university: 'college',
  viewpoint: 'attraction',
  water_park: 'swimming',
  wine: 'alcohol-shop',
}

// --- Exact Euclidean distance transform (Felzenszwalb & Huttenlocher) ------

function edt1d(grid, offset, stride, length, f, v, z) {
  v[0] = 0
  z[0] = -INF
  z[1] = INF
  f[0] = grid[offset]

  for (let q = 1, k = 0, s = 0; q < length; q++) {
    f[q] = grid[offset + q * stride]
    const q2 = q * q
    do {
      const r = v[k]
      s = (f[q] - f[r] + q2 - r * r) / (q - r) / 2
    } while (s <= z[k] && --k > -1)
    k++
    v[k] = q
    z[k] = s
    z[k + 1] = INF
  }

  for (let q = 0, k = 0; q < length; q++) {
    while (z[k + 1] < q) k++
    const r = v[k]
    const qr = q - r
    grid[offset + q * stride] = f[r] + qr * qr
  }
}

function edt(grid, width, height, f, v, z) {
  for (let x = 0; x < width; x++) edt1d(grid, x, width, height, f, v, z)
  for (let y = 0; y < height; y++) edt1d(grid, y * width, 1, width, f, v, z)
}

/** Alpha channel → single-channel signed distance field. */
function alphaToSdf(alpha, width, height) {
  const size = width * height
  const gridOuter = new Float64Array(size)
  const gridInner = new Float64Array(size)
  const scratch = Math.max(width, height)
  const f = new Float64Array(scratch)
  const v = new Int32Array(scratch)
  const z = new Float64Array(scratch + 1)

  for (let i = 0; i < size; i++) {
    const a = alpha[i] / 255
    if (a === 1) {
      gridOuter[i] = 0
      gridInner[i] = INF
    } else if (a === 0) {
      gridOuter[i] = INF
      gridInner[i] = 0
    } else {
      const d = Math.max(0, 0.5 - a)
      gridOuter[i] = d * d
      const e = Math.max(0, a - 0.5)
      gridInner[i] = e * e
    }
  }

  edt(gridOuter, width, height, f, v, z)
  edt(gridInner, width, height, f, v, z)

  const out = Buffer.alloc(size)
  for (let i = 0; i < size; i++) {
    const d = Math.sqrt(gridOuter[i]) - Math.sqrt(gridInner[i])
    out[i] = Math.max(0, Math.min(255, Math.round(255 - 255 * (d / RADIUS + CUTOFF))))
  }
  return out
}

// --- Badges ---------------------------------------------------------------

/**
 * Badge geometry, in the same units `core-layers.ts` uses for the saved-place
 * markers: a 19px disc with the glyph held at 57% of its diameter. The ring
 * is not drawn here — the style adds it with `icon-halo-width`, so it can be
 * the flavor's own surface colour rather than baked into the art.
 */
const BADGE_DIAMETER = 19
const BADGE_GLYPH_RATIO = 0.57

/** Prefix for the badge form of an icon: `restaurant` → `badge-restaurant`. */
export const BADGE_PREFIX = 'badge-'

/**
 * Transit stops get a rounded square rather than a disc.
 *
 * That is Mapbox's convention and it earns its place: a disc says "a place is
 * here", where a square plate says "this is a station" — the same distinction
 * a transit map draws between a point of interest and a stop. At the sizes
 * these draw, shape is a far stronger signal than colour.
 *
 * Only the transit classes get the second form, so the sheet gains a couple of
 * dozen images rather than doubling.
 */
export const TILE_PREFIX = 'tile-'
const TILE_CORNER = 0.28
const TRANSIT_ICONS = [
  'bus', 'rail', 'rail-metro', 'rail-light', 'ferry', 'harbor',
  'aerialway', 'airport', 'airfield', 'entrance',
]

/**
 * The glyph knocked out of a filled disc, as ONE shape.
 *
 * This is what lets a badge take part in collision. Drawn as a circle layer
 * under a symbol layer, the disc and its glyph are separate objects: circle
 * layers do not collide, so either the glyph got culled and left an empty disc
 * behind, or `icon-allow-overlap` kept every glyph and the badges piled on top
 * of each other. Baked into a single SDF image there is only one object, and
 * MapLibre places it the way it places any other icon.
 *
 * The knockout is a hole, not ink — whatever the map draws underneath shows
 * through it, which is what the badge treatment wants in both flavors.
 */
async function badgeAlpha(svg, ratio, shape = 'disc') {
  const size = Math.round(BADGE_DIAMETER * ratio)
  const glyphSize = Math.round(size * BADGE_GLYPH_RATIO)
  const inset = Math.round((size - glyphSize) / 2)

  const rawAlpha = async input => {
    const { data, info } = await input.ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    const out = Buffer.alloc(info.width * info.height)
    for (let i = 0; i < out.length; i++) out[i] = data[i * info.channels + info.channels - 1]
    return out
  }

  const plate =
    shape === 'tile'
      ? `<rect x="0" y="0" width="${size}" height="${size}" rx="${size * TILE_CORNER}" ` +
        `ry="${size * TILE_CORNER}" fill="#000"/>`
      : `<circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="#000"/>`

  const disc = await rawAlpha(
    sharp(
      Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">` +
          plate + `</svg>`,
      ),
      { density: 72 },
    ).resize(size, size, { fit: 'fill' }),
  )

  const glyph = await rawAlpha(
    sharp(svg, { density: 72 * ratio })
      .resize(glyphSize, glyphSize, { fit: 'fill' })
      .extend({
        top: inset,
        bottom: size - glyphSize - inset,
        left: inset,
        right: size - glyphSize - inset,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      }),
  )

  const cut = Buffer.alloc(size * size)
  for (let i = 0; i < cut.length; i++) cut[i] = Math.max(0, disc[i] - glyph[i])
  return { alpha: cut, size }
}

// --- Sheet ----------------------------------------------------------------

async function collectIcons() {
  const icons = new Map()
  for (const dir of [MAKI, LOCAL]) {
    if (!existsSync(dir)) continue
    for (const file of await readdir(dir)) {
      if (!file.endsWith('.svg')) continue
      // Local icons intentionally shadow Maki ones of the same name.
      icons.set(file.replace(/\.svg$/, ''), join(dir, file))
    }
  }
  for (const [name, buf] of shieldArt()) icons.set(name, buf)
  icons.set('dot', dotSvg())
  return [...icons.entries()].sort(([a], [b]) => a.localeCompare(b))
}

/** Shields are the sheet's only full-colour art; see `shieldArt`. */
const isShield = name => SHIELD_NETWORKS.some(n => new RegExp(`^${n}-\\d$`).test(name))
const SHIELD_NETWORKS = ['us-interstate', 'us-highway', 'us-state', 'default', 'motorway-exit']

async function buildSheet(icons, ratio) {
  const buffer = BUFFER * ratio
  const rendered = []

  for (const [name, source] of icons) {
    // Shields arrive as inline SVG buffers; everything else as a file path.
    const svg = Buffer.isBuffer(source) ? source : await readFile(source)
    const colour = isShield(name)
    // A distance field needs transparent room around the glyph to ramp into.
    // Colour art is blitted as-is, so padding it would only inflate its
    // collision box.
    const pad = colour ? 0 : buffer
    // Measure at the base density, then scale by `ratio` exactly once.
    //
    // `density` already scales a vector: at 72 a 15-unit SVG rasterises to
    // 15px, at 144 to 30px. Reading the metadata off the *scaled* render and
    // then multiplying by `ratio` applied it twice, so the @2x sheet came out
    // at 4x the design size and every icon it carries drew ~1.7x too large on
    // a retina display — while the 1x sheet was correct, so the same map was
    // a different size on two monitors. Badges escaped it only because
    // `badgeAlpha` computes its own size rather than reading it back.
    const meta = await sharp(svg, { density: 72 }).metadata()
    const width = Math.round((meta.width ?? 15) * ratio)
    const height = Math.round((meta.height ?? 15) * ratio)

    const padded = await sharp(svg, { density: 72 * ratio })
      .resize(width, height, { fit: 'fill' })
      .extend({
        top: pad,
        bottom: pad,
        left: pad,
        right: pad,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })

    const w = padded.info.width
    const h = padded.info.height
    const channels = padded.info.channels

    if (colour) {
      // Premultiplied, because that is how MapLibre samples a non-SDF sprite.
      const rgba = Buffer.alloc(w * h * 4)
      for (let i = 0; i < w * h; i++) {
        const a = padded.data[i * channels + channels - 1]
        for (let c = 0; c < 3; c++) {
          rgba[i * 4 + c] = Math.round((padded.data[i * channels + c] * a) / 255)
        }
        rgba[i * 4 + 3] = a
      }
      rendered.push({ name, width: w, height: h, rgba })
      continue
    }

    const alpha = Buffer.alloc(w * h)
    for (let i = 0; i < w * h; i++) alpha[i] = padded.data[i * channels + channels - 1]

    rendered.push({ name, width: w, height: h, sdf: alphaToSdf(alpha, w, h) })

    // The dot is never worn as a badge — it is not a POI glyph.
    if (name !== 'dot' && name !== 'oneway') {
      const badge = await badgeAlpha(svg, ratio)
      const bw = badge.size + buffer * 2
      const padded = Buffer.alloc(bw * bw)
      for (let y = 0; y < badge.size; y++) {
        for (let x = 0; x < badge.size; x++) {
          padded[(y + buffer) * bw + (x + buffer)] = badge.alpha[y * badge.size + x]
        }
      }
      rendered.push({
        name: `${BADGE_PREFIX}${name}`,
        width: bw,
        height: bw,
        sdf: alphaToSdf(padded, bw, bw),
      })

      if (TRANSIT_ICONS.includes(name)) {
        const tile = await badgeAlpha(svg, ratio, 'tile')
        const tw = tile.size + buffer * 2
        const tp = Buffer.alloc(tw * tw)
        for (let y = 0; y < tile.size; y++) {
          for (let x = 0; x < tile.size; x++) {
            tp[(y + buffer) * tw + (x + buffer)] = tile.alpha[y * tile.size + x]
          }
        }
        rendered.push({
          name: `${TILE_PREFIX}${name}`,
          width: tw,
          height: tw,
          sdf: alphaToSdf(tp, tw, tw),
        })
      }
    }
  }

  // Pack. shelf-pack grows the sheet as needed; a power-of-two width keeps
  // the texture friendly to older GL drivers.
  const packer = new ShelfPack(1, 1, { autoResize: true })
  const placed = []
  for (const icon of rendered) {
    const bin = packer.packOne(icon.width, icon.height, icon.name)
    placed.push({ ...icon, x: bin.x, y: bin.y })
  }

  const sheetWidth = packer.w
  const sheetHeight = packer.h

  // Compose a single grey+alpha image: MapLibre reads the alpha channel of an
  // SDF sprite, so the distance field goes in alpha and RGB stays white.
  const sheet = Buffer.alloc(sheetWidth * sheetHeight * 4)
  for (let i = 0; i < sheetWidth * sheetHeight; i++) {
    sheet[i * 4] = 255
    sheet[i * 4 + 1] = 255
    sheet[i * 4 + 2] = 255
    sheet[i * 4 + 3] = 0
  }

  const manifest = {}
  for (const icon of placed) {
    for (let y = 0; y < icon.height; y++) {
      for (let x = 0; x < icon.width; x++) {
        const dst = ((icon.y + y) * sheetWidth + (icon.x + x)) * 4
        const src = y * icon.width + x
        if (icon.rgba) {
          for (let c = 0; c < 4; c++) sheet[dst + c] = icon.rgba[src * 4 + c]
        } else {
          sheet[dst + 3] = icon.sdf[src]
        }
      }
    }
    manifest[icon.name] = {
      x: icon.x,
      y: icon.y,
      width: icon.width,
      height: icon.height,
      pixelRatio: ratio,
      sdf: !icon.rgba,
    }
  }

  // Aliases point at an existing box rather than packing the icon twice.
  for (const [alias, target] of Object.entries(ALIASES)) {
    if (manifest[target] && !manifest[alias]) manifest[alias] = { ...manifest[target] }
    // Badges alias exactly as their glyphs do, or a class that reaches its
    // icon through an alias would have no badge form.
    for (const prefix of [BADGE_PREFIX, TILE_PREFIX]) {
      const [a, t] = [prefix + alias, prefix + target]
      if (manifest[t] && !manifest[a]) manifest[a] = { ...manifest[t] }
    }
  }
  for (const name of Object.keys(manifest)) {
    // Maki hyphenates (`fast-food`), OpenMapTiles underscores (`fast_food`).
    // Only the icon's own name is rewritten, never the `badge-` prefix.
    const prefix = [BADGE_PREFIX, TILE_PREFIX].find(p => name.startsWith(p)) ?? ''
    const stem = name.slice(prefix.length)
    // Shields are hyphenated on purpose — that is the name the style builds.
    if (!stem.includes('-') || isShield(stem)) continue
    const underscored = prefix + stem.replace(/-/g, '_')
    if (!manifest[underscored]) manifest[underscored] = { ...manifest[name] }
  }

  const png = await sharp(sheet, {
    raw: { width: sheetWidth, height: sheetHeight, channels: 4 },
  })
    .png({ compressionLevel: 9 })
    .toBuffer()

  return { png, manifest, sheetWidth, sheetHeight }
}

async function main() {
  const icons = await collectIcons()
  if (!icons.length) throw new Error(`no SVGs found in ${MAKI} or ${LOCAL}`)
  await mkdir(OUT, { recursive: true })

  for (const ratio of [1, 2]) {
    const suffix = ratio === 1 ? '' : `@${ratio}x`
    const { png, manifest, sheetWidth, sheetHeight } = await buildSheet(icons, ratio)
    await writeFile(join(OUT, `parchment${suffix}.png`), png)
    await writeFile(
      join(OUT, `parchment${suffix}.json`),
      `${JSON.stringify(manifest, null, 2)}\n`,
    )
    console.log(
      `parchment${suffix}: ${icons.length} icons, ${sheetWidth}x${sheetHeight}, ${(png.length / 1024).toFixed(1)} KB`,
    )
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
