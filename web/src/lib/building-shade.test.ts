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
   */
  test('buildings are biased in front of the ground they stand on', () => {
    expect(source).toContain('POLYGON_OFFSET_FILL')
    // Negative, or the bias pushes them the wrong way and makes it worse.
    const [, factor, units] = /polygonOffset\((-?[\d.]+),\s*(-?[\d.]+)\)/.exec(source) ?? []
    expect(Number(factor)).toBeLessThan(0)
    expect(Number(units)).toBeLessThan(0)
    // And put back afterwards — it is global GL state, and MapLibre draws
    // every other layer through the same context.
    expect(source).toContain('gl.disable(gl.POLYGON_OFFSET_FILL)')
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
