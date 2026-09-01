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

export const OBJECT_SPECS: ObjectSourceSpec[] = [
  TREE_OBJECTS,
  TREE_ROW_OBJECTS,
  FURNITURE_OBJECTS,
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
 * Daylight foliage is `#99C07D`, as a plain sRGB triple. The models' own
 * `baseColorFactor` is nominally linear and this comment used to say these were
 * too, but nothing in the pipeline treats them that way: the fragment shader
 * writes the colour straight to `gl_FragColor` and the drawing buffer is not
 * sRGB, so what is written here is what the screen shows. Converting a hex to
 * linear before pasting it in renders the tree several steps too dark.
 *
 * What does move it is the shading — the half-lambert term against ambient, and
 * the instance's own `shade`. A crown seen from above keeps roughly 93-100% of
 * the value below, so the named colour is close to what the top of a tree
 * reads as, and its flanks sit under that.
 */
export const OBJECT_PALETTE: Record<FlavorId, ObjectPalette> = {
  light: {
    bark: [0.55, 0.42, 0.32],
    foliage: [0.6, 0.753, 0.49],
    metal: [0.46, 0.49, 0.51],
    wood: [0.56, 0.42, 0.29],
    paint: [0.24, 0.44, 0.32],
  },
  dark: {
    bark: [0.17, 0.14, 0.12],
    foliage: [0.15, 0.27, 0.16],
    metal: [0.2, 0.23, 0.26],
    wood: [0.24, 0.18, 0.13],
    paint: [0.12, 0.23, 0.17],
  },
}

export { ObjectLayer } from './object-layer'
export type { ObjectInstance, ObjectSourceSpec, ObjectPalette } from './object-layer'
