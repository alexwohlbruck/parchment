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
  (models as string[]).map(name => [name, `/models/${name}.glb`]),
)

/** The models a catalogue entry names, for the tests to check against. */
export const CATALOGUE_MODELS = { ...TREE_MODELS, ...FURNITURE_MODELS }

/**
 * Role colours, per flavor.
 *
 * An object has to belong to the ground it stands on. The same green that
 * reads as a tree against pale daylight land reads as a hole cut in the night
 * map, so the dark flavor takes everything down — less saturated and several
 * steps darker, the way real foliage looks under a streetlight rather than the
 * way it looks at noon. These are linear RGB, matching the models' own
 * `baseColorFactor`, and the layer resolves them per draw rather than baking
 * them in: switching theme is a uniform, not a reload.
 */
export const OBJECT_PALETTE: Record<FlavorId, ObjectPalette> = {
  light: {
    bark: [0.38, 0.29, 0.23],
    foliage: [0.34, 0.55, 0.28],
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

/**
 * The contact shadow, per flavor.
 *
 * Daylight throws one; at night there is no sun, so it fades to almost nothing
 * and only enough is left to keep an object from floating.
 */
export const OBJECT_SHADOW: Record<FlavorId, [number, number, number, number]> = {
  light: [0, 0, 0, 0.3],
  dark: [0, 0, 0, 0.14],
}

export { ObjectLayer } from './object-layer'
export type { ObjectInstance, ObjectSourceSpec, ObjectPalette } from './object-layer'
