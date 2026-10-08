/**
 * The 3D object scene: what is drawn, from which models, in which colours.
 *
 * One place to add the next object type. A new one needs three things — a tile
 * source (barrelman's `create-detail-views.sql`), a `.glb` whose materials are
 * named by role, and a spec saying how a feature becomes an instance — and then
 * it is listed here.
 */
import type { FlavorId } from '@/lib/map-style/build'
import { type ObjectPalette, type ObjectSourceSpec } from './object-layer'
import models from './models.json'
import { TREE_MODELS, TREE_OBJECTS, TREE_ROW_OBJECTS } from './trees'
import { FURNITURE_MODELS, FURNITURE_OBJECTS } from './furniture'
import { FOREST_OBJECTS } from './forest'

export const OBJECT_SPECS: ObjectSourceSpec[] = [
  TREE_OBJECTS,
  TREE_ROW_OBJECTS,
  FURNITURE_OBJECTS,
  FOREST_OBJECTS,
]

/**
 * Every model file, from the manifest the build writes.
 *
 * Read rather than derived: not every model earns a far variant — a
 * 24-triangle bin is already cheaper than any proxy of it — and asking for one
 * that was skipped is a 404 that takes the whole layer down with it.
 */
export const OBJECT_MODELS: Record<string, string> = Object.fromEntries(
  Object.keys(models).map(name => [name, `/models/${name}.glb`]),
)

/**
 * Which models are solids, and may therefore be drawn with back faces culled.
 *
 * Culling is what stops a crown shattering in the plan view, where the depth
 * buffer cannot separate its front from its back — but it is only safe on a
 * mesh with an inside. Four of the vendored trees are not: their fronds and
 * skirts share edges between three and four triangles at a time, which has no
 * consistent inside, so they are drawn double-sided. They are also single
 * layers of geometry, so there is nothing there for the depth buffer to get
 * wrong. The build script works this out per model; see `isSolid`.
 */
export const OBJECT_SOLID: Record<string, boolean> = models

/** The models a catalogue entry names, for the tests to check against. */
export const CATALOGUE_MODELS = { ...TREE_MODELS, ...FURNITURE_MODELS }

/**
 * Role colours, per flavor.
 *
 * An object has to belong to the ground it stands on. The same green that
 * reads as a tree against pale daylight land reads as a hole cut in the night
 * map, so the dark flavor takes everything down — less saturated and several
 * steps darker, the way real foliage looks under a streetlight rather than the
 * way it looks at noon. The layer resolves them per draw rather than baking them
 * in: switching theme is a uniform, not a reload.
 *
 * Colours are plain sRGB triples, written straight to the screen: nothing in
 * the pipeline linearises them. Foliage carries an `-alt`, the bluer green an
 * instance moves toward with its `tint`, so a street of trees varies in hue
 * and not only in value. The shader darkens a crown's underside on top of this,
 * so the named colour is roughly what the sunlit top of a tree reads as.
 */
export const OBJECT_PALETTE: Record<FlavorId, ObjectPalette> = {
  light: {
    bark: [0.56, 0.45, 0.36],
    // A palm's trunk is grey, not brown: ringed, fibrous, and pale as concrete
    // on a royal palm.
    'palm-bark': [0.62, 0.58, 0.52],
    foliage: [0.66, 0.83, 0.5],
    'foliage-alt': [0.55, 0.77, 0.52],
    metal: [0.3, 0.36, 0.33],
    wood: [0.62, 0.47, 0.31],
    paint: [0.22, 0.47, 0.36],
    interior: [0.16, 0.18, 0.17],
    bench: [0.88, 0.8, 0.68],
    bin: [0.35, 0.37, 0.4],
    recycling: [0.22, 0.36, 0.56],
    stone: [0.8, 0.78, 0.74],
    water: [0.55, 0.72, 0.82],
    lamp: [1, 0.95, 0.82],
    panel: [0.95, 0.94, 0.91],
  },
  dark: {
    bark: [0.17, 0.14, 0.12],
    'palm-bark': [0.2, 0.19, 0.17],
    foliage: [0.17, 0.3, 0.17],
    'foliage-alt': [0.12, 0.25, 0.18],
    metal: [0.2, 0.23, 0.26],
    wood: [0.24, 0.18, 0.13],
    paint: [0.12, 0.23, 0.17],
    interior: [0.06, 0.07, 0.07],
    bench: [0.36, 0.32, 0.27],
    bin: [0.16, 0.17, 0.19],
    recycling: [0.1, 0.16, 0.26],
    stone: [0.3, 0.3, 0.29],
    water: [0.13, 0.2, 0.26],
    lamp: [1, 0.86, 0.58],
    panel: [0.42, 0.42, 0.4],
  },
}

export { ObjectLayer } from './object-layer'
export type { ObjectInstance, ObjectSourceSpec, ObjectPalette } from './object-layer'
