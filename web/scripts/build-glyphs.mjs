#!/usr/bin/env node
/**
 * Builds self-hosted glyph PBFs for the basemap's font stacks.
 *
 * MapLibre joins a font stack into a single request path — a style naming
 * `["Roboto Medium", "Noto Sans Regular"]` asks the server for
 * `Roboto Medium,Noto Sans Regular/0-255.pbf`. Public glyph servers only
 * carry single-font stacks, so those requests 404 and the labels silently do
 * not draw. Generating the composite stacks ourselves is what lets the style
 * name its fonts exactly as MapTiler Streets does.
 *
 * Roboto is Apache-2.0 and Noto Sans is OFL, so both are ours to redistribute.
 * Roboto arrives from @fontsource as woff2 (there is no ttf release), which
 * `wawoff2` turns back into the sfnt fontnik needs.
 *
 * Run with: bun run build:glyphs
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
const ROBOTO = resolve(WEB, 'node_modules/@fontsource/roboto/files')
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
 * in underneath as the fallback for scripts Roboto does not cover.
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
  { name: 'Roboto Regular', weight: '400-normal', fallback: 'NotoSans-Regular.ttf' },
  { name: 'Roboto Medium', weight: '500-normal', fallback: 'NotoSans-Regular.ttf' },
  { name: 'Roboto Bold', weight: '700-normal', fallback: 'NotoSans-Regular.ttf' },
  { name: 'Roboto Italic', weight: '400-italic', fallback: 'NotoSans-Italic.ttf' },
]

/** @fontsource splits each weight across these subsets. */
const SUBSETS = [
  'latin', 'latin-ext', 'cyrillic', 'cyrillic-ext',
  'greek', 'greek-ext', 'vietnamese', 'math', 'symbols',
]

async function robotoFaces(weight) {
  const out = []
  for (const subset of SUBSETS) {
    const file = join(ROBOTO, `roboto-${subset}-${weight}.woff2`)
    if (!existsSync(file)) continue
    out.push(Buffer.from(await decompress(await readFile(file))))
  }
  if (!out.length) throw new Error(`no @fontsource/roboto files for weight ${weight}`)
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

  for (const stack of STACKS) {
    const faces = [
      ...(await robotoFaces(stack.weight)),
      await readFile(join(VENDOR, stack.fallback)),
    ]
    const dir = join(OUT, stack.name)
    await mkdir(dir, { recursive: true })

    let written = 0
    let bytes = 0
    for (let start = 0; start <= LAST_RANGE; start += 256) {
      const end = start + 255
      // One PBF per face, then composite: earlier faces win, so Roboto's
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
