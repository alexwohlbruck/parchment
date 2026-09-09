/**
 * How the next mark will be drawn.
 *
 * Each tool carries its own settings — the colour a pin gets is not the
 * colour a polygon gets — and they are the same fields a finished mark
 * stores, so picking a mark up and putting its style on the toolbar is a
 * copy rather than a translation.
 *
 * Only what has actually been set is kept. Everything else falls through to
 * `ANNOTATION_STYLE_DEFAULTS` at render time, which is what keeps a mark you
 * never styled as small in the document as the day it was made.
 */

import type {
  AnnotationTool,
  CanvasAnnotation,
  CanvasTool,
} from '@/types/canvas.types'

/** The style fields a new mark can inherit from the toolbar. */
export type DrawStyle = Partial<
  Pick<
    CanvasAnnotation,
    | 'color'
    | 'strokeWidth'
    | 'strokeOpacity'
    | 'strokeStyle'
    | 'strokeCap'
    | 'fillColor'
    | 'fillOpacity'
    | 'markerSize'
    | 'markerShape'
    | 'icon'
  >
>

export type DrawOption = keyof DrawStyle

const STROKE: DrawOption[] = [
  'color',
  'strokeWidth',
  'strokeStyle',
  'strokeOpacity',
]

/** An open shape has two ends to finish; a ring has none. */
const OUTLINE: DrawOption[] = [...STROKE, 'strokeCap']

const AREA: DrawOption[] = [...STROKE, 'fillColor', 'fillOpacity']

/**
 * What each tool can be styled with, and in the order it should be offered.
 *
 * One table, three jobs: which controls the tool options bar shows, which
 * fields a new mark is given, and which rows a finished mark's own style
 * editor offers. A line has no fill and a pin has no outline, and there is
 * only one place that says so.
 */
export const TOOL_STYLE_OPTIONS: Record<CanvasTool, DrawOption[]> = {
  pin: ['color', 'icon', 'markerShape', 'markerSize'],
  // The eraser draws nothing, so there is nothing to set for it — and an
  // empty list is what keeps its options row off the toolbar.
  erase: [],
  line: OUTLINE,
  route: OUTLINE,
  doodle: OUTLINE,
  polygon: AREA,
  rectangle: AREA,
  circle: AREA,
  isochrone: AREA,
}

/**
 * The range each numeric setting is offered over, and how it reads.
 *
 * A mark can be styled in two places — the tool options bar, for the next
 * one, and a finished mark's own editor — and they were each carrying their
 * own idea of how thick a stroke can get. One table, so they cannot drift.
 *
 * The opacities are held as percentages, which is what both controls show
 * and what neither wants to convert twice.
 */
export const STYLE_RANGES = {
  strokeWidth: { min: 1, max: 24, step: 1 },
  strokeOpacity: { min: 0, max: 100, step: 5 },
  fillOpacity: { min: 0, max: 100, step: 5 },
  markerSize: { min: 4, max: 20, step: 0.5 },
  labelSize: { min: 8, max: 32, step: 1 },
} as const

/** An opacity as it is shown beside the control that sets it. */
export function percentLabel(value: number): string {
  return `${Math.round(value * 100)}%`
}

/** Whether a tool is styled by this setting at all. */
export function hasStyleOption(
  tool: CanvasTool,
  option: DrawOption,
): boolean {
  return TOOL_STYLE_OPTIONS[tool].includes(option)
}

/**
 * The part of a style that means something for a tool, and was actually set.
 *
 * Both halves matter: a pin must never be given a fill opacity it cannot
 * draw, and a field nobody chose must not be written just because a control
 * displayed its default.
 */
export function drawStylePatch(
  tool: AnnotationTool,
  style: DrawStyle,
): DrawStyle {
  const patch: DrawStyle = {}
  for (const option of TOOL_STYLE_OPTIONS[tool]) {
    const value = style[option]
    if (value !== undefined) Object.assign(patch, { [option]: value })
  }
  return patch
}

/** Every tool's settings. Absent means nothing has been chosen for it yet. */
export type DrawStyles = Partial<Record<AnnotationTool, DrawStyle>>

/**
 * Take a mark's style onto the toolbar, so the next one of its kind matches
 * it. A replacement rather than a merge: what you selected is what you get,
 * and a setting the mark never had should read as unset here too.
 */
export function adoptStyle(
  styles: DrawStyles,
  annotation: CanvasAnnotation,
): DrawStyles {
  return {
    ...styles,
    [annotation.tool]: drawStylePatch(annotation.tool, annotation),
  }
}
