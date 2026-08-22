/**
 * A curated model of the Mapbox / MapLibre style spec, shaped for an editor.
 *
 * The real spec has a few hundred properties across a dozen layer types, most
 * of which nobody sets by hand. Rather than reflecting over it and rendering
 * whatever falls out, this module keeps a hand-picked catalogue: the
 * properties worth a control, grouped into sections that read like the thing
 * being drawn ("Stroke", "Icon", "Label") rather than like the JSON.
 *
 * Property names are the spec's own (`line-dasharray`, `text-halo-width`) —
 * they are the vocabulary shared with Mapbox Studio, Maputnik and every style
 * on the web, so they are deliberately NOT translated. Section titles and the
 * surrounding chrome are. Labels drop the redundant prefix the section already
 * carries, so `fill-color` reads as "Colour" inside the Fill section.
 *
 * Anything not catalogued is still editable: the editor's JSON view writes the
 * raw configuration, and unknown keys survive a round-trip untouched.
 */

import { MapEngine } from '@/types/map.types'

// ── Layer + source kinds ─────────────────────────────────────────────────────

/** Layer types both engines can draw. Mapbox-only types are handled as raw JSON. */
export const STYLE_LAYER_KINDS = [
  'fill',
  'line',
  'symbol',
  'circle',
  'heatmap',
  'fill-extrusion',
  'raster',
  'hillshade',
  'background',
] as const

export type StyleLayerKind = (typeof STYLE_LAYER_KINDS)[number]

export const STYLE_SOURCE_KINDS = [
  'raster',
  'raster-dem',
  'vector',
  'geojson',
  'image',
] as const

export type StyleSourceKind = (typeof STYLE_SOURCE_KINDS)[number]

/**
 * Which layer types make sense on top of each source type. Picking a source
 * first and a layer type second is the order that stops people building
 * impossible combinations (a `fill` over raster tiles, say).
 */
export const LAYER_KINDS_BY_SOURCE: Record<
  StyleSourceKind,
  readonly StyleLayerKind[]
> = {
  raster: ['raster'],
  'raster-dem': ['hillshade'],
  vector: ['fill', 'line', 'symbol', 'circle', 'heatmap', 'fill-extrusion'],
  geojson: ['fill', 'line', 'symbol', 'circle', 'heatmap', 'fill-extrusion'],
  image: ['raster'],
}

/** Source types whose layers need a `source-layer`. */
export function requiresSourceLayer(kind: StyleSourceKind): boolean {
  return kind === 'vector'
}

// ── Property catalogue ───────────────────────────────────────────────────────

export type ControlKind =
  /** A CSS colour. */
  | 'color'
  /** A free number, no meaningful bounds. */
  | 'number'
  /** A bounded number worth a slider. */
  | 'range'
  /** One of a fixed set of spec keywords. */
  | 'select'
  | 'boolean'
  /** Free text — sprite names, `text-field` templates. */
  | 'text'
  /** An `[x, y]` pair (offsets, translates). */
  | 'point'
  /** A list of numbers (dash patterns). */
  | 'numbers'
  /** A list of strings (font stacks). */
  | 'strings'

export interface StyleProperty {
  /** The spec property name, e.g. `line-width`. */
  key: string
  /** Which bag it lives in on the layer. */
  bag: 'paint' | 'layout'
  /** Section id — see `LAYER_SECTIONS`. */
  section: string
  control: ControlKind
  /** Shown to the user. Omits whatever prefix the section already implies. */
  label: string
  /** One line of help, where the name alone isn't enough. */
  hint?: string
  default?: unknown
  min?: number
  max?: number
  step?: number
  /** Suffix rendered inside the control (px, °, …). */
  unit?: string
  /** Allowed values for `select`. */
  options?: readonly string[]
  /** Engines that support it. Absent means both. */
  engines?: readonly MapEngine[]
}

/** Anchors shared by every `*-translate-anchor`. */
const TRANSLATE_ANCHOR = ['map', 'viewport'] as const

function translateProps(prefix: string, section: string): StyleProperty[] {
  return [
    {
      key: `${prefix}-translate`,
      bag: 'paint',
      section,
      control: 'point',
      label: 'Offset',
      hint: 'Shifts the rendered layer by a screen-space [x, y] in pixels.',
      default: [0, 0],
      unit: 'px',
    },
    {
      key: `${prefix}-translate-anchor`,
      bag: 'paint',
      section,
      control: 'select',
      label: 'Offset anchor',
      options: TRANSLATE_ANCHOR,
      default: 'map',
    },
  ]
}

function sortKey(prefix: string, section: string): StyleProperty {
  return {
    key: `${prefix}-sort-key`,
    bag: 'layout',
    section,
    control: 'number',
    label: 'Sort key',
    hint: 'Features with a higher sort key draw on top.',
  }
}

const OPACITY = { min: 0, max: 1, step: 0.05, default: 1 } as const

const FILL: StyleProperty[] = [
  { key: 'fill-color', bag: 'paint', section: 'fill', control: 'color', label: 'Colour', default: '#000000' },
  { key: 'fill-opacity', bag: 'paint', section: 'fill', control: 'range', label: 'Opacity', ...OPACITY },
  { key: 'fill-outline-color', bag: 'paint', section: 'fill', control: 'color', label: 'Outline colour', hint: 'Draws a hairline border. Defaults to the fill colour.' },
  { key: 'fill-antialias', bag: 'paint', section: 'fill', control: 'boolean', label: 'Antialias', default: true },
  { key: 'fill-pattern', bag: 'paint', section: 'fill', control: 'text', label: 'Pattern', hint: 'Name of an image in the style’s sprite. Overrides the colour.' },
  ...translateProps('fill', 'position'),
  sortKey('fill', 'position'),
]

const LINE: StyleProperty[] = [
  { key: 'line-color', bag: 'paint', section: 'stroke', control: 'color', label: 'Colour', default: '#000000' },
  { key: 'line-width', bag: 'paint', section: 'stroke', control: 'range', label: 'Width', default: 1, min: 0, max: 24, step: 0.5, unit: 'px' },
  { key: 'line-opacity', bag: 'paint', section: 'stroke', control: 'range', label: 'Opacity', ...OPACITY },
  { key: 'line-blur', bag: 'paint', section: 'stroke', control: 'range', label: 'Blur', default: 0, min: 0, max: 20, step: 0.5, unit: 'px' },
  { key: 'line-cap', bag: 'layout', section: 'shape', control: 'select', label: 'Cap', options: ['butt', 'round', 'square'], default: 'butt' },
  { key: 'line-join', bag: 'layout', section: 'shape', control: 'select', label: 'Join', options: ['bevel', 'round', 'miter'], default: 'miter' },
  { key: 'line-dasharray', bag: 'paint', section: 'shape', control: 'numbers', label: 'Dash pattern', hint: 'Alternating dash and gap lengths, in line widths.' },
  { key: 'line-gap-width', bag: 'paint', section: 'shape', control: 'number', label: 'Gap width', hint: 'Draws a casing: an outer line this far either side of the centre.', default: 0, unit: 'px' },
  { key: 'line-offset', bag: 'paint', section: 'shape', control: 'number', label: 'Side offset', hint: 'Shifts the line perpendicular to its direction.', default: 0, unit: 'px' },
  { key: 'line-miter-limit', bag: 'layout', section: 'shape', control: 'number', label: 'Miter limit', default: 2 },
  { key: 'line-round-limit', bag: 'layout', section: 'shape', control: 'number', label: 'Round limit', default: 1.05 },
  { key: 'line-pattern', bag: 'paint', section: 'position', control: 'text', label: 'Pattern', hint: 'Name of an image in the style’s sprite. Overrides the colour.' },
  ...translateProps('line', 'position'),
  sortKey('line', 'position'),
]

const CIRCLE: StyleProperty[] = [
  { key: 'circle-color', bag: 'paint', section: 'circle', control: 'color', label: 'Colour', default: '#000000' },
  { key: 'circle-radius', bag: 'paint', section: 'circle', control: 'range', label: 'Radius', default: 5, min: 0, max: 40, step: 1, unit: 'px' },
  { key: 'circle-opacity', bag: 'paint', section: 'circle', control: 'range', label: 'Opacity', ...OPACITY },
  { key: 'circle-blur', bag: 'paint', section: 'circle', control: 'range', label: 'Blur', default: 0, min: 0, max: 5, step: 0.1 },
  { key: 'circle-stroke-color', bag: 'paint', section: 'stroke', control: 'color', label: 'Colour', default: '#000000' },
  { key: 'circle-stroke-width', bag: 'paint', section: 'stroke', control: 'range', label: 'Width', default: 0, min: 0, max: 12, step: 0.5, unit: 'px' },
  { key: 'circle-stroke-opacity', bag: 'paint', section: 'stroke', control: 'range', label: 'Opacity', ...OPACITY },
  { key: 'circle-pitch-alignment', bag: 'paint', section: 'position', control: 'select', label: 'Pitch alignment', options: ['map', 'viewport'], default: 'viewport' },
  { key: 'circle-pitch-scale', bag: 'paint', section: 'position', control: 'select', label: 'Pitch scale', options: ['map', 'viewport'], default: 'map' },
  ...translateProps('circle', 'position'),
  sortKey('circle', 'position'),
]

const SYMBOL: StyleProperty[] = [
  { key: 'symbol-placement', bag: 'layout', section: 'placement', control: 'select', label: 'Placement', options: ['point', 'line', 'line-center'], default: 'point' },
  { key: 'symbol-spacing', bag: 'layout', section: 'placement', control: 'number', label: 'Spacing', hint: 'Distance between repeated symbols on a line.', default: 250, unit: 'px' },
  { key: 'symbol-avoid-edges', bag: 'layout', section: 'placement', control: 'boolean', label: 'Avoid tile edges', default: false },
  { key: 'symbol-z-order', bag: 'layout', section: 'placement', control: 'select', label: 'Draw order', options: ['auto', 'viewport-y', 'source'], default: 'auto' },
  sortKey('symbol', 'placement'),

  { key: 'icon-image', bag: 'layout', section: 'icon', control: 'text', label: 'Image', hint: 'Name of an image in the style’s sprite.' },
  { key: 'icon-size', bag: 'layout', section: 'icon', control: 'range', label: 'Size', default: 1, min: 0, max: 5, step: 0.1, unit: '×' },
  { key: 'icon-color', bag: 'paint', section: 'icon', control: 'color', label: 'Colour', hint: 'Only tints SDF images.', default: '#000000' },
  { key: 'icon-opacity', bag: 'paint', section: 'icon', control: 'range', label: 'Opacity', ...OPACITY },
  { key: 'icon-rotate', bag: 'layout', section: 'icon', control: 'range', label: 'Rotation', default: 0, min: 0, max: 360, step: 1, unit: '°' },
  { key: 'icon-offset', bag: 'layout', section: 'icon', control: 'point', label: 'Offset', default: [0, 0], unit: 'px' },
  { key: 'icon-anchor', bag: 'layout', section: 'icon', control: 'select', label: 'Anchor', options: ['center', 'left', 'right', 'top', 'bottom', 'top-left', 'top-right', 'bottom-left', 'bottom-right'], default: 'center' },
  { key: 'icon-padding', bag: 'layout', section: 'icon', control: 'number', label: 'Padding', default: 2, unit: 'px' },
  { key: 'icon-allow-overlap', bag: 'layout', section: 'icon', control: 'boolean', label: 'Allow overlap', default: false },
  { key: 'icon-ignore-placement', bag: 'layout', section: 'icon', control: 'boolean', label: 'Ignore placement', default: false },
  { key: 'icon-optional', bag: 'layout', section: 'icon', control: 'boolean', label: 'Optional', hint: 'Draw the label even when the icon does not fit.', default: false },
  { key: 'icon-keep-upright', bag: 'layout', section: 'icon', control: 'boolean', label: 'Keep upright', default: false },
  { key: 'icon-rotation-alignment', bag: 'layout', section: 'icon', control: 'select', label: 'Rotation alignment', options: ['map', 'viewport', 'auto'], default: 'auto' },
  { key: 'icon-pitch-alignment', bag: 'layout', section: 'icon', control: 'select', label: 'Pitch alignment', options: ['map', 'viewport', 'auto'], default: 'auto' },
  { key: 'icon-halo-color', bag: 'paint', section: 'icon', control: 'color', label: 'Halo colour', default: 'rgba(0, 0, 0, 0)' },
  { key: 'icon-halo-width', bag: 'paint', section: 'icon', control: 'range', label: 'Halo width', default: 0, min: 0, max: 8, step: 0.5, unit: 'px' },
  { key: 'icon-halo-blur', bag: 'paint', section: 'icon', control: 'range', label: 'Halo blur', default: 0, min: 0, max: 8, step: 0.5, unit: 'px' },

  { key: 'text-field', bag: 'layout', section: 'text', control: 'text', label: 'Label', hint: 'A feature property in braces, e.g. {name}.' },
  { key: 'text-font', bag: 'layout', section: 'text', control: 'strings', label: 'Font stack', hint: 'Font names available in the style’s glyph set.' },
  { key: 'text-size', bag: 'layout', section: 'text', control: 'range', label: 'Size', default: 16, min: 1, max: 64, step: 1, unit: 'px' },
  { key: 'text-color', bag: 'paint', section: 'text', control: 'color', label: 'Colour', default: '#000000' },
  { key: 'text-opacity', bag: 'paint', section: 'text', control: 'range', label: 'Opacity', ...OPACITY },
  { key: 'text-halo-color', bag: 'paint', section: 'text', control: 'color', label: 'Halo colour', default: 'rgba(0, 0, 0, 0)' },
  { key: 'text-halo-width', bag: 'paint', section: 'text', control: 'range', label: 'Halo width', default: 0, min: 0, max: 8, step: 0.5, unit: 'px' },
  { key: 'text-halo-blur', bag: 'paint', section: 'text', control: 'range', label: 'Halo blur', default: 0, min: 0, max: 8, step: 0.5, unit: 'px' },
  { key: 'text-anchor', bag: 'layout', section: 'text', control: 'select', label: 'Anchor', options: ['center', 'left', 'right', 'top', 'bottom', 'top-left', 'top-right', 'bottom-left', 'bottom-right'], default: 'center' },
  { key: 'text-offset', bag: 'layout', section: 'text', control: 'point', label: 'Offset', default: [0, 0], unit: 'em' },
  { key: 'text-justify', bag: 'layout', section: 'text', control: 'select', label: 'Justify', options: ['auto', 'left', 'center', 'right'], default: 'center' },
  { key: 'text-transform', bag: 'layout', section: 'text', control: 'select', label: 'Transform', options: ['none', 'uppercase', 'lowercase'], default: 'none' },
  { key: 'text-letter-spacing', bag: 'layout', section: 'text', control: 'number', label: 'Letter spacing', default: 0, unit: 'em' },
  { key: 'text-line-height', bag: 'layout', section: 'text', control: 'number', label: 'Line height', default: 1.2, unit: 'em' },
  { key: 'text-max-width', bag: 'layout', section: 'text', control: 'number', label: 'Max width', default: 10, unit: 'em' },
  { key: 'text-rotate', bag: 'layout', section: 'text', control: 'range', label: 'Rotation', default: 0, min: 0, max: 360, step: 1, unit: '°' },
  { key: 'text-padding', bag: 'layout', section: 'text', control: 'number', label: 'Padding', default: 2, unit: 'px' },
  { key: 'text-max-angle', bag: 'layout', section: 'text', control: 'number', label: 'Max angle', hint: 'Maximum turn between two adjacent characters on a line.', default: 45, unit: '°' },
  { key: 'text-allow-overlap', bag: 'layout', section: 'text', control: 'boolean', label: 'Allow overlap', default: false },
  { key: 'text-ignore-placement', bag: 'layout', section: 'text', control: 'boolean', label: 'Ignore placement', default: false },
  { key: 'text-optional', bag: 'layout', section: 'text', control: 'boolean', label: 'Optional', hint: 'Draw the icon even when the label does not fit.', default: false },
  { key: 'text-keep-upright', bag: 'layout', section: 'text', control: 'boolean', label: 'Keep upright', default: true },
  { key: 'text-writing-mode', bag: 'layout', section: 'text', control: 'strings', label: 'Writing mode', hint: 'horizontal, vertical, or both in preference order.' },
  { key: 'text-variable-anchor', bag: 'layout', section: 'text', control: 'strings', label: 'Variable anchors', hint: 'Anchors to try in turn until the label fits.' },
  { key: 'text-radial-offset', bag: 'layout', section: 'text', control: 'number', label: 'Radial offset', default: 0, unit: 'em' },
  { key: 'text-rotation-alignment', bag: 'layout', section: 'text', control: 'select', label: 'Rotation alignment', options: ['map', 'viewport', 'auto'], default: 'auto' },
  { key: 'text-pitch-alignment', bag: 'layout', section: 'text', control: 'select', label: 'Pitch alignment', options: ['map', 'viewport', 'auto'], default: 'auto' },

  ...translateProps('icon', 'position'),
  ...translateProps('text', 'position'),
]

const HEATMAP: StyleProperty[] = [
  { key: 'heatmap-radius', bag: 'paint', section: 'heatmap', control: 'range', label: 'Radius', default: 30, min: 1, max: 120, step: 1, unit: 'px' },
  { key: 'heatmap-weight', bag: 'paint', section: 'heatmap', control: 'range', label: 'Weight', hint: 'How much a single feature contributes.', default: 1, min: 0, max: 5, step: 0.1 },
  { key: 'heatmap-intensity', bag: 'paint', section: 'heatmap', control: 'range', label: 'Intensity', default: 1, min: 0, max: 5, step: 0.1 },
  { key: 'heatmap-opacity', bag: 'paint', section: 'heatmap', control: 'range', label: 'Opacity', ...OPACITY },
]

const FILL_EXTRUSION: StyleProperty[] = [
  { key: 'fill-extrusion-color', bag: 'paint', section: 'extrusion', control: 'color', label: 'Colour', default: '#000000' },
  { key: 'fill-extrusion-height', bag: 'paint', section: 'extrusion', control: 'number', label: 'Height', default: 0, unit: 'm' },
  { key: 'fill-extrusion-base', bag: 'paint', section: 'extrusion', control: 'number', label: 'Base', default: 0, unit: 'm' },
  { key: 'fill-extrusion-opacity', bag: 'paint', section: 'extrusion', control: 'range', label: 'Opacity', ...OPACITY },
  { key: 'fill-extrusion-vertical-gradient', bag: 'paint', section: 'extrusion', control: 'boolean', label: 'Vertical gradient', hint: 'Shade walls by their orientation.', default: true },
  { key: 'fill-extrusion-pattern', bag: 'paint', section: 'extrusion', control: 'text', label: 'Pattern' },
  ...translateProps('fill-extrusion', 'position'),
]

const RASTER: StyleProperty[] = [
  { key: 'raster-opacity', bag: 'paint', section: 'raster', control: 'range', label: 'Opacity', ...OPACITY },
  { key: 'raster-brightness-min', bag: 'paint', section: 'raster', control: 'range', label: 'Brightness floor', default: 0, min: 0, max: 1, step: 0.05 },
  { key: 'raster-brightness-max', bag: 'paint', section: 'raster', control: 'range', label: 'Brightness ceiling', default: 1, min: 0, max: 1, step: 0.05 },
  { key: 'raster-contrast', bag: 'paint', section: 'raster', control: 'range', label: 'Contrast', default: 0, min: -1, max: 1, step: 0.05 },
  { key: 'raster-saturation', bag: 'paint', section: 'raster', control: 'range', label: 'Saturation', default: 0, min: -1, max: 1, step: 0.05 },
  { key: 'raster-hue-rotate', bag: 'paint', section: 'raster', control: 'range', label: 'Hue rotation', default: 0, min: 0, max: 360, step: 1, unit: '°' },
  { key: 'raster-resampling', bag: 'paint', section: 'raster', control: 'select', label: 'Resampling', options: ['linear', 'nearest'], default: 'linear' },
  { key: 'raster-fade-duration', bag: 'paint', section: 'raster', control: 'number', label: 'Fade duration', default: 300, unit: 'ms' },
]

const HILLSHADE: StyleProperty[] = [
  { key: 'hillshade-exaggeration', bag: 'paint', section: 'hillshade', control: 'range', label: 'Exaggeration', default: 0.5, min: 0, max: 1, step: 0.05 },
  { key: 'hillshade-illumination-direction', bag: 'paint', section: 'hillshade', control: 'range', label: 'Sun direction', default: 335, min: 0, max: 359, step: 1, unit: '°' },
  { key: 'hillshade-illumination-anchor', bag: 'paint', section: 'hillshade', control: 'select', label: 'Sun anchor', options: ['map', 'viewport'], default: 'viewport' },
  { key: 'hillshade-shadow-color', bag: 'paint', section: 'hillshade', control: 'color', label: 'Shadow', default: '#000000' },
  { key: 'hillshade-highlight-color', bag: 'paint', section: 'hillshade', control: 'color', label: 'Highlight', default: '#FFFFFF' },
  { key: 'hillshade-accent-color', bag: 'paint', section: 'hillshade', control: 'color', label: 'Accent', default: '#000000' },
]

const BACKGROUND: StyleProperty[] = [
  { key: 'background-color', bag: 'paint', section: 'background', control: 'color', label: 'Colour', default: '#000000' },
  { key: 'background-opacity', bag: 'paint', section: 'background', control: 'range', label: 'Opacity', ...OPACITY },
  { key: 'background-pattern', bag: 'paint', section: 'background', control: 'text', label: 'Pattern' },
]

export const LAYER_PROPERTIES: Record<StyleLayerKind, readonly StyleProperty[]> = {
  fill: FILL,
  line: LINE,
  circle: CIRCLE,
  symbol: SYMBOL,
  heatmap: HEATMAP,
  'fill-extrusion': FILL_EXTRUSION,
  raster: RASTER,
  hillshade: HILLSHADE,
  background: BACKGROUND,
}

/**
 * Section order per layer type. The catalogue above is keyed by section, this
 * decides what order they appear in and which ones exist at all.
 */
export const LAYER_SECTIONS: Record<StyleLayerKind, readonly string[]> = {
  fill: ['fill', 'position'],
  line: ['stroke', 'shape', 'position'],
  circle: ['circle', 'stroke', 'position'],
  symbol: ['icon', 'text', 'placement', 'position'],
  heatmap: ['heatmap'],
  'fill-extrusion': ['extrusion', 'position'],
  raster: ['raster'],
  hillshade: ['hillshade'],
  background: ['background'],
}

/** Properties of one layer type in one section, in catalogue order. */
export function sectionProperties(
  kind: StyleLayerKind,
  section: string,
  engine?: MapEngine,
): StyleProperty[] {
  return LAYER_PROPERTIES[kind].filter(
    p =>
      p.section === section &&
      (!engine || !p.engines || p.engines.includes(engine)),
  )
}

const PROPERTY_INDEX: Record<string, StyleProperty> = Object.fromEntries(
  Object.values(LAYER_PROPERTIES)
    .flat()
    .map(p => [p.key, p]),
)

export function findProperty(key: string): StyleProperty | undefined {
  return PROPERTY_INDEX[key]
}

// ── Values ───────────────────────────────────────────────────────────────────

/**
 * True when a value is a style expression or a legacy stop function rather
 * than a plain literal. Those can't be driven by a colour swatch or a slider,
 * so the editor shows them read-only with a JSON escape hatch.
 *
 * `['literal', …]` is the one array-headed form that IS a plain value, and
 * property values that are legitimately arrays (dash patterns, offsets) are
 * all numeric, so a string head is the discriminator.
 */
export function isExpression(value: unknown): boolean {
  if (Array.isArray(value)) return typeof value[0] === 'string'
  if (value && typeof value === 'object') return 'stops' in (value as object)
  return false
}

/** Whether a control can edit this value directly. */
export function isEditableValue(value: unknown): boolean {
  return value === undefined || !isExpression(value)
}
