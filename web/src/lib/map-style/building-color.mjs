/**
 * The building colour expression, shared by the style generator and the dev
 * tuning panel so the two cannot drift. Plain `.mjs` because the generator is a
 * Node script and the app is Vite — both import this file directly.
 */

/**
 * How far a building's own colour pulls the flavor's, per flavor.
 *
 * In channel units on the 0-255 scale, at full colourfulness: the strongest
 * channel of the tint moves about this far from neutral. Night carries more
 * than day because it has the room — the daylight building sits at L 97, where
 * the tint has nowhere to go but down (see `bias`).
 *
 * OpenMapTiles carries `building:colour` from OSM, and in a mapped-out city it
 * is on most buildings — 67-91% across central Manhattan — so this drives the
 * look of the whole 3D layer rather than being a rare accent.
 */
export const BUILDING_TINT = { light: 34, dark: 46 }

/**
 * The tile chroma at which a colour counts as fully coloured, in channel units
 * (`max(r,g,b) - min(r,g,b)`).
 *
 * Below it the tint scales down linearly, so a near-grey contributes a
 * near-nothing and a true grey — black, white, `lightgray` — contributes
 * exactly nothing and the building renders plain. That is the property that
 * makes the extremes safe without special-casing them: sampling a 7x7 grid of
 * z14 tiles over Manhattan, 8501 buildings carry a colour and 155 of them are
 * literally `black` with another 52 `white`. Real facade paint, and holes
 * punched in the map if drawn as given.
 *
 * 48 is about where a facade stops reading as "a grey with a cast" and starts
 * reading as a colour — beige (`#F5F5DC`, chroma 25) lands at half strength.
 */
const CHROMA_REF = 48

/**
 * How much headroom above the flavor colour counts as "room to tint upward".
 *
 * A tint is a direction in colour space, and adding it to a base that is
 * already near white clips the channel it wants to raise — which does not just
 * cap the effect, it bends the hue, because the other two channels keep moving
 * and the one carrying the colour cannot. So where there is no headroom the
 * whole direction is slid down until its brightest channel sits at zero and the
 * tint works by darkening the other two instead. A near-white surface shows its
 * colour by absorbing, which is also what one does in life.
 *
 * Derived from the flavor colour rather than set per flavor, so retuning the
 * building colour cannot leave a stale bias behind it.
 */
const HEADROOM_REF = 90

/**
 * A building's colour, taking the tile's `building:colour` as a *tint* on the
 * flavor's building colour rather than as the colour itself.
 *
 * Three quantities are read off the tile colour, and its lightness is not one
 * of them — the values are photographic and carry no information about a
 * building's place in the map's value structure, so lightness stays entirely
 * the map's to decide:
 *
 *   hue          the direction `(channel - mean)`, normalised. The mean is
 *                unweighted on purpose. Weighting it by luminance — which is
 *                what this did before — makes the direction anisotropic, since
 *                blue carries only 0.07 of the luminance and red and green
 *                carry the rest: any blue content swung the blue channel hard
 *                while red and green movements were damped to nothing. The
 *                whole palette collapsed onto the blue-yellow axis, and a dark
 *                red facade came out blue on the night map.
 *   colourfulness `max - min`, which is independent of how light the colour is.
 *                The old expression scaled the tint by the tile's departure in
 *                absolute channel units, so a dark saturated colour — maroon,
 *                bottle green, a dark brown — had almost no departure to give
 *                and barely tinted at all, while a pale one tinted strongly.
 *                Normalising by it means `#4B0000` and `#FF0000` land on the
 *                same red.
 *   nothing else the flavor supplies the lightness, and its own colour cast is
 *                faded out as the tile's colour comes in. Without that fade the
 *                night flavor's blue-grey simply outvoted the tint: it is a
 *                third saturated itself, so a small delta added on top left
 *                every building reading blue whatever it was painted.
 *
 * The grey second argument to `to-color` is what makes bad data safe. About
 * 0.06% of tagged buildings carry something unparseable — `brick`, `light_grey`,
 * a hex string with a digit too many — and `to-color` throws on those rather
 * than returning null, so `coalesce` cannot catch it and the layer falls back to
 * the property default, which is black. Given a second argument it converts that
 * instead, and a neutral grey contributes no hue, so the building renders plain.
 *
 * `let` bindings cannot see each other — only the expression they wrap — so the
 * quantities are nested in dependency order rather than declared in one block.
 */
export function buildingColor(
  amount,
  colorToken = '@building_3d_fill_extrusion_color',
  properties = ['colour'],
) {
  // The first of `properties` the feature carries. One name is the ordinary
  // case; the roof passes `['roof_colour', 'colour']` so a building that
  // records only a wall colour keeps a roof to match, rather than falling all
  // the way back to the flavor's plain building and banding at the roofline.
  const present = properties.length === 1
    ? ['has', properties[0]]
    : ['any', ...properties.map(p => ['has', p])]
  const painted = properties.length === 1
    ? ['get', properties[0]]
    : ['coalesce', ...properties.map(p => ['get', p])]
  const t = i => ['at', i, ['var', 'tile']]
  const f = i => ['at', i, ['var', 'flavor']]
  const mean = c => ['/', ['+', c(0), c(1), c(2)], 3]

  /**
   * One channel of the result: the flavor's own lightness, plus as much of the
   * flavor's own cast as the tile has left it, plus the tile's hue — the last
   * slid down by `sub` where the flavor has no headroom to be raised into.
   */
  const channel = i => [
    'max', 0, ['min', 255,
      ['+',
        ['var', 'base'],
        ['*', ['-', 1, ['var', 'colourfulness']], ['-', f(i), ['var', 'base']]],
        ['*', ['var', 'scale'], ['-', t(i), ['var', 'mid']]],
        ['-', ['var', 'sub']]]],
  ]

  return [
    'case',
    present,
    ['let',
      'tile', ['to-rgba', ['to-color', painted, '#808080']],
      'flavor', ['to-rgba', ['to-color', colorToken]],
      ['let',
        'high', ['max', t(0), t(1), t(2)],
        'low', ['min', t(0), t(1), t(2)],
        'mid', mean(t),
        'base', mean(f),
        'headroom', ['-', 255, ['max', f(0), f(1), f(2)]],
        ['let',
          'chroma', ['-', ['var', 'high'], ['var', 'low']],
          'bias', ['-', 1, ['min', 1, ['/', ['var', 'headroom'], HEADROOM_REF]]],
          ['let',
            // Below CHROMA_REF this is a constant, so the tint grows linearly
            // with the tile's own chroma; above it the tile is normalised and
            // the tint holds at `amount`. One expression, both regimes.
            'scale', ['/', amount, ['max', ['var', 'chroma'], CHROMA_REF]],
            'colourfulness', ['min', 1, ['/', ['var', 'chroma'], CHROMA_REF]],
            ['let',
              'sub', ['*', ['var', 'bias'], ['-', ['var', 'high'], ['var', 'mid']], ['var', 'scale']],
              ['rgb', channel(0), channel(1), channel(2)]]]]]],
    colorToken,
  ]
}
