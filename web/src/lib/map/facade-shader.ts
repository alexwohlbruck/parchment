/**
 * Procedural facades — window grids, spandrels, lit windows — generated per
 * fragment and box-filtered analytically, so no textures and no shimmer.
 * Shared by the extrusions (`vendor/ao-shadow.mjs`) and the landmarks.
 */

/** A 0-1 hash of a 2D point; keep inputs small (under ~1e4) for mobile precision. */
export const FACADE_HASH_GLSL = `
  float facadeHash(vec2 p) {
    vec3 q = fract(vec3(p.xyx) * 0.1031);
    q += dot(q, q.yzx + 33.33);
    return fract((q.x + q.y) * q.z);
  }
`

/**
 * `facade(along, up, height, seed)`, in metres along the wall, metres up and
 * roof height, gives x glass coverage, y share of it lit at night, z a 0-1
 * per-building variation. GLSL ES 3.00: the filter needs `fwidth`.
 */
export const FACADE_GLSL = `
  ${FACADE_HASH_GLSL}

  // Integral of a pulse train with one window of width d centred in each unit cell.
  float facadePulseInt(float x, float d) {
    return floor(x) * d + clamp(fract(x) - 0.5 * (1.0 - d), 0.0, d);
  }

  // Share of [x - w/2, x + w/2] covered by windows: exact box filter of the train.
  float facadePulse(float x, float d, float w) {
    w = max(w, 1e-4);
    return (facadePulseInt(x + 0.5 * w, d) - facadePulseInt(x - 0.5 * w, d)) / w;
  }

  vec3 facade(float along, float up, float height, float seed) {
    if (height < 3.5) return vec3(0.0);
    float levels = max(1.0, floor(height / 3.7 + 0.35));
    float storey = height / levels;
    float s1 = fract(seed * 7.13), s2 = fract(seed * 3.71), s3 = fract(seed * 5.37);

    // Towers are mostly curtain wall; the rest a punched grid varying by building.
    float curtain = step(36.0, height) * step(0.4, s1);
    float bay = mix(mix(2.6, 3.8, s2), 1.6, curtain);
    float dx = mix(mix(0.42, 0.68, s3), 0.9, curtain);
    float dy = mix(mix(0.4, 0.52, s2), 0.55, curtain);

    float x = along / bay;
    // Raised a little off the floor slab, as windows sit on a sill.
    float y = up / storey - 0.06;
    float wx = fwidth(x), wy = fwidth(y);
    float share = mix(0.14, 0.42, s3);
    if (min(wx, wy) > 1.5) return vec3(dx * dy, share * 0.9, s1);

    // Columns too fine to resolve become one band per floor of the same average glass.
    float far = smoothstep(0.3, 0.8, wx);
    float glass = mix(facadePulse(x, dx, wx), 1.0, far) * facadePulse(y, dy * mix(1.0, dx, far), wy);
    // A parapet above the top floor, and no windows below the ground.
    float parapet = 0.9 / storey;
    float top = levels - parapet - 0.06;
    glass *= clamp((top - y) / max(wy, 1e-4) + 0.5, 0.0, 1.0);
    glass *= clamp(y / max(wy, 1e-4) + 0.5, 0.0, 1.0);

    // Whole floors share a mood, and windows vary within it.
    vec2 cell = vec2(floor(x), floor(y));
    float floorOn = step(0.3, facadeHash(vec2(cell.y, seed * 517.0)));
    float lit = step(facadeHash(cell + seed * 997.0), share * (0.4 + 1.2 * floorOn));
    // Ground floors are shopfronts and lobbies, and stay lit.
    lit = max(lit, step(cell.y, 0.5) * step(8.0, height));
    // Past a window per pixel, the average of the pattern rather than a coin flip.
    lit = mix(lit, share * 0.9, smoothstep(0.35, 0.9, max(wx, wy)));
    return vec3(glass, lit, s1);
  }
`

/** Glass a little darker and cooler than its wall by day; unlit glass dark and lit glass warm at night. */
export const FACADE_SHADE_GLSL = `
  uniform vec3 u_glass;
  uniform float u_glassMix;
  uniform float u_night;
  uniform vec3 u_windowLight;
  uniform float u_windowGlow;

  vec3 facadeShade(vec3 wall, vec3 f) {
    vec3 glassColor = mix(wall, u_glass * (0.55 + 0.6 * dot(wall, vec3(0.2126, 0.7152, 0.0722))), u_glassMix);
    vec3 warm = mix(u_windowLight, vec3(0.92, 0.93, 0.9), f.z * 0.6);
    vec3 lit = mix(glassColor, warm * u_windowGlow, f.y * u_night);
    return mix(wall, lit, f.x);
  }
`

type Rgb = [number, number, number]

/** A flavor's facade colours, sRGB 0-1; `night` 1 lights the windows. */
export type FacadeFlavor = { glass: Rgb; glassMix: number; night: number; windowLight: Rgb; windowGlow: number }

export const FACADE_FLAVOR: Record<'light' | 'dark', FacadeFlavor> = {
  light: { glass: [0.58, 0.7, 0.84], glassMix: 0.7, night: 0, windowLight: [1, 0.8, 0.5], windowGlow: 1 },
  dark: { glass: [0.12, 0.16, 0.24], glassMix: 0.7, night: 1, windowLight: [1, 0.78, 0.48], windowGlow: 0.95 },
}

export const FACADE_UNIFORMS = ['u_glass', 'u_glassMix', 'u_night', 'u_windowLight', 'u_windowGlow'] as const

export function setFacadeUniforms(
  gl: WebGL2RenderingContext,
  u: Record<string, WebGLUniformLocation | null>,
  f: FacadeFlavor,
) {
  gl.uniform3fv(u.u_glass, f.glass)
  gl.uniform1f(u.u_glassMix, f.glassMix)
  gl.uniform1f(u.u_night, f.night)
  gl.uniform3fv(u.u_windowLight, f.windowLight)
  gl.uniform1f(u.u_windowGlow, f.windowGlow)
}
