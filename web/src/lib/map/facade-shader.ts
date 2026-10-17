/**
 * Procedural facades in the calm style of a cartoon city: soft glass bands,
 * a look per kind of building, and at night a minority of buildings lit in a
 * few long stretches. Generated per fragment and box-filtered, so there are no
 * textures and no shimmer. Shared by the extrusions (`vendor/ao-shadow.mjs`)
 * and the landmarks.
 */

/** A 0-1 hash of a 2D point; keep inputs small (under ~1e4) for mobile precision. */
export const FACADE_HASH_GLSL = `
  float facadeHash(vec2 p) {
    vec3 q = fract(vec3(p.xyx) * 0.1031);
    q += dot(q, q.yzx + 33.33);
    return fract((q.x + q.y) * q.z);
  }
`

/** What a building's walls look like; the id the style's donor layer encodes, see `BUILDING_3D_FACADE_LAYER`. */
export const FACADE_STYLE = {
  plain: 0,
  curtain: 1,
  punched: 2,
  shopfront: 3,
  industrial: 4,
  parking: 5,
  house: 6,
} as const

/** The id a building with no known kind is sent as; the shader then guesses from its height. */
export const FACADE_UNKNOWN = 15

/** A style for a building whose kind is not known, from its height and seed. Vertex or fragment. */
export const FACADE_GUESS_GLSL = `
  float facadeGuess(float height, float seed) {
    float r = fract(seed * 13.7);
    if (height < 9.0) return r < 0.6 ? ${FACADE_STYLE.house}.0 : ${FACADE_STYLE.plain}.0;
    if (height < 16.0) return r < 0.5 ? ${FACADE_STYLE.shopfront}.0 : r < 0.85 ? ${FACADE_STYLE.punched}.0 : ${FACADE_STYLE.plain}.0;
    if (height < 45.0) return r < 0.6 ? ${FACADE_STYLE.punched}.0 : r < 0.9 ? ${FACADE_STYLE.curtain}.0 : ${FACADE_STYLE.plain}.0;
    return r < 0.7 ? ${FACADE_STYLE.curtain}.0 : ${FACADE_STYLE.punched}.0;
  }
`

/**
 * `facade(along, up, height, seed, style, lit)` — metres along the wall,
 * metres up, roof height, a 0-1 per-building seed, a `FACADE_STYLE` id, and
 * the share of buildings of that style lit at night (1 forces it) — gives x
 * glass coverage, y share of it lit, z 0 warm to 1 cool light. GLSL ES 3.00.
 */
export const FACADE_GLSL = `
  ${FACADE_HASH_GLSL}
  uniform float u_litScale; // multiplies every style's share of lit buildings

  // Integral of a pulse train with one window of width d centred in each unit cell.
  float facadePulseInt(float x, float d) {
    return floor(x) * d + clamp(fract(x) - 0.5 * (1.0 - d), 0.0, d);
  }

  // Share of [x - w/2, x + w/2] covered by windows: exact box filter of the train.
  float facadePulse(float x, float d, float w) {
    w = max(w, 1e-4);
    return (facadePulseInt(x + 0.5 * w, d) - facadePulseInt(x - 0.5 * w, d)) / w;
  }

  // 1 inside [lo, hi] in units of y, softened over the pixel footprint wy.
  float facadeBetween(float y, float lo, float hi, float wy) {
    return clamp((y - lo) / max(wy, 1e-4) + 0.5, 0.0, 1.0) * clamp((hi - y) / max(wy, 1e-4) + 0.5, 0.0, 1.0);
  }

  vec3 facade(float along, float up, float height, float seed, float style, float litShare) {
    int s = int(style + 0.5);
    if (s == ${FACADE_STYLE.plain} || height < 3.0) return vec3(0.0);
    float storeyM = s == ${FACADE_STYLE.house} ? 3.0 : 3.8;
    float levels = max(1.0, floor(height / storeyM + 0.35));
    float storey = height / levels;
    float y = up / storey;
    float wy = fwidth(y);
    // Under about two pixels a storey: flat average, nothing to shimmer.
    float far = smoothstep(0.35, 0.6, wy);
    float s1 = fract(seed * 7.13), s2 = fract(seed * 3.71);

    float bay = 3.2, dx = 0.5, dy = 0.45, lo = 0.0, hi = levels - 0.3, stretch = 4.0, share = 0.22, cool = 0.0;
    if (s == ${FACADE_STYLE.curtain}) { bay = 1.6; dx = 0.9; dy = 0.52; stretch = 12.0; share = 0.25; cool = 1.0; litShare *= 0.3; }
    else if (s == ${FACADE_STYLE.punched}) { litShare *= 0.35; }
    else if (s == ${FACADE_STYLE.shopfront}) { hi = height > 14.0 ? hi : 1.0; share = 0.9; stretch = 30.0; litShare *= 0.6; }
    else if (s == ${FACADE_STYLE.industrial}) { dy = 0.22; dx = 0.8; bay = 4.0; lo = levels - 1.0; litShare = 0.0; }
    else if (s == ${FACADE_STYLE.parking}) { dy = 0.4; dx = 0.92; bay = 6.0; litShare = 0.0; }
    else { bay = 4.0; dx = 0.3; dy = 0.38; stretch = 1.0; share = 0.5; litShare *= 0.3; }
    float rowY = y - 0.15;
    float rows = mix(facadePulse(rowY, dy, wy), dy, far);
    // A shopfront is one tall pane across the ground storey.
    if (s == ${FACADE_STYLE.shopfront} && y < 1.0) rows = facadeBetween(y, 0.1, 0.85, wy);
    float x = along / bay;
    float wx = fwidth(x);
    // Columns only once a bay is six pixels wide; until then each floor is one band.
    float cols = mix(dx, facadePulse(x, dx, wx), smoothstep(0.25, 0.15, wx));
    float glass = rows * cols * facadeBetween(y, lo, hi, wy);

    // Most buildings stay dark; a lit one has a few floors lit in long stretches.
    float on = step(facadeHash(vec2(seed * 61.0, 3.7)), litShare * u_litScale);
    vec2 cell = vec2(floor(x / stretch + s2 * 5.0), floor(rowY));
    float lit = on * step(facadeHash(cell + seed * 97.0), share * mix(0.6, 1.4, s1));
    lit = mix(lit, on * share, far);
    return vec3(glass, lit, cool);
  }
`

/** Glass a soft cool tint of its wall by day; at night unlit glass barely darker and lit glass a gentle glow. */
export const FACADE_SHADE_GLSL = `
  uniform vec3 u_glass;
  uniform float u_glassMix;
  uniform float u_night;
  uniform vec3 u_windowLight;
  uniform float u_windowGlow;

  vec3 facadeShade(vec3 wall, vec3 f) {
    vec3 glassColor = mix(wall, u_glass * (0.55 + 0.6 * dot(wall, vec3(0.2126, 0.7152, 0.0722))), u_glassMix);
    vec3 light = mix(u_windowLight, vec3(0.8, 0.8, 0.76), f.z * 0.5);
    vec3 lit = mix(glassColor, light, f.y * u_night * u_windowGlow);
    return mix(wall, lit, f.x);
  }
`

type Rgb = [number, number, number]

/** A flavor's facade colours, sRGB 0-1; `night` 1 lights windows, `litScale` scales how many buildings are lit. */
export type FacadeFlavor = {
  glass: Rgb
  glassMix: number
  night: number
  windowLight: Rgb
  windowGlow: number
  litScale: number
}

export const FACADE_FLAVOR: Record<'light' | 'dark', FacadeFlavor> = {
  light: { glass: [0.66, 0.78, 0.9], glassMix: 0.45, night: 0, windowLight: [1, 0.82, 0.56], windowGlow: 1, litScale: 0 },
  dark: { glass: [0.14, 0.18, 0.27], glassMix: 0.3, night: 1, windowLight: [0.95, 0.76, 0.5], windowGlow: 0.65, litScale: 1 },
}

export const FACADE_UNIFORMS = ['u_glass', 'u_glassMix', 'u_night', 'u_windowLight', 'u_windowGlow', 'u_litScale'] as const

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
  gl.uniform1f(u.u_litScale, f.litScale)
}
