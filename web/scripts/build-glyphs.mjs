#!/usr/bin/env node
/**
 * Builds self-hosted glyph PBFs for the basemap's font stacks.
 *
 * MapLibre joins a font stack into a single request path — a style naming
 * `["Geist Medium", "Noto Sans Regular"]` asks the server for
 * `Geist Medium,Noto Sans Regular/0-255.pbf`. Public glyph servers only
 * carry single-font stacks, so those requests 404 and the labels silently do
 * not draw. Generating the composite stacks ourselves is what lets the style
 * name its fonts exactly as MapTiler Streets does.
 *
 * Geist, Inter, Roboto and Noto Sans are all OFL or Apache, so ours to redistribute.
 * They arrive from @fontsource as woff2 (there is no ttf release), which
 * `wawoff2` turns back into the sfnt fontnik needs.
 *
 * Run with: bun run build:glyphs [stack name…]
 */
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import fontnik from 'fontnik'
import { decompress } from 'wawoff2'

const HERE = dirname(fileURLToPath(import.meta.url))
const WEB = resolve(HERE, '..')
const VENDOR = resolve(WEB, 'scripts/vendor/fonts')
const OUT = resolve(WEB, 'public/fonts')

const range = promisify(fontnik.range)
const composite = promisify(fontnik.composite)

/**
 * Codepoints 0x0000–0x2FFF: Latin, Latin Extended, IPA, Greek, Cyrillic,
 * Hebrew, Arabic, the Indic blocks, and — the one that bites if you stop at
 * 0x1FFF — General Punctuation, where the en-dashes and curly quotes in
 * place names live.
 */
const LAST_RANGE = 0x2fff

/**
 * The stacks the style names — each ONE font name, with Noto Sans composited
 * in underneath as the fallback for scripts Geist does not cover.
 *
 * The name must not contain a comma. MapLibre builds the glyph URL with
 * `encodeURIComponent(fontstack)`, which turns `,` into `%2C`, and static file
 * servers do not decode that back into a directory name — the request falls
 * through to the SPA's index.html, and MapLibre then tries to parse HTML as
 * protobuf ("Unimplemented type: 4") and every label silently disappears.
 * Curling the same path with a literal comma succeeds, which makes this look
 * like a corrupt-font problem when it is a URL-encoding one.
 */
const STACKS = [
  { name: 'Geist Regular', weight: '400-normal', style: 'Regular' },
  { name: 'Geist Medium', weight: '500-normal', style: 'Medium' },
  { name: 'Geist SemiBold', weight: '600-normal', style: 'SemiBold' },
  { name: 'Geist Bold', weight: '700-normal', style: 'Bold' },
  // The Cupertino and Mountain View map themes' families: the nearest open
  // faces to SF Pro and to the one Google Maps sets its labels in.
  ...['Inter', 'Roboto'].flatMap(family => [
    { name: `${family} Regular`, weight: '400-normal', style: 'Regular' },
    { name: `${family} Medium`, weight: '500-normal', style: 'Medium' },
    { name: `${family} SemiBold`, weight: '600-normal', style: 'SemiBold' },
    { name: `${family} Bold`, weight: '700-normal', style: 'Bold' },
  ]),
  // Water names. @fontsource ships no Geist italic, so it is vendored from the
  // `geist` package.
  { name: 'Geist Italic', vendor: 'Geist-Italic.ttf', style: 'Regular', noto: 'NotoSans-Italic.ttf' },
  ...['Inter', 'Roboto', 'EB Garamond'].map(family => (
    { name: `${family} Italic`, family, weight: '400-italic', style: 'Regular', noto: 'NotoSans-Italic.ttf' }
  )),
  // Cupertino's tall, narrow district names.
  { name: 'Barlow Condensed SemiBold', family: 'Barlow Condensed', weight: '600-normal', style: 'SemiBold' },
  // The Parchment chart theme: Garamond for the working labels, Fell types for
  // the engraved town names and the italic seas and rivers.
  ...['Regular', 'Medium', 'SemiBold', 'Bold'].map((style, i) => (
    { name: `EB Garamond ${style}`, family: 'EB Garamond', weight: `${400 + 100 * i}-normal`, style }
  )),
  { name: 'IM Fell English Italic', family: 'IM Fell English', weight: '400-italic', style: 'Regular', noto: 'NotoSans-Italic.ttf' },
  { name: 'IM Fell English SC Regular', family: 'IM Fell English SC', weight: '400-normal', style: 'Regular' },
]

/**
 * Noto faces under Geist, in order, for scripts neither Geist nor Noto Sans
 * covers: syllabics (Inuktitut, Cree, Ojibwe) and Cherokee, which name
 * Indigenous lands. Static instances at each stack's weight, cut from Google
 * Fonts' variable files with `fonttools varLib.instancer`.
 */
const SCRIPT_FALLBACKS = ['NotoSansCanadianAboriginal', 'NotoSansCherokee']

/**
 * Geist ships Latin only, where Roboto carried nine subsets — so for anything
 * outside Latin the composite falls straight through to Noto Sans, which was
 * already the fallback for the scripts Roboto did not cover either.
 *
 * There is no italic. Geist has no italic face, and fontnik cannot slant one,
 * so the layers MapTiler sets in italic — water and waterway labels — are set
 * upright in Geist Regular instead. Mapbox Standard sets its water labels
 * upright too; the alternative is one family for the map and a second one for
 * four layers, which reads worse than losing the slant.
 */
const SUBSET_DIRS = {
  Roboto: resolve(WEB, 'node_modules/@fontsource/roboto/files'),
  Geist: resolve(WEB, 'node_modules/@fontsource/geist-sans/files'),
  Inter: resolve(WEB, 'node_modules/@fontsource/inter/files'),
  'Barlow Condensed': resolve(WEB, 'node_modules/@fontsource/barlow-condensed/files'),
  'EB Garamond': resolve(WEB, 'node_modules/@fontsource/eb-garamond/files'),
  'IM Fell English': resolve(WEB, 'node_modules/@fontsource/im-fell-english/files'),
  'IM Fell English SC': resolve(WEB, 'node_modules/@fontsource/im-fell-english-sc/files'),
}

/** @fontsource splits each weight across these subsets. */
const SUBSETS = [
  'latin', 'latin-ext', 'cyrillic', 'cyrillic-ext',
  'greek', 'greek-ext', 'vietnamese', 'math', 'symbols',
]

/** Every subset @fontsource ships for a family at one weight, as sfnt. */
async function familyFaces(family, weight) {
  const dir = SUBSET_DIRS[family]
  const slug = family === 'Geist' ? 'geist-sans' : family.toLowerCase().replace(/ /g, '-')
  const out = []
  for (const subset of SUBSETS) {
    const file = join(dir, `${slug}-${subset}-${weight}.woff2`)
    if (!existsSync(file)) continue
    out.push(Buffer.from(await decompress(await readFile(file))))
  }
  if (!out.length) throw new Error(`no @fontsource files for ${family} ${weight}`)
  return out
}

async function main() {
  if (!existsSync(VENDOR)) {
    throw new Error(
      `missing ${VENDOR}. Place NotoSans-Regular.ttf and NotoSans-Italic.ttf there ` +
        `(OFL, from github.com/google/fonts/tree/main/ofl/notosans).`,
    )
  }
  await mkdir(OUT, { recursive: true })

  const only = process.argv.slice(2)
  for (const stack of STACKS.filter(s => !only.length || only.includes(s.name))) {
    const faces = [
      ...(stack.vendor
        ? [await readFile(join(VENDOR, stack.vendor))]
        : await familyFaces(stack.family ?? stack.name.split(' ')[0], stack.weight)),
      await readFile(join(VENDOR, stack.noto ?? 'NotoSans-Regular.ttf')),
      ...(await Promise.all(SCRIPT_FALLBACKS.map(f => readFile(join(VENDOR, `${f}-${stack.style}.ttf`))))),
    ]
    const dir = join(OUT, stack.name)
    await mkdir(dir, { recursive: true })

    let written = 0
    let bytes = 0
    for (let start = 0; start <= LAST_RANGE; start += 256) {
      const end = start + 255
      // One PBF per face, then composite: earlier faces win, so Geist's
      // glyphs are used wherever it has them and Noto Sans fills the rest.
      const perFace = []
      for (const font of faces) {
        perFace.push(await range({ font, start, end }))
      }
      const merged = await composite(perFace)
      await writeFile(join(dir, `${start}-${end}.pbf`), merged)
      written++
      bytes += merged.length
    }
    console.log(
      `${stack.name}: ${written} ranges, ${(bytes / 1024 / 1024).toFixed(1)} MB`,
    )
  }

  const dirs = await readdir(OUT)
  console.log(`\nwrote ${dirs.length} stacks to public/fonts`)
}

main().catch(err => {
  console.error(err.message)
  process.exit(1)
})
