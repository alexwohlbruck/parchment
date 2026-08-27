/**
 * The building colour expression, shared by the style generator and the dev
 * tuning panel so the two cannot drift. Plain `.mjs` because the generator is a
 * Node script and the app is Vite — both import this file directly.
 */

/**
 * How much of a building's own colour survives, per flavor.
 *
 * OpenMapTiles carries `building:colour` from OSM, and in a mapped-out city it
 * is on most buildings — 67-91% across central Manhattan — so this drives the
 * look of the whole 3D layer rather than being a rare accent.
 *
 * Only the *chroma* is taken; lightness comes from the flavor. Sampling a 7x7
 * grid of z14 tiles over Manhattan, 8501 buildings carry a colour and 155 of
 * them are literally `black` with another 52 `white` — real facade paint, and
 * holes punched in the map if drawn as given. Since the values are photographic
 * they carry no information about a building's place in the map's value
 * structure, so discarding their lightness loses nothing and costs a whole
 * class of blown-out and pitch-black outliers.
 *
 * Dark keeps less: at low lightness the same chroma reads as far more saturated.
 */
export const BUILDING_CHROMA = { light: 0.26, dark: 0.17 }

/**
 * A building's colour, taking the tile's `building:colour` as a *tint* on the
 * flavor's building colour rather than as the colour itself.
 *
 *     out = flavor + chroma * (tile - luminance(tile))
 *
 * Subtracting the tile colour's own luminance leaves only how far each channel
 * departs from neutral, so hue and saturation come from OSM while lightness
 * stays entirely the map's to decide. A grey building of any lightness — black,
 * white, `lightgray` — has no departure to contribute and comes out as a plain
 * building, which is what makes the extremes safe without special-casing them.
 *
 * The grey second argument to `to-color` is what makes bad data safe. About
 * 0.06% of tagged buildings carry something unparseable — `brick`, `light_grey`,
 * a hex string with a digit too many — and `to-color` throws on those rather
 * than returning null, so `coalesce` cannot catch it and the layer falls back to
 * the property default, which is black. Given a second argument it converts that
 * instead, and a neutral grey contributes no hue, so the building renders plain.
 *
 * `let` binds the tile colour once — it is read four times, and `rgb` rejects a
 * channel outside 0-255 outright, so each one is clamped rather than trusted.
 */
export function buildingColor(chroma, colorToken = '@building_3d_fill_extrusion_color') {
  const c = i => ['at', i, ['var', 'tile']]
  const channel = i => [
    'max', 0, ['min', 255,
      ['+', ['at', i, ['to-rgba', ['to-color', colorToken]]],
        ['*', chroma, ['-', c(i), ['var', 'luma']]]]],
  ]
  return [
    'case',
    ['has', 'colour'],
    ['let', 'tile', ['to-rgba', ['to-color', ['get', 'colour'], '#808080']],
      ['let', 'luma', ['+', ['*', 0.2126, c(0)], ['*', 0.7152, c(1)], ['*', 0.0722, c(2)]],
        ['rgb', channel(0), channel(1), channel(2)]]],
    colorToken,
  ]
}
