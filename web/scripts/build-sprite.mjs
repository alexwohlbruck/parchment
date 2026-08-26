#!/usr/bin/env node
/**
 * Builds the basemap sprite sheet from Maki (CC0) plus any local overrides.
 *
 * Icons are emitted as SDFs, not plain rasters, because the style tints them
 * per POI family and per theme via `icon-color` — which MapLibre only honours
 * for SDF sprites. Anything else would mean baking one sheet per flavor.
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

const HERE = dirname(fileURLToPath(import.meta.url))
const WEB = resolve(HERE, '..')
const MAKI = resolve(WEB, 'node_modules/@mapbox/maki/icons')
const LOCAL = resolve(WEB, 'src/assets/map-icons')
const OUT = resolve(WEB, 'public/sprites')

/** Transparent padding around each icon, so the distance field has room. */
const BUFFER = 3
/** Distance, in pixels, that the field ramps over. */
const RADIUS = 8
/** Where the 0.5 alpha boundary lands in the encoded range. */
const CUTOFF = 0.25

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
 * Route shields. The style asks for `road_{ref_length}` / `exit_{ref_length}`,
 * so the sheet needs one background per ref width. Maki has no shield art, and
 * MapTiler's is in their sprite, so we draw plain rounded rectangles: solid
 * SDFs the style tints per flavor, with the route number set over them by the
 * layer's own text-color. Widths are in the 15-unit grid Maki icons use.
 */
const SHIELD_WIDTHS = { 1: 13, 2: 15, 3: 19, 4: 23, 5: 27, 6: 31 }

function shieldSvg(width) {
  const h = 13
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${h}" viewBox="0 0 ${width} ${h}">` +
      `<rect x="0.5" y="0.5" width="${width - 1}" height="${h - 1}" rx="2.5" ry="2.5" fill="#000"/>` +
      `</svg>`,
  )
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
async function badgeAlpha(svg, ratio) {
  const size = Math.round(BADGE_DIAMETER * ratio)
  const glyphSize = Math.round(size * BADGE_GLYPH_RATIO)
  const inset = Math.round((size - glyphSize) / 2)

  const rawAlpha = async input => {
    const { data, info } = await input.ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    const out = Buffer.alloc(info.width * info.height)
    for (let i = 0; i < out.length; i++) out[i] = data[i * info.channels + info.channels - 1]
    return out
  }

  const disc = await rawAlpha(
    sharp(
      Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">` +
          `<circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="#000"/></svg>`,
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
  for (const [refLength, width] of Object.entries(SHIELD_WIDTHS)) {
    icons.set(`road_${refLength}`, shieldSvg(width))
    icons.set(`exit_${refLength}`, shieldSvg(width))
  }
  icons.set('dot', dotSvg())
  return [...icons.entries()].sort(([a], [b]) => a.localeCompare(b))
}

async function buildSheet(icons, ratio) {
  const buffer = BUFFER * ratio
  const rendered = []

  for (const [name, source] of icons) {
    // Shields arrive as inline SVG buffers; everything else as a file path.
    const svg = Buffer.isBuffer(source) ? source : await readFile(source)
    const base = sharp(svg, { density: 72 * ratio })
    const meta = await base.metadata()
    const width = Math.round((meta.width ?? 15) * ratio)
    const height = Math.round((meta.height ?? 15) * ratio)

    const padded = await sharp(svg, { density: 72 * ratio })
      .resize(width, height, { fit: 'fill' })
      .extend({
        top: buffer,
        bottom: buffer,
        left: buffer,
        right: buffer,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })

    const w = padded.info.width
    const h = padded.info.height
    const channels = padded.info.channels
    const alpha = Buffer.alloc(w * h)
    for (let i = 0; i < w * h; i++) alpha[i] = padded.data[i * channels + channels - 1]

    rendered.push({ name, width: w, height: h, sdf: alphaToSdf(alpha, w, h) })

    // Shields and the dot are never worn as badges — they are not POI glyphs.
    if (!/^(road|exit)_\d$/.test(name) && name !== 'dot' && name !== 'oneway') {
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
        sheet[dst + 3] = icon.sdf[y * icon.width + x]
      }
    }
    manifest[icon.name] = {
      x: icon.x,
      y: icon.y,
      width: icon.width,
      height: icon.height,
      pixelRatio: ratio,
      sdf: true,
    }
  }

  // Aliases point at an existing box rather than packing the icon twice.
  for (const [alias, target] of Object.entries(ALIASES)) {
    if (manifest[target] && !manifest[alias]) manifest[alias] = { ...manifest[target] }
    // Badges alias exactly as their glyphs do, or a class that reaches its
    // icon through an alias would have no badge form.
    const [ba, bt] = [BADGE_PREFIX + alias, BADGE_PREFIX + target]
    if (manifest[bt] && !manifest[ba]) manifest[ba] = { ...manifest[bt] }
  }
  for (const name of Object.keys(manifest)) {
    // Maki hyphenates (`fast-food`), OpenMapTiles underscores (`fast_food`).
    // Only the icon's own name is rewritten, never the `badge-` prefix.
    const stem = name.startsWith(BADGE_PREFIX) ? name.slice(BADGE_PREFIX.length) : name
    if (!stem.includes('-')) continue
    const underscored =
      (name.startsWith(BADGE_PREFIX) ? BADGE_PREFIX : '') + stem.replace(/-/g, '_')
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
