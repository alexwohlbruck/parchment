/**
 * The sun's shadow map as the custom layers read it: the map itself is drawn
 * by MapLibre's shading (`Map.setShading`), from the buildings and from every
 * `ShadowCaster`, and handed to each of them a frame at a time.
 *
 * Mercator in, clip out: x and y in 0-1 world units and z in mercator units
 * (metres times `perMetre`), the frame MapLibre's main matrix and the
 * landmarks' `anchorMatrix` already use.
 */
import type { GroundOcclusion, SunFrame } from 'maplibre-gl'

export type { GroundOcclusion, SunFrame }
export type Mat4 = Float64Array

/** The texture units the sun's map and the ground occlusion are bound to while receivers draw. */
export const SUN_SHADOW_UNIT = 5
export const OCCLUSION_UNIT = 6

/** Column-major a × b. */
export function multiply(a: ArrayLike<number>, b: ArrayLike<number>): Mat4 {
  const out = new Float64Array(16)
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++)
      out[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3]
  return out
}

/**
 * `sunShade(p)`: 0 lit to 1 in the sun's shadow, for a point in the light's
 * clip space, scaled by the frame's `strength`. Four hardware-filtered taps,
 * as the engine's own receivers take, so a mesh and the ground beside it agree.
 */
export const SUN_SHADOW_GLSL = `
  uniform highp sampler2DShadow u_sunShadow;
  uniform float u_sunOn; // the frame's strength, 0 with no sun
  uniform float u_sunTexel;
  uniform float u_sunBias; // depth of a texel
  float sunShade(vec4 p, float slope) {
    if (u_sunOn <= 0.0) return 0.0;
    vec3 c = p.xyz / p.w * 0.5 + 0.5;
    vec2 edge = abs(c.xy * 2.0 - 1.0);
    float reach = max(edge.x, edge.y);
    if (reach >= 1.0 || c.z > 1.0) return 0.0;
    float z = c.z - (0.5 + 1.0 * min(slope, 4.0)) * u_sunBias;
    float d = 0.75 * u_sunTexel;
    // Lod, not plain texture: callers sample inside a per-fragment branch.
    float lit = textureLod(u_sunShadow, vec3(c.xy + vec2(-d, -d), z), 0.0)
      + textureLod(u_sunShadow, vec3(c.xy + vec2(d, -d), z), 0.0)
      + textureLod(u_sunShadow, vec3(c.xy + vec2(-d, d), z), 0.0)
      + textureLod(u_sunShadow, vec3(c.xy + vec2(d, d), z), 0.0);
    return u_sunOn * (1.0 - lit * 0.25) * (1.0 - smoothstep(0.9, 1.0, reach));
  }
`

/** A mercator matrix — the sun's light, the occlusion's texture coordinates — taken to a mesh's own frame about `origin`; composed in double precision so the mesh keeps its float precision. */
export function lightAbout(light: Mat4, origin: [number, number, number?]): Float32Array {
  const out = new Float32Array(light)
  const [x, y, z = 0] = origin
  // A translation only moves the last column; the rest of the product is `light` itself.
  for (let r = 0; r < 4; r++) out[12 + r] = light[r] * x + light[4 + r] * y + light[8 + r] * z + light[12 + r]
  return out
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
  gl.uniform1f(u.u_sunOn, frame ? frame.strength : 0)
  gl.uniform1f(u.u_sunTexel, frame ? 1 / frame.size : 0)
  gl.uniform1f(u.u_sunBias, frame ? frame.depthPerMetre * frame.texelMetres : 0)
  gl.uniform1i(u.u_sunShadow, SUN_SHADOW_UNIT)
  gl.activeTexture(gl.TEXTURE0 + SUN_SHADOW_UNIT)
  gl.bindTexture(gl.TEXTURE_2D, frame ? frame.texture : emptySunTexture(gl))
  gl.activeTexture(gl.TEXTURE0)
}

/**
 * `groundOcclusion(uv)`: how much the buildings and trees round a point of the
 * ground close it in, 0 to the frame's strength, as the engine darkens the
 * ground itself; for a surface lying on it.
 */
export const GROUND_OCCLUSION_GLSL = `
  uniform sampler2D u_occlusionMap;
  uniform vec2 u_occlusionStrength; // strength, 0 with none, and the power that narrows its reach
  float groundOcclusion(vec2 uv) {
    if (u_occlusionStrength.x <= 0.0) return 0.0;
    vec2 edge = abs(uv * 2.0 - 1.0);
    float reach = max(edge.x, edge.y);
    if (reach >= 1.0) return 0.0;
    float near = clamp(2.0 * textureLod(u_occlusionMap, uv, 0.0).r, 0.0, 1.0);
    return u_occlusionStrength.x * pow(near, u_occlusionStrength.y) * (1.0 - smoothstep(0.8, 1.0, reach));
  }
`

export const GROUND_OCCLUSION_UNIFORMS = ['u_occlusionMap', 'u_occlusionStrength'] as const

const clears = new WeakMap<WebGL2RenderingContext, WebGLTexture>()

/** A clear 1×1 texture for the occlusion's sampler while there is none. */
function clearTexture(gl: WebGL2RenderingContext): WebGLTexture {
  let t = clears.get(gl)
  if (t) return t
  t = gl.createTexture()!
  gl.bindTexture(gl.TEXTURE_2D, t)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4))
  clears.set(gl, t)
  return t
}

/** Point the receiver's sampler at this frame's ground occlusion, or at nothing. */
export function bindOcclusion(gl: WebGL2RenderingContext, u: Record<string, WebGLUniformLocation | null>, occlusion: GroundOcclusion | null) {
  gl.uniform2f(u.u_occlusionStrength, occlusion?.strength ?? 0, occlusion?.power ?? 1)
  gl.uniform1i(u.u_occlusionMap, OCCLUSION_UNIT)
  gl.activeTexture(gl.TEXTURE0 + OCCLUSION_UNIT)
  gl.bindTexture(gl.TEXTURE_2D, occlusion ? occlusion.texture : clearTexture(gl))
  gl.activeTexture(gl.TEXTURE0)
}
