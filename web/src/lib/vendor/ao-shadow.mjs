/**
 * VENDORED — github.com/wallabyway/maplibre-building-shadows @ f4336f5 (MIT).
 *
 * Kept as close to upstream as possible so it stays updatable; every Parchment
 * change is marked `PARCHMENT:` and they fall into three groups:
 *
 *   - back-porting two v5 APIs to the MapLibre 4.7.1 fork we pin for variable
 *     line-offset (`_tileMatrix`, `_lightUniforms`)
 *   - the roofline edge, an addition rather than a fix — see the note above
 *     `BUILD_FS`
 *   - 3D terrain, which upstream has no support for — see the note above
 *     `TERRAIN`. Not optional: this layer *replaces* MapLibre's own extrusion
 *     draw, so without it every building over raised ground is drawn at sea
 *     level and the terrain buries it.
 *
 * See `building-shade.ts` for how it is configured and wired up.
 *
 * ---
 *
 * WallShadowLayer — merged plan D (heightfix ground shadow + SDF AO) and
 * plan E (wallshade per-vertex building AO) in a single custom layer.
 *
 * One tile walk, one set of cached VAOs, one GL-state sandbox per frame:
 *   1. shadow mask  → FBO[2] (stencil-projected ground shadows)
 *   2. seed + JFA   → FBO[0]/[1] ping-pong (SDF for ground contact AO)
 *   3. composite    → screen (blurred shadow + AO overlay, drawn FIRST)
 *   4. buildings    → screen (replaces MapLibre's fill-extrusion draw;
 *                     depth-tested over the overlay)
 *
 * All programs share fixed attribute locations (bindAttribLocation), so the
 * per-segment VAOs built for the building draw are reused by the shadow and
 * seed passes verbatim. Compatible with MapLibre GL JS v5.x.
 */

// Fixed attribute locations shared by every program, so one VAO serves all.
const LOC = { a_pos: 0, a_normal_ed: 1, a_height_f: 2, a_height_v: 3, a_base_f: 4, a_base_v: 5, a_color: 6, a_color4: 7, a_centroid: 8, a_roof_color: 9, a_roof_color4: 10 };
const LAYOUT_STRIDE = 12; // bytes per vertex in MapLibre fill-extrusion layout
const CENTROID_STRIDE = 4; // bytes per vertex in MapLibre's centroid buffer

// PARCHMENT: 3D terrain.
//
// This layer replaces MapLibre's fill-extrusion draw, so it has to replace
// everything that draw does — and with terrain on, that includes lifting each
// building onto the ground beneath it. MapLibre reads the elevation of the
// footprint's centroid out of the DEM texture in the vertex shader; without
// the same lookup the buildings stay pinned to sea level and sink into any
// hill they stand on.
//
// The lookup below mirrors `get_elevation` in MapLibre's own vertex prelude,
// rewritten for ESSL1: these shaders are GLSL ES 1.00 (`attribute`/`varying`),
// where the prelude is ESSL3 and uses `texelFetch`/`textureSize`. The DEM is a
// `u_terrain_dim` grid with a one-pixel border, so its texture is `dim + 2`
// square, and it is sampled NEAREST — hitting texel centres exactly is what
// makes the manual bilinear blend below match MapLibre's.
const TERRAIN = `
  uniform sampler2D u_terrain;
  uniform float u_terrain_dim;
  uniform mat4 u_terrain_matrix;
  uniform vec4 u_terrain_unpack;
  uniform float u_terrain_exaggeration;
  uniform float u_terrain_on;

  float ele(vec2 texel, vec2 c) {
    vec4 rgb = texture2DLod(u_terrain, (c + 0.5) * texel, 0.0) * 255.0 * u_terrain_unpack;
    return rgb.r + rgb.g + rgb.b - u_terrain_unpack.a;
  }

  float get_elevation(vec2 pos) {
    if (u_terrain_on < 0.5) return 0.0;
    float dim = u_terrain_dim + 2.0;
    vec2 texel = vec2(1.0 / dim);
    vec2 hi = vec2(dim - 1.0);
    vec2 coord = (u_terrain_matrix * vec4(pos, 0.0, 1.0)).xy * u_terrain_dim + 1.0;
    vec2 f = fract(coord);
    vec2 c = floor(coord);
    float tl = ele(texel, clamp(c, vec2(0.0), hi));
    float tr = ele(texel, clamp(c + vec2(1.0, 0.0), vec2(0.0), hi));
    float bl = ele(texel, clamp(c + vec2(0.0, 1.0), vec2(0.0), hi));
    float br = ele(texel, clamp(c + vec2(1.0, 1.0), vec2(0.0), hi));
    return mix(mix(tl, tr, f.x), mix(bl, br, f.x), f.y) * u_terrain_exaggeration;
  }

  attribute vec2 a_centroid;`;

/** Uniform names every program that samples the DEM has to be handed. */
const TERRAIN_UNIFORMS = [
  'u_terrain', 'u_terrain_dim', 'u_terrain_matrix', 'u_terrain_unpack',
  'u_terrain_exaggeration', 'u_terrain_on',
];

/** The DEM's texture unit. MapLibre uses 3 for the same thing; so do we. */
const TERRAIN_UNIT = 3;

/**
 * PARCHMENT: below this pitch the view counts as flat on, and the narrow
 * field of view that fakes an orthographic camera is in play. Matches
 * `TOP_DOWN_EPSILON` in `maplibre.strategy.ts`, which is what actually swaps
 * the projection — an eased pitch animation settles a hair off zero, and a
 * thousandth of a degree is still flat on.
 */
const PLAN_VIEW_PITCH = 0.001;

// u_ht/u_bt/u_ct < 0 selects the flat attribute, else interpolates the vec2 pair.
// Light color is hardcoded to white (the default in the styles we target).
const FE = `
  #define FE(f, v, t) ((t) < 0.0 ? (f) : mix((v).x, (v).y, t))`;

const HEIGHT_ATTRS = `
  attribute float a_height_f;
  attribute vec2 a_height_v;
  uniform float u_ht;
  attribute float a_base_f;
  attribute vec2 a_base_v;
  uniform float u_bt;
  ${FE}`;

// ── Buildings (plan E): geometry AO + directional lighting ─────────
const BUILD_VS = `
  uniform mat4 u_matrix;
  uniform vec3 u_lightpos;
  uniform float u_lightintensity;
  uniform float u_strength;
  uniform float u_band;
  attribute vec2 a_pos;
  attribute vec4 a_normal_ed;
  attribute vec2 a_color;
  attribute vec4 a_color4;
  uniform float u_ct;
  // PARCHMENT: the roof's own colour, from the donor layer — see
  // BUILDING_3D_ROOF_LAYER in map-style/build.ts. Same packing as a_color,
  // because it is the same paint property on a layer sharing this bucket.
  attribute vec2 a_roof_color;
  attribute vec4 a_roof_color4;
  uniform float u_rct;
  // 0 where no donor layer is in the style; the roof then wears the walls'.
  uniform float u_roof_on;
  ${HEIGHT_ATTRS}
  ${TERRAIN}
  varying vec3 v_color;
  varying float v_dark;
  uniform vec2 u_viewport;   // PARCHMENT
  uniform float u_edgeWidth; // PARCHMENT
  varying float v_ratio;     // PARCHMENT: height up the wall, for the roofline edge
  varying float v_border;    // PARCHMENT: that edge's width, in wall-height units
  varying float v_fade;      // PARCHMENT: 0 where the wall is too short to hold it
  void main() {
    float t = mod(a_normal_ed.x, 2.0);
    float isWall = a_normal_ed.z < 8192.0 ? 1.0 : 0.0;
    float base = max(FE(a_base_f, a_base_v, u_bt), 0.0);
    float h = max(FE(a_height_f, a_height_v, u_ht), 0.0);
    float elev = mix(base, h, t);
    float wallRatio = isWall > 0.5 ? max(0.0, elev - base) / max(h - base, 0.001) : -1.0;

    // PARCHMENT: lift onto the terrain. The roof rises by the ground height at
    // the footprint's centroid; the floor drops a further 10m when it sits at
    // ground level, which is the basement MapLibre digs for the same reason —
    // a building on a slope would otherwise hang in the air on its low side.
    //
    // The basement is dug ONLY with terrain on, which is the guard MapLibre
    // gets for free from compiling the whole block behind #ifdef TERRAIN3D.
    // It is a hole for the ground to fill, and it only works because the ground
    // is there to fill it: on a flat map nothing writes depth under a building,
    // so the same 10m is simply drawn, and every building stands 10m too tall
    // in a wall of its own that starts below its footprint.
    //
    // Applied after wallRatio, which is a fraction of the wall and would be
    // skewed by the basement if it were measured against the offset values.
    float groundTop = get_elevation(a_centroid);
    float basement = (u_terrain_on < 0.5 || base > 0.0) ? 0.0 : 10.0;
    float groundBase = groundTop - basement;
    float ground = mix(groundBase, groundTop, t);
    elev += ground;

    // exp(-3) = 0.0498, 1 / (1 - exp(-3)) = 1.0524
    float dark = (wallRatio < 0.0 || wallRatio >= u_band) ? 0.0
               : (exp(-3.0 * wallRatio / u_band) - 0.0498) * 1.0524;
    v_dark = u_strength * dark;

    // PARCHMENT: how wide the roofline band is, as a fraction of this wall's
    // height. Project the column this vertex stands on twice — once at its base
    // and once at its roof — and the screen distance between them is how many
    // pixels tall the wall is here, which turns a width in pixels into the
    // 0-1 units the fragment shader compares against. Guard the near plane: a
    // wall clipped behind the camera projects to nonsense.
    //
    // A wall too short to hold the border gets a fainter one rather than a
    // squashed one. Without this, zooming out turns every building into a
    // mostly-dark box — the band is a fixed width but the wall keeps shrinking
    // under it — so it fades out as the wall approaches the border's own size
    // and the far side of a view stays clean.
    v_ratio = wallRatio;
    vec4 pTop = u_matrix * vec4(a_pos, h + groundTop, 1.0);
    vec4 pBot = u_matrix * vec4(a_pos, base + groundBase, 1.0);
    float wallPx = (pTop.w > 0.001 && pBot.w > 0.001)
      ? length((pTop.xy / pTop.w - pBot.xy / pBot.w) * 0.5 * u_viewport)
      : 0.0;
    v_border = min(u_edgeWidth / max(wallPx, 1.0), 0.25);
    v_fade = smoothstep(1.5, 4.0, wallPx / max(u_edgeWidth, 0.001));

    vec2 pk = u_ct < -0.5 ? a_color : mix(a_color4.xy, a_color4.zw, u_ct);
    // PARCHMENT: a roof face takes the roof colour where the style supplies one.
    // isWall is already computed above off the face normal, so the choice is
    // free — the two colours arrive per vertex and one of them is picked.
    if (u_roof_on > 0.5 && isWall < 0.5) {
      pk = u_rct < -0.5 ? a_roof_color : mix(a_roof_color4.xy, a_roof_color4.zw, u_rct);
    }
    vec4 color = vec4(floor(pk / 256.0), mod(pk, 256.0)).xzyw / 255.0;
    float colorvalue = dot(color.rgb, vec3(0.2126, 0.7152, 0.0722));
    color.rgb += vec3(0.03);
    vec3 n = a_normal_ed.xyz / 16384.0;
    float directional = clamp(dot(n, u_lightpos), 0.0, 1.0);
    directional = mix(1.0 - u_lightintensity, max(1.0 - colorvalue + u_lightintensity, 1.0), directional);
    v_color = clamp(color.rgb * directional, 0.0, 1.0);
    gl_Position = u_matrix * vec4(a_pos, elev, 1.0);
  }`;

// PARCHMENT: the roofline edge.
//
// MapLibre has no outline for fill-extrusion at any version, and a line layer
// on the footprint draws the wrong thing — the base of the building, not the
// edge you can see. But the top of a wall IS the roofline, and `v_ratio` says
// how far up a wall a fragment sits, so darkening where it approaches 1 draws
// the edge on the geometry itself.
//
// The band has to be a fixed width in *pixels*, or it reads as a gradient on a
// tower and swallows a townhouse whole. `v_border` carries the conversion,
// measured in the vertex shader (see the note there) rather than with `fwidth`
// — derivatives are not available to an ESSL1 shader under WebGL2, and this is
// both cheaper and exact rather than a one-pixel finite difference.
//
// Only the horizontal edges come out of this. The vertical corners where two
// walls meet are already read by the flat shading — adjacent faces take
// different light — and drawing them properly would need a separate line index
// buffer, which is not worth its own geometry pass.
const BUILD_FS = `
  precision highp float;
  uniform float u_edge;
  varying vec3 v_color;
  varying float v_dark;
  varying float v_ratio;
  varying float v_border;
  varying float v_fade;
  void main() {
    float edge = v_ratio < 0.0 ? 0.0
               : v_fade * (1.0 - smoothstep(0.0, v_border, 1.0 - v_ratio));
    gl_FragColor = vec4(v_color * (1.0 - v_dark) * (1.0 - u_edge * edge), 1.0);
  }`;

// ── Ground shadow mask (plan D): shear each vertex by its real elevation ──
const SHAD_VS = `
  uniform mat4 u_matrix;
  uniform vec2 u_shadowOff;
  uniform float u_heightScale;
  attribute vec2 a_pos;
  attribute vec4 a_normal_ed;
  ${HEIGHT_ATTRS}
  ${TERRAIN}
  void main() {
    float t = mod(a_normal_ed.x, 2.0);
    // Roof (t=1) shears by height, wall bottoms (t=0) by fill-extrusion-base,
    // so floating slabs (render_min_height) don't cast full-height shadows.
    float h = mix(FE(a_base_f, a_base_v, u_bt), FE(a_height_f, a_height_v, u_ht), t) * u_heightScale;
    // PARCHMENT: the shadow lands on the ground, and with terrain on the
    // ground is not at zero — it has to be sheared at the height the building
    // is actually standing at or it projects to the wrong place on screen.
    gl_Position = u_matrix * vec4(a_pos + u_shadowOff * h, get_elevation(a_centroid), 1.0);
  }`;
const SHAD_FS = `
  precision highp float;
  void main() { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); }`;

// ── AO seed: rasterise footprints → store screen coords ────────────
const SEED_VS = `
  uniform mat4 u_matrix;
  attribute vec2 a_pos;
  ${TERRAIN}
  void main() { gl_Position = u_matrix * vec4(a_pos, get_elevation(a_centroid), 1.0); }`;
const SEED_FS = `
  precision highp float;
  uniform vec2 u_res;
  void main() { gl_FragColor = vec4(gl_FragCoord.xy / u_res, 0.0, 1.0); }`;

// ── JFA: Jump Flood Algorithm ──────────────────────────────────────
const JFA_VS = `
  attribute vec2 a_pos;
  varying vec2 v_uv;
  void main() { v_uv = a_pos * 0.5 + 0.5; gl_Position = vec4(a_pos, 0.0, 1.0); }`;
const JFA_FS = `
  precision highp float;
  uniform sampler2D u_tex;
  uniform float u_stride;
  uniform vec2 u_texel;
  varying vec2 v_uv;
  void main() {
    vec2 best = vec2(0.0);
    float bestD = 1e10, found = 0.0;
    for (int dy = -1; dy <= 1; dy++)
      for (int dx = -1; dx <= 1; dx++) {
        vec2 uv = v_uv + vec2(float(dx), float(dy)) * u_stride * u_texel;
        if (uv.x >= 0.0 && uv.x <= 1.0 && uv.y >= 0.0 && uv.y <= 1.0) {
          vec4 s = texture2D(u_tex, uv);
          if (s.a > 0.5) {
            float d = distance(v_uv, s.rg);
            if (d < bestD) { bestD = d; best = s.rg; found = 1.0; }
          }
        }
      }
    gl_FragColor = found > 0.5 ? vec4(best, 0.0, 1.0) : vec4(0.0);
  }`;

// ── Combined composite: blurred shadow mask + AO from SDF ──────────
const COMP_FS = `
  precision highp float;
  uniform sampler2D u_sdf, u_shadow;
  uniform float u_radius, u_intensity, u_shadowAlpha;
  uniform vec2 u_offset, u_blurStep;
  varying vec2 v_uv;

  void main() {
    float sh = 0.0, sw = 0.0;
    for (int dy = -2; dy <= 2; dy++)
      for (int dx = -2; dx <= 2; dx++) {
        float d2 = float(dx * dx + dy * dy);
        float w = exp(-0.5 * d2);
        sh += texture2D(u_shadow, v_uv + vec2(float(dx), float(dy)) * u_blurStep).a * w;
        sw += w;
      }
    float shadow = (sh / sw) * u_shadowAlpha;

    vec2 uv = v_uv - u_offset;
    vec4 s = texture2D(u_sdf, uv);
    float ao = 0.0;
    if (s.a > 0.5) {
      float d = distance(uv, s.rg);
      if (d < u_radius)
        ao = exp(-3.0 * d / u_radius) * u_intensity;
    }
    float combined = 1.0 - (1.0 - shadow) * (1.0 - ao);
    if (combined < 0.001) discard;
    gl_FragColor = vec4(0.0, 0.0, 0.0, combined);
  }`;

// ── GL helpers ──────────────────────────────────────────────────────
function compileShader(gl, type, src) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
    console.error('[wallshadow]', gl.getShaderInfoLog(shader));
  return shader;
}

// Links with every shared attribute pinned to its fixed location; names the
// shader doesn't declare are ignored by the GL.
function linkProgram(gl, vSrc, fSrc) {
  const prog = gl.createProgram();
  gl.attachShader(prog, compileShader(gl, gl.VERTEX_SHADER, vSrc));
  gl.attachShader(prog, compileShader(gl, gl.FRAGMENT_SHADER, fSrc));
  for (const [name, loc] of Object.entries(LOC)) gl.bindAttribLocation(prog, loc, name);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS))
    console.error('[wallshadow] link:', gl.getProgramInfoLog(prog));
  return prog;
}

function uniformLocs(gl, prog, names) {
  return Object.fromEntries(names.map(n => [n, gl.getUniformLocation(prog, n)]));
}

function createTexture(gl, size, useFloat, filter = gl.NEAREST) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  const [ifmt, type] = useFloat ? [gl.RGBA32F, gl.FLOAT] : [gl.RGBA, gl.UNSIGNED_BYTE];
  gl.texImage2D(gl.TEXTURE_2D, 0, ifmt, size, size, 0, gl.RGBA, type, null);
  for (const [p, v] of [[gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE],
                        [gl.TEXTURE_MIN_FILTER, filter], [gl.TEXTURE_MAG_FILTER, filter]])
    gl.texParameteri(gl.TEXTURE_2D, p, v);
  return tex;
}

function beginPass(gl, fbo, size, { stencil = false } = {}) {
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.viewport(0, 0, size, size);
  gl.disable(gl.DEPTH_TEST);
  gl.depthMask(false);
  gl.disable(gl.BLEND);
  gl.clearColor(0, 0, 0, 0);
  if (stencil) {
    gl.enable(gl.STENCIL_TEST);
    gl.stencilMask(0xFF);
    gl.clearStencil(0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
  } else {
    gl.clear(gl.COLOR_BUFFER_BIT);
  }
}

function drawQuad(gl, quadBuf) {
  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
  gl.enableVertexAttribArray(LOC.a_pos);
  gl.vertexAttribPointer(LOC.a_pos, 2, gl.FLOAT, false, 0, 0);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}

function saveGlState(gl) {
  const G = gl;
  return {
    fbo: G.getParameter(G.FRAMEBUFFER_BINDING),
    vp: G.getParameter(G.VIEWPORT),
    depth: G.isEnabled(G.DEPTH_TEST),
    depthFunc: G.getParameter(G.DEPTH_FUNC),
    depthMask: G.getParameter(G.DEPTH_WRITEMASK),
    depthRange: G.getParameter(G.DEPTH_RANGE),
    stencil: G.isEnabled(G.STENCIL_TEST),
    stencilFunc: G.getParameter(G.STENCIL_FUNC),
    stencilRef: G.getParameter(G.STENCIL_REF),
    stencilValueMask: G.getParameter(G.STENCIL_VALUE_MASK),
    stencilWriteMask: G.getParameter(G.STENCIL_WRITEMASK),
    stencilOp: [G.getParameter(G.STENCIL_FAIL), G.getParameter(G.STENCIL_PASS_DEPTH_FAIL), G.getParameter(G.STENCIL_PASS_DEPTH_PASS)],
    blend: G.isEnabled(G.BLEND),
    cull: G.isEnabled(G.CULL_FACE),
    cullFace: G.getParameter(G.CULL_FACE_MODE),
    frontFace: G.getParameter(G.FRONT_FACE),
    vao: G.getParameter(G.VERTEX_ARRAY_BINDING),
  };
}

function restoreGlState(gl, s) {
  const en = (cap, on) => gl[on ? 'enable' : 'disable'](cap);
  gl.bindFramebuffer(gl.FRAMEBUFFER, s.fbo);
  gl.viewport(s.vp[0], s.vp[1], s.vp[2], s.vp[3]);
  gl.depthFunc(s.depthFunc);
  gl.depthMask(s.depthMask);
  gl.depthRange(s.depthRange[0], s.depthRange[1]);
  gl.stencilFunc(s.stencilFunc, s.stencilRef, s.stencilValueMask);
  gl.stencilMask(s.stencilWriteMask);
  gl.stencilOp(...s.stencilOp);
  en(gl.DEPTH_TEST, s.depth); en(gl.STENCIL_TEST, s.stencil);
  en(gl.BLEND, s.blend); en(gl.CULL_FACE, s.cull);
  gl.cullFace(s.cullFace);
  gl.frontFace(s.frontFace);
}

// Composite buffers store (value@overscaledZ, value@overscaledZ+1) — matching
// MapLibre's own bucket creation which keys paint evaluation off overscaledZ.
function zoomFactor(map, coord) {
  const z = coord.overscaledZ ?? coord.canonical?.z;
  return Math.min(1, Math.max(0, map.getZoom() - z));
}

// ── Layer ───────────────────────────────────────────────────────────
export class WallShadowLayer {
  constructor(opts = {}) {
    this.id = opts.id || 'wallshadow';
    this.type = 'custom';
    this.renderingMode = '2d';
    this._layerId = opts.buildingsLayerId;
    // PARCHMENT: the layer whose colour is the roof's; see BUILDING_3D_ROOF_LAYER.
    this._roofLayerId = opts.roofLayerId ?? null;
    this._sourceId = opts.sourceId || null;
    this._minZoom = opts.minZoom ?? 15;
    this._maxZoom = opts.maxZoom ?? 20;

    this.enabled = opts.enabled ?? true;
    this.wallShade = opts.wallShade ?? true;  // buildings (plan E)
    this.groundFx = opts.groundFx ?? true;    // ground shadow + AO (plan D)

    // wall shading
    this.strength = opts.strength ?? 0.5;
    this.band = opts.band ?? 1.0;
    // PARCHMENT: roofline edge — how dark, and how many pixels wide.
    this.edge = opts.edge ?? 0;
    this.edgeWidth = opts.edgeWidth ?? 1.5;
    this._height = opts.height ?? 40;
    this._base = opts.base ?? 0;

    // ground shadow
    this.shadowAlpha = opts.shadowAlpha ?? 0.35;
    this._heightScale = opts.heightScale ?? 0.38;
    this.shadowOffset = opts.shadowOffset ?? [-0.5, 0.5];
    this.shadowBlur = opts.shadowBlur ?? 2.0;

    // PARCHMENT: how the ground effects fade in and out — see `groundOpacity`.
    this.fadeZoom = opts.fadeZoom ?? 1.2;
    this.topDownOpacity = opts.topDownOpacity ?? 0.5;
    this.topDownPitch = opts.topDownPitch ?? 25;

    // ground AO
    this._sdfRes = opts.sdfResolution ?? 1024;
    this.aoRadiusMin = opts.aoRadiusMin ?? 30;
    this.aoRadiusMax = opts.aoRadiusMax ?? 120;
    this.aoIntensity = opts.aoIntensity ?? 0.80;
    this.aoOffset = opts.aoOffset ?? [0, -2, -4];
  }

  onAdd(map, gl) {
    this._map = map;
    this._vao = { create: () => gl.createVertexArray(), bind: v => gl.bindVertexArray(v) };

    this._buildProg = linkProgram(gl, BUILD_VS, BUILD_FS);
    this._uBuild = uniformLocs(gl, this._buildProg,
      ['u_matrix', 'u_ht', 'u_bt', 'u_ct', 'u_band', 'u_strength', 'u_lightpos', 'u_lightintensity',
        'u_edge', 'u_edgeWidth', 'u_viewport', 'u_rct', 'u_roof_on', ...TERRAIN_UNIFORMS]); // PARCHMENT

    this._shadProg = linkProgram(gl, SHAD_VS, SHAD_FS);
    this._uShad = uniformLocs(gl, this._shadProg,
      ['u_matrix', 'u_shadowOff', 'u_heightScale', 'u_ht', 'u_bt', ...TERRAIN_UNIFORMS]);

    this._seedProg = linkProgram(gl, SEED_VS, SEED_FS);
    this._uSeed = uniformLocs(gl, this._seedProg, ['u_matrix', 'u_res', ...TERRAIN_UNIFORMS]);

    this._jfaProg = linkProgram(gl, JFA_VS, JFA_FS);
    this._uJfa = uniformLocs(gl, this._jfaProg, ['u_tex', 'u_stride', 'u_texel']);

    this._compProg = linkProgram(gl, JFA_VS, COMP_FS);
    this._uComp = uniformLocs(gl, this._compProg,
      ['u_sdf', 'u_shadow', 'u_radius', 'u_intensity', 'u_shadowAlpha', 'u_offset', 'u_blurStep']);

    // textures: [0],[1] JFA ping-pong, [2] shadow mask
    const N = this._sdfRes;
    this._useFloat = !!gl.getExtension('EXT_color_buffer_float');
    this._tex = [createTexture(gl, N, this._useFloat), createTexture(gl, N, this._useFloat),
                 createTexture(gl, N, false, gl.LINEAR)];

    // FBOs: [0],[1] JFA, [2] shadow mask + stencil
    this._fbo = Array.from({ length: 3 }, () => gl.createFramebuffer());
    for (let i = 0; i < 3; i++) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, this._fbo[i]);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this._tex[i], 0);
    }
    this._stencilRB = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, this._stencilRB);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH24_STENCIL8, N, N);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this._fbo[2]);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_STENCIL_ATTACHMENT, gl.RENDERBUFFER, this._stencilRB);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    this._quadBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this._quadBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  }

  /* ── shared tile access ── */

  _resolveSource() {
    if (!this._sourceId) {
      const layer = this._map.getLayer(this._layerId);
      if (layer) this._sourceId = layer.source || layer.sourceLayer;
    }
    const style = this._map.style;
    return style.tileManagers?.[this._sourceId] || style.sourceCaches?.[this._sourceId] || null;
  }

  /**
   * PARCHMENT: MapLibre 6 removed the public `map.transform`. The painter still
   * holds the one it is currently drawing with, which is the right one to ask
   * anyway — it is the transform this frame is being rendered against.
   */
  _transform() {
    return this._map.painter?.transform ?? this._map.transform;
  }

  _tileMatrix(coord) {
    const xf = this._transform();
    if (!xf) return null;
    try { return xf.getProjectionData({ overscaledTileID: coord, applyTerrainMatrix: true })?.mainMatrix; }
    catch { }
    // PARCHMENT: v4 has no `getProjectionData`, and its `calculatePosMatrix`
    // wants an UnwrappedTileID rather than the OverscaledTileID we hold. It has
    // already done the work, though — `getVisibleCoordinates` stamps each coord
    // with its own `posMatrix` on the way past — so read that first.
    if (coord.posMatrix) return coord.posMatrix;
    try { return xf.calculatePosMatrix(coord.toUnwrapped ? coord.toUnwrapped() : coord); }
    catch { return null; }
  }

  /**
   * PARCHMENT: the elevation this tile stands on, or null when terrain is off.
   *
   * MapLibre hands its own fill-extrusion draw exactly this, per tile — the DEM
   * texture covering the tile plus the matrix that maps tile coordinates into
   * it. Reading it off the live terrain rather than caching anything means the
   * layer follows a terrain toggle without being rebuilt.
   */
  _terrain() {
    const map = this._map;
    return map.terrain ?? map.style?.map?.terrain ?? map.painter?.style?.map?.terrain ?? null;
  }

  _bindTerrain(gl, U, coord) {
    const terrain = this._terrain();
    const data = terrain && coord ? terrain.getTerrainData(coord) : null;
    if (!data) {
      gl.uniform1f(U.u_terrain_on, 0);
      return;
    }
    gl.uniform1f(U.u_terrain_on, 1);
    gl.uniform1i(U.u_terrain, TERRAIN_UNIT);
    gl.uniform1f(U.u_terrain_dim, data.u_terrain_dim);
    gl.uniformMatrix4fv(U.u_terrain_matrix, false, data.u_terrain_matrix);
    gl.uniform4fv(U.u_terrain_unpack, data.u_terrain_unpack);
    gl.uniform1f(U.u_terrain_exaggeration, data.u_terrain_exaggeration);
    gl.activeTexture(gl.TEXTURE0 + TERRAIN_UNIT);
    gl.bindTexture(gl.TEXTURE_2D, data.texture);
  }

  _lightUniforms() {
    const light = this._map.style.light;
    const L = light?.properties;
    if (!L) return { pos: [0.5, -0.6, 0.62], intensity: 0.5 };
    // PARCHMENT: MapLibre 6 stores the light position in spherical coordinates
    // and converts on the way out, where v4 handed back cartesian directly.
    // Reading `.x/.y/.z` off the spherical value yields three undefineds, which
    // reach the shader as NaN and multiply every building to black.
    const p = light.getCartesianPosition?.() ?? L.get('position');
    let [x, y, z] = Array.isArray(p) ? p : [p.x, p.y, p.z];
    if (L.get('anchor') === 'viewport') {
      // PARCHMENT: `bearingInRadians` is v5; v4 exposes degrees only.
      const xf = this._transform();
      const th = xf?.bearingInRadians ?? ((xf?.bearing ?? 0) * Math.PI) / 180;
      [x, y] = [x * Math.cos(th) - y * Math.sin(th), x * Math.sin(th) + y * Math.cos(th)];
    }
    return { pos: [x, y, z], intensity: L.get('intensity') };
  }

  // Per-bucket VAO cache, shared by the shadow, seed and building programs
  // (fixed attribute locations make this possible).
  _segVaos(gl, bucket) {
    const key = '_wshVao';
    if (bucket[key]) return bucket[key];
    const configs = bucket.programConfigurations?.programConfigurations;
    const cfg = configs?.[this._layerId];
    // PARCHMENT: the roof colour rides on a second layer sharing this bucket, so
    // its paint buffers are built alongside and indexed by the same vertices —
    // see BUILDING_3D_ROOF_LAYER. Absent (an older style, the hybrid overlay)
    // and the roof simply wears the walls' colour; `u_roof_on` says which.
    const roofCfg = this._roofLayerId ? configs?.[this._roofLayerId] : null;
    const findBuf = (from, name) =>
      from?._buffers?.find(b => b.attributes?.some(a => a.name === name)) ?? null;
    // Resolve a data-driven attribute: flat loc at the default component count,
    // vec loc for the interpolated variant; comp 0 when the buffer is absent.
    const dyn = (from, name, fLoc, vLoc, defComp) => {
      const buf = findBuf(from, name);
      const comp = buf ? (buf.attributes?.find(a => a.name === name)?.components || defComp) : 0;
      return { buf: buf?.buffer, loc: comp === defComp ? fLoc : vLoc, comp };
    };
    const hD = dyn(cfg, 'a_height', LOC.a_height_f, LOC.a_height_v, 1);
    const bD = dyn(cfg, 'a_base', LOC.a_base_f, LOC.a_base_v, 1);
    const cD = dyn(cfg, 'a_color', LOC.a_color, LOC.a_color4, 2);
    const rD = dyn(roofCfg, 'a_color', LOC.a_roof_color, LOC.a_roof_color4, 2);
    const point = (loc, glBuf, comp, type, stride, off) => {
      if (!glBuf) return;
      gl.bindBuffer(gl.ARRAY_BUFFER, glBuf);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, comp, type, false, stride, off);
    };
    const list = [];
    for (const seg of bucket.segments.get()) {
      const vao = this._vao.create();
      this._vao.bind(vao);
      point(LOC.a_pos, bucket.layoutVertexBuffer.buffer, 2, gl.SHORT, LAYOUT_STRIDE, seg.vertexOffset * LAYOUT_STRIDE);
      point(LOC.a_normal_ed, bucket.layoutVertexBuffer.buffer, 4, gl.SHORT, LAYOUT_STRIDE, seg.vertexOffset * LAYOUT_STRIDE + 4);
      // PARCHMENT: the footprint centroid, which is where the DEM is sampled.
      // MapLibre builds this buffer whether or not terrain is on, and passes it
      // to its own draw only when it is; we bind it always and let
      // `u_terrain_on` decide, so a terrain toggle needs no VAO rebuild.
      point(LOC.a_centroid, bucket.centroidVertexBuffer?.buffer, 2, gl.SHORT, CENTROID_STRIDE, seg.vertexOffset * CENTROID_STRIDE);
      for (const d of [hD, bD, cD, rD]) point(d.loc, d.buf, d.comp, gl.FLOAT, d.comp * 4, seg.vertexOffset * d.comp * 4);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, bucket.indexBuffer.buffer);
      list.push({ vao, pO: seg.primitiveOffset, pL: seg.primitiveLength });
    }
    this._vao.bind(null);
    return (bucket[key] = { list, hComp: hD.comp, bComp: bD.comp, cComp: cD.comp, rComp: rD.comp });
  }

  _drawSegs(gl, sg) {
    for (const s of sg.list) {
      this._vao.bind(s.vao);
      gl.drawElements(gl.TRIANGLES, s.pL * 3, gl.UNSIGNED_SHORT, s.pO * 6);
    }
  }

  /* ── render orchestrator ── */

  render(gl) {
    if (!this.enabled || this._map.getZoom() < this._minZoom) return;
    const source = this._resolveSource();
    const layer = this._map.getLayer(this._layerId);
    if (!source || !layer) return;

    let coords;
    try { coords = source.getVisibleCoordinates().reverse(); } catch { return; }
    if (!coords.length) return;

    // One tile walk feeds every pass.
    const tiles = [];
    for (const coord of coords) {
      let tile, bucket, m;
      try {
        tile = source.getTile(coord);
        bucket = tile?.getBucket(layer);
        m = this._tileMatrix(coord);
      } catch { continue; }
      if (!bucket || !m) continue;
      tiles.push({ coord, tile, bucket, matrix: m instanceof Float32Array ? m : new Float32Array(m), zf: zoomFactor(this._map, coord) });
    }
    if (!tiles.length) return;

    const saved = saveGlState(gl);
    gl.disable(gl.RASTERIZER_DISCARD);

    // Pinned defaults for attribute slots a tile may not supply (data-driven
    // off). Attribute constants are context-global, not VAO state.
    const H = this._height, B = this._base, W = 65535;
    gl.vertexAttrib1f(LOC.a_height_f, H); gl.vertexAttrib2f(LOC.a_height_v, H, H);
    gl.vertexAttrib1f(LOC.a_base_f, B); gl.vertexAttrib2f(LOC.a_base_v, B, B);
    gl.vertexAttrib2f(LOC.a_color, W, W);
    gl.vertexAttrib2f(LOC.a_centroid, 0, 0); // PARCHMENT
    gl.vertexAttrib4f(LOC.a_color4, W, W, W, W);
    // PARCHMENT: never read unless `u_roof_on`, which is only set when the
    // buffer behind them exists — pinned anyway, since an unset attribute
    // constant is whatever the last layer through this context left there.
    gl.vertexAttrib2f(LOC.a_roof_color, W, W);
    gl.vertexAttrib4f(LOC.a_roof_color4, W, W, W, W);

    if (this.groundFx) {
      this._shadowPass(gl, tiles);
      this._seedPass(gl, tiles);
      this._jfaPass(gl);
      this._compPass(gl, saved);
    }
    if (this.wallShade) this._buildingPass(gl, tiles);

    restoreGlState(gl, saved);
    this._vao.bind(saved.vao);

    // MapLibre's painter caches GL state; invalidate everything we touched.
    const ctx = this._map.painter?.context;
    if (ctx) for (const k of ['program', 'bindVertexBuffer', 'bindElementBuffer', 'bindVertexArray',
      'depthMask', 'depthFunc', 'depthRange', 'activeTexture', 'bindTexture',
      'stencilFunc', 'stencilOp', 'blend', 'blendFunc', 'cullFace'])
      if (ctx[k]) ctx[k].dirty = true;
  }

  /**
   * PARCHMENT: how strongly the ground shadow and occlusion draw right now.
   *
   * Two things dim them. Zoom: the layer switches on at `_minZoom`, and without
   * this the shadows arrive at full strength in a single frame while the
   * buildings casting them are still growing out of the ground — so they ramp
   * over `fadeZoom` levels instead, smoothstepped so neither end has a corner.
   *
   * Pitch: looking straight down there is no visible wall for a shadow to
   * belong to, so a full-strength one reads as a stain on the ground rather
   * than as depth. It eases back to `topDownOpacity` as the camera flattens.
   */
  groundOpacity() {
    const zoom = this._map.getZoom();
    const zt = Math.min(Math.max((zoom - this._minZoom) / Math.max(this.fadeZoom, 0.001), 0), 1);
    const zoomFade = zt * zt * (3 - 2 * zt);

    const pt = Math.min(Math.max(this._map.getPitch() / Math.max(this.topDownPitch, 0.001), 0), 1);
    const pitchFade = this.topDownOpacity + (1 - this.topDownOpacity) * (pt * pt * (3 - 2 * pt));

    return zoomFade * pitchFade;
  }

  /* ── 1. shadow mask → FBO[2] with stencil (no overlap) ── */

  _shadowPass(gl, tiles) {
    const U = this._uShad;
    beginPass(gl, this._fbo[2], this._sdfRes, { stencil: true });
    gl.stencilFunc(gl.EQUAL, 0, 0xFF);
    gl.stencilOp(gl.KEEP, gl.KEEP, gl.INCR);

    gl.useProgram(this._shadProg);
    gl.uniform1f(U.u_heightScale, this._heightScale);

    for (const { coord, tile, bucket, matrix, zf } of tiles) {
      const sg = this._segVaos(gl, bucket);
      if (!sg) continue;
      gl.uniformMatrix4fv(U.u_matrix, false, matrix);
      this._bindTerrain(gl, U, coord); // PARCHMENT
      const s = Math.pow(2, coord.overscaledZ) / tile.tileSize / 8;
      gl.uniform2f(U.u_shadowOff, this.shadowOffset[0] * s, -this.shadowOffset[1] * s);
      gl.uniform1f(U.u_ht, sg.hComp === 2 ? zf : -1);
      gl.uniform1f(U.u_bt, sg.bComp === 2 ? zf : -1);
      this._drawSegs(gl, sg);
    }
    this._vao.bind(null);
    gl.disable(gl.STENCIL_TEST);
  }

  /* ── 2. seed footprints → FBO[0] ── */

  _seedPass(gl, tiles) {
    const U = this._uSeed;
    beginPass(gl, this._fbo[0], this._sdfRes);
    gl.useProgram(this._seedProg);
    gl.uniform2f(U.u_res, this._sdfRes, this._sdfRes);

    for (const { coord, bucket, matrix } of tiles) {
      const sg = this._segVaos(gl, bucket);
      if (!sg) continue;
      gl.uniformMatrix4fv(U.u_matrix, false, matrix);
      this._bindTerrain(gl, U, coord); // PARCHMENT
      this._drawSegs(gl, sg);
    }
    this._vao.bind(null);
    this._readIdx = 0;
  }

  /* ── 3. JFA passes → FBO ping-pong ── */

  _jfaPass(gl) {
    const N = this._sdfRes;
    const U = this._uJfa;
    this._vao.bind(null);

    gl.useProgram(this._jfaProg);
    gl.uniform2f(U.u_texel, 1 / N, 1 / N);
    gl.uniform1i(U.u_tex, 0);

    let read = 0;
    for (let stride = N >> 1; stride >= 1; stride >>= 1) {
      const write = 1 - read;
      gl.bindFramebuffer(gl.FRAMEBUFFER, this._fbo[write]);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this._tex[read]);
      gl.uniform1f(U.u_stride, stride);
      drawQuad(gl, this._quadBuf);
      read = write;
    }
    this._readIdx = read;
  }

  /* ── 4. combined shadow + AO composite → screen (under buildings) ── */

  _compPass(gl, saved) {
    const U = this._uComp;
    const vp = saved.vp;

    gl.bindFramebuffer(gl.FRAMEBUFFER, saved.fbo);
    gl.viewport(vp[0], vp[1], vp[2], vp[3]);
    this._vao.bind(null);
    gl.useProgram(this._compProg);

    const vw = vp[2], vh = vp[3];
    const zoom = this._map.getZoom();
    const t = Math.min(Math.max((zoom - this._minZoom) / (this._maxZoom - this._minZoom), 0), 1);
    const radiusPx = this.aoRadiusMin + t * (this.aoRadiusMax - this.aoRadiusMin);
    gl.uniform1f(U.u_radius, Math.min(radiusPx / Math.max(vw, vh), 0.2));
    const opacity = this.groundOpacity(); // PARCHMENT
    gl.uniform1f(U.u_intensity, this.aoIntensity * opacity);
    gl.uniform1f(U.u_shadowAlpha, this.shadowAlpha * opacity);

    const blurStep = this.shadowBlur / this._sdfRes;
    gl.uniform2f(U.u_blurStep, blurStep, blurStep);

    const bearing = this._map.getBearing() * Math.PI / 180;
    const c = Math.cos(bearing), s = Math.sin(bearing);
    const [ox, oy, oz] = this.aoOffset;
    gl.uniform2f(U.u_offset, (ox * c - oy * s) / vw, ((ox * s + oy * c) + (oz ?? 0)) / vh);

    gl.uniform1i(U.u_sdf, 0);
    gl.uniform1i(U.u_shadow, 1);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this._tex[this._readIdx]);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this._tex[2]);

    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    drawQuad(gl, this._quadBuf);
  }

  /* ── 5. buildings → screen (plan E draw, depth-tested over the overlay) ── */

  _buildingPass(gl, tiles) {
    const U = this._uBuild;

    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(true);
    const dr = this._map.painter?.depthRangeFor3D;
    if (dr) gl.depthRange(dr[0], dr[1]);
    gl.disable(gl.BLEND);
    gl.disable(gl.STENCIL_TEST);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.frontFace(gl.CCW);

    // PARCHMENT: in the plan view only, bias the buildings towards the camera
    // so they win the depth test against the ground they are standing on.
    //
    // With 3D terrain on, that ground is a real depth-writing mesh directly
    // under every footprint, and how finely the two can be told apart depends
    // on the depth buffer's precision. MapLibre pins `nearZ` at `height / 50`
    // while `farZ` follows the camera's distance, so narrowing the field of
    // view to fake an orthographic plan view (see `updateCameraProjection`)
    // pushes the camera far enough back to take the far-to-near ratio from ~84
    // to ~5800 — and at that point a building base and the terrain under it
    // quantise to the same depth. Fragments then win or lose at random and the
    // buildings shatter into a mosaic of slivers that flickers as the camera
    // moves.
    //
    // Only there, though, and that is the whole point of the check. Winning the
    // depth test against the ground is exactly what a building must NOT do once
    // the camera tilts: the 10m basement above is meant to be buried, and a
    // building that outranks the terrain has it drawn instead — ten metres of
    // wall below the pavement, the building reading that much taller, and the
    // trees beside it (an honest depth test, no bias) left hanging above a
    // ground line that has dropped away from under them.
    //
    // The slope term goes with it. `glPolygonOffset`'s first argument is scaled
    // by the polygon's depth slope, which for a wall seen near edge-on — which
    // is what tilting produces — is enormous, so the bias grew with the tilt
    // and the artefact grew with it. A plan view sees roofs, whose slope is
    // ~0 and for which the constant term was doing all the work anyway.
    const planView = Math.abs(this._map.getPitch?.() ?? 0) < PLAN_VIEW_PITCH;
    if (planView) {
      gl.enable(gl.POLYGON_OFFSET_FILL);
      gl.polygonOffset(0, -8);
    }

    gl.useProgram(this._buildProg);
    gl.uniform1f(U.u_band, Math.max(0.01, this.band));
    gl.uniform1f(U.u_strength, this.strength);
    gl.uniform1f(U.u_edge, this.edge); // PARCHMENT
    gl.uniform1f(U.u_edgeWidth, this.edgeWidth); // PARCHMENT
    gl.uniform2f(U.u_viewport, gl.drawingBufferWidth, gl.drawingBufferHeight); // PARCHMENT
    const light = this._lightUniforms();
    gl.uniform3fv(U.u_lightpos, light.pos);
    gl.uniform1f(U.u_lightintensity, light.intensity);

    for (const { coord, bucket, matrix, zf } of tiles) {
      const sg = this._segVaos(gl, bucket);
      if (!sg) continue;
      gl.uniformMatrix4fv(U.u_matrix, false, matrix);
      this._bindTerrain(gl, U, coord); // PARCHMENT
      gl.uniform1f(U.u_ht, sg.hComp === 2 ? zf : -1);
      gl.uniform1f(U.u_bt, sg.bComp === 2 ? zf : -1);
      gl.uniform1f(U.u_ct, sg.cComp === 4 ? zf : -1);
      gl.uniform1f(U.u_rct, sg.rComp === 4 ? zf : -1); // PARCHMENT
      gl.uniform1f(U.u_roof_on, sg.rComp ? 1 : 0);     // PARCHMENT
      this._drawSegs(gl, sg);
    }
    this._vao.bind(null);
    if (planView) { // PARCHMENT
      gl.polygonOffset(0, 0);
      gl.disable(gl.POLYGON_OFFSET_FILL);
    }
  }

  onRemove(_map, gl) {
    for (const p of [this._buildProg, this._shadProg, this._seedProg, this._jfaProg, this._compProg])
      gl.deleteProgram(p);
    this._fbo.forEach(f => gl.deleteFramebuffer(f));
    this._tex.forEach(t => gl.deleteTexture(t));
    gl.deleteRenderbuffer(this._stencilRB);
    gl.deleteBuffer(this._quadBuf);
  }
}
