/**
 * A shadow map from the sun, so buildings and landmarks shade each other and
 * not only the ground. Rendered by the building shade layer each time the view
 * or the sun moves, read by every receiver; see `vendor/ao-shadow.mjs`.
 *
 * Everything here is mercator in, clip out: x and y in 0-1 world units and z
 * in mercator units (metres times `perMetre`), the frame MapLibre's main
 * matrix and the landmarks' `anchorMatrix` already use.
 */

export type Mat4 = Float64Array

/** Texels on a side. One map covers the whole view, so this sets the shadow's sharpness. */
export const SUN_SHADOW_SIZE = 2048

/** The texture unit the map is bound to while receivers draw. */
export const SUN_SHADOW_UNIT = 5

/** Column-major a × b. */
export function multiply(a: ArrayLike<number>, b: ArrayLike<number>): Mat4 {
  const out = new Float64Array(16)
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++)
      out[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3]
  return out
}

/** A vector tile's own units (8192 a side, z in metres) to mercator. */
export function tileToMercator(z: number, x: number, y: number, wrap: number, perMetre: number): Mat4 {
  const s = 1 / (8192 * 2 ** z)
  return new Float64Array([s, 0, 0, 0, 0, s, 0, 0, 0, 0, perMetre, 0, (x + wrap * 2 ** z) / 2 ** z, y / 2 ** z, 0, 1])
}

const cross = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const norm = (a: number[]) => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1
  return [a[0] / l, a[1] / l, a[2] / l]
}

export type SunView = {
  /** The view's centre, mercator. */
  center: [number, number]
  perMetre: number
  /** The visible ground's corners, mercator; pulled in to `radius` of the centre. */
  corners: Array<[number, number]>
  /** Metres from the centre the map reaches; the farther ground goes unshadowed. */
  radius: number
  /** Which way the light travels, east, north, up: down and away from the sun. */
  toward: [number, number, number]
  /** The ground's height at the centre, metres, with terrain on. */
  floor: number
  /** The tallest caster, metres above the floor; the map's depth range runs this far up. */
  ceiling: number
}

/**
 * The sun's view of the ground in sight: an orthographic box down the light,
 * as tight around the visible ground and everything standing on it as the
 * light direction allows.
 */
export function sunLightMatrix(view: SunView): { light: Mat4; depthPerMetre: number; texelMetres: number } {
  const { center, perMetre, radius, ceiling, floor } = view
  const f = norm(view.toward)
  const r = norm(Math.abs(f[2]) > 0.999 ? [1, 0, 0] : cross(f, [0, 0, 1]))
  const u = cross(r, f)

  // Ground corners in metres east and north of the centre, clamped to the radius.
  const ground = view.corners.map(([x, y]) => {
    let e = (x - center[0]) / perMetre
    let n = -(y - center[1]) / perMetre
    const d = Math.hypot(e, n)
    if (d > radius) [e, n] = [(e * radius) / d, (n * radius) / d]
    return [e, n]
  })
  const lo = [Infinity, Infinity, Infinity]
  const hi = [-Infinity, -Infinity, -Infinity]
  // Terrain dips below the centre's ground as well as rising above it.
  for (const [e, n] of ground) for (const h of [floor - ceiling * 0.25, floor + ceiling]) {
    const p = [e, n, h]
    const l = [p[0] * r[0] + p[1] * r[1] + p[2] * r[2], p[0] * u[0] + p[1] * u[1] + p[2] * u[2], p[0] * f[0] + p[1] * f[1] + p[2] * f[2]]
    for (let i = 0; i < 3; i++) {
      lo[i] = Math.min(lo[i], l[i])
      hi[i] = Math.max(hi[i], l[i])
    }
  }
  // Casters just outside the view still throw shadow into it.
  const pad = ceiling
  lo[2] -= pad
  const sx = 2 / (hi[0] - lo[0]), sy = 2 / (hi[1] - lo[1]), sz = 2 / (hi[2] - lo[2])
  // Rows of light-clip ← metric (east, north, up).
  const rows = [
    [r[0] * sx, r[1] * sx, r[2] * sx, -lo[0] * sx - 1],
    [u[0] * sy, u[1] * sy, u[2] * sy, -lo[1] * sy - 1],
    [f[0] * sz, f[1] * sz, f[2] * sz, -lo[2] * sz - 1],
    [0, 0, 0, 1],
  ]
  // Metric ← mercator: east = (x - cx) / pm, north = -(y - cy) / pm, up = z / pm.
  const k = 1 / perMetre
  const metric = new Float64Array([k, 0, 0, 0, 0, -k, 0, 0, 0, 0, k, 0, -center[0] * k, center[1] * k, 0, 1])
  const light = new Float64Array(16)
  for (let c = 0; c < 4; c++) for (let row = 0; row < 4; row++) light[c * 4 + row] = rows[row][c]
  return { light: multiply(light, metric), depthPerMetre: 1 / (hi[2] - lo[2]), texelMetres: Math.max(hi[0] - lo[0], hi[1] - lo[1]) / SUN_SHADOW_SIZE }
}

/**
 * `sunShade(p)`: 0 lit to 1 in the sun's shadow, for a point in the light's
 * clip space. Four hardware-filtered taps, so a soft 3-texel edge.
 */
export const SUN_SHADOW_GLSL = `
  uniform highp sampler2DShadow u_sunShadow;
  uniform float u_sunOn;
  uniform float u_sunTexel;
  uniform float u_sunBias; // depth per metre
  bool sunCovers(vec4 p) {
    vec3 c = p.xyz / p.w * 0.5 + 0.5;
    return u_sunOn > 0.5 && all(greaterThanEqual(c.xy, vec2(0.0))) && all(lessThanEqual(c.xy, vec2(1.0))) && c.z <= 1.0;
  }
  float sunShade(vec4 p, float slope) {
    if (!sunCovers(p)) return 0.0;
    vec3 c = p.xyz / p.w * 0.5 + 0.5;
    float z = c.z - (0.4 + 1.2 * min(slope, 4.0)) * u_sunBias;
    float t = 0.75 * u_sunTexel;
    // Lod, not plain texture: callers sample inside a per-fragment branch.
    float lit = textureLod(u_sunShadow, vec3(c.xy + vec2(-t, -t), z), 0.0) + textureLod(u_sunShadow, vec3(c.xy + vec2(t, -t), z), 0.0)
              + textureLod(u_sunShadow, vec3(c.xy + vec2(-t, t), z), 0.0) + textureLod(u_sunShadow, vec3(c.xy + vec2(t, t), z), 0.0);
    return 1.0 - lit * 0.25;
  }
`

/** Light-clip ← a mesh's own frame, mercator about `origin`; composed in double precision so the mesh keeps its float precision. */
export function lightAbout(light: Mat4, origin: [number, number, number?]): Float32Array {
  return Float32Array.from(multiply(light, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, origin[0], origin[1], origin[2] ?? 0, 1]))
}

/** What a caster and a receiver need of the map for one frame. */
export type SunFrame = {
  /** Clip ← mercator, for the sun's view. */
  light: Mat4
  perMetre: number
  texture: WebGLTexture
  depthPerMetre: number
  /** Metres a texel spans across the light, its longer side. */
  texelMetres: number
}

export const SUN_SHADOW_UNIFORMS = ['u_sunShadow', 'u_sunOn', 'u_sunTexel', 'u_sunBias'] as const

const empties = new WeakMap<WebGL2RenderingContext, WebGLTexture>()

/** A 1×1 depth texture for the shadow sampler while there is no sun: a shadow sampler must never see a colour texture. */
function emptySunTexture(gl: WebGL2RenderingContext): WebGLTexture {
  let t = empties.get(gl)
  if (t) return t
  t = gl.createTexture()!
  gl.bindTexture(gl.TEXTURE_2D, t)
  gl.texStorage2D(gl.TEXTURE_2D, 1, gl.DEPTH_COMPONENT24, 1, 1)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE)
  empties.set(gl, t)
  return t
}

/** Point the receiver's sampler at this frame's map, or at nothing. */
export function bindSun(gl: WebGL2RenderingContext, u: Record<string, WebGLUniformLocation | null>, frame: SunFrame | null) {
  gl.uniform1f(u.u_sunOn, frame ? 1 : 0)
  gl.uniform1f(u.u_sunTexel, 1 / SUN_SHADOW_SIZE)
  gl.uniform1f(u.u_sunBias, frame?.depthPerMetre ?? 0)
  gl.uniform1i(u.u_sunShadow, SUN_SHADOW_UNIT)
  gl.activeTexture(gl.TEXTURE0 + SUN_SHADOW_UNIT)
  gl.bindTexture(gl.TEXTURE_2D, frame ? frame.texture : emptySunTexture(gl))
  gl.activeTexture(gl.TEXTURE0)
}
