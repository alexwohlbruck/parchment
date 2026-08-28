/**
 * The shade layer's terrain patch.
 *
 * `vendor/ao-shadow.mjs` is deliberately kept close to upstream so it stays
 * updatable, which makes a re-vendor the likely way this gets lost. It cannot
 * be exercised without a GL context, and it fails in the worst way: the layer
 * *replaces* MapLibre's own extrusion draw, so buildings blind to the DEM are
 * drawn at sea level and any ground above it swallows them whole — over a hill
 * the whole skyline vanishes and only its shadows remain.
 *
 * So these read the source. Crude, but they pin the three things that make the
 * patch work, each of which is silent when absent.
 */
import { describe, test, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const source = readFileSync(resolve(__dirname, 'vendor/ao-shadow.mjs'), 'utf8')

describe('terrain-aware building shade', () => {
  test('every geometry pass samples the DEM', () => {
    // The buildings, the cast shadow and the occlusion seed all project the
    // same footprints; one of them left at zero puts that pass out of register
    // with the other two.
    expect(source.match(/get_elevation\(a_centroid\)/g)?.length).toBeGreaterThanOrEqual(3)
  })

  test('the centroid attribute is bound from MapLibre\'s own buffer', () => {
    // MapLibre samples elevation once per footprint, at its centroid, and
    // builds the buffer for it whether or not terrain is on.
    expect(source).toContain('a_centroid')
    expect(source).toContain('bucket.centroidVertexBuffer')
    // A location of its own — the shared VAO pins every attribute by index.
    expect(/a_centroid:\s*(\d+)/.exec(source)?.[1]).toBeTruthy()
  })

  test('terrain is switched off rather than assumed', () => {
    // With no terrain there is no DEM texture to sample, and sampling an unbound
    // one is undefined rather than zero.
    expect(source).toContain('u_terrain_on')
    expect(source).toContain('if (u_terrain_on < 0.5) return 0.0;')
  })

  /**
   * Terrain gave the buildings something to lose a depth fight against.
   *
   * MapLibre pins `nearZ` at `height / 50` while `farZ` follows the camera, so
   * the narrow field of view that fakes an orthographic plan view takes the
   * far-to-near ratio from ~84 to ~5800 — and at that precision a building's
   * base and the terrain mesh under it land on the same depth value. The
   * buildings shattered into a flickering mosaic of slivers, top-down only.
   *
   * Top-down only is the point. Everywhere else the building must *lose* to
   * the ground, which is what buries the basement below — so the bias is gated
   * on the same flat-on view that needs it, and carries no slope term, which
   * would grow with the tilt and lift the buildings out of the ground exactly
   * when the camera can see under them.
   */
  test('buildings are biased in front of the ground, in the plan view only', () => {
    expect(source).toContain('POLYGON_OFFSET_FILL')
    const [, factor, units] = /polygonOffset\((-?[\d.]+),\s*(-?[\d.]+)\)/.exec(source) ?? []
    // No slope term: it is multiplied by the polygon's depth slope, which for a
    // wall seen near edge-on is enormous.
    expect(Number(factor)).toBe(0)
    // Negative, or the bias pushes them the wrong way and makes it worse.
    expect(Number(units)).toBeLessThan(0)
    // Gated on the flat-on view rather than applied to every frame.
    expect(source).toContain('const planView =')
    expect(source).toMatch(/if \(planView\) \{\s*\n\s*gl\.enable\(gl\.POLYGON_OFFSET_FILL\)/)
    // And put back afterwards — it is global GL state, and MapLibre draws
    // every other layer through the same context.
    expect(source).toContain('gl.disable(gl.POLYGON_OFFSET_FILL)')
  })

  /**
   * The basement is a hole for the ground to fill.
   *
   * MapLibre drops a building's floor 10m below the terrain so one on a slope
   * does not hang in the air on its low side, and gets away with it because the
   * terrain mesh is right there to bury it — the whole block is compiled behind
   * `#ifdef TERRAIN3D`. Ported without that guard it is dug on a flat map too,
   * where nothing writes depth underneath and the 10m is simply drawn: every
   * building 10m too tall, standing in a wall that starts below its footprint.
   */
  test('the basement is only dug where there is ground to bury it', () => {
    const basement = /float basement = ([^;]+);/.exec(source)?.[1] ?? ''
    expect(basement).toBeTruthy()
    expect(basement).toContain('u_terrain_on')
    expect(basement).toContain('10.0')
  })

  test('the elevation lookup is ESSL1, matching the shaders around it', () => {
    // MapLibre's own prelude uses `texelFetch`/`textureSize`, which are ESSL3
    // only; these shaders are GLSL ES 1.00 and would fail to compile.
    const terrain = /const TERRAIN = `([\s\S]*?)`;/.exec(source)?.[1] ?? ''
    expect(terrain).toBeTruthy()
    expect(terrain).not.toContain('texelFetch')
    expect(terrain).not.toContain('textureSize')
    expect(terrain).toContain('texture2DLod')
  })
})
