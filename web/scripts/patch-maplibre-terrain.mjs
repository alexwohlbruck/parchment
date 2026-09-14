// Make fill-extrusion elevations agree across tile borders under 3D terrain.
//
// Vector tiles duplicate a building into every tile whose buffer it touches,
// and clip it when it reaches past the buffer. Flat, the copies render at
// identical positions and depth testing hides the overdraw. With the terrain
// mesh up, MapLibre stands each copy on the DEM at the centroid of the
// geometry AS CLIPPED INTO THAT TILE — different tiles, different centroids,
// different elevations — so a building near a tile border renders as two
// interleaved copies at the min and max of its ground heights.
//
// Two changes inside FillExtrusionBucket.addFeature, applied per polygon:
//
// 1. Ownership: a tile only draws a polygon whose bounding-box center it owns
//    (half-open [0, EXTENT), so a center exactly on the border belongs to one
//    tile). That drops buffer duplicates. The bbox center rather than the
//    vertex mean, so a copy is only dropped when the neighbor's copy fully
//    covers it.
// 2. Border anchoring: a polygon that CROSSES a tile edge line is a clipped
//    piece — its counterpart in the neighboring tile crosses the same world
//    line through the same wall geometry. Both pieces therefore compute the
//    same point — the midpoint of the polygon's crossings of that line — and
//    sample the DEM there instead of at their own clipped centroid. Same
//    anchor, same elevation: the pieces line up and their buffer overlap
//    renders coincident. A polygon crossing BOTH an x-line and a y-line is a
//    corner-spanning piece; span midpoints are measured on each piece's own
//    clipped geometry and would disagree across the diagonal, so those anchor
//    at the crossed corner point itself — the one world position all four
//    pieces share.
//
// Pair this with `zoomLevelsToOverscale: undefined` on the Map (see
// maplibre.strategy.ts): with tile SPLITTING active past the source maxzoom,
// every zoom level re-clips buildings along a brand-new grid and no anchor
// rule can survive it — buildings visibly change elevation once per zoom
// level. Overscale keeps one bucket (and one clipping) per building for all
// close zooms; this patch reconciles the borders of that one grid.
//
// Ported from subwaybuilder (metro-maker4 next-app-2/scripts). Applied as a
// postinstall string-patch because the minified bundle is one line, which
// makes a .patch file of the whole file. Idempotent; fails the install loudly
// if an anchor string vanishes (i.e. a maplibre upgrade), so it gets
// re-derived rather than silently dropped.
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const dist = path.join(root, 'node_modules', 'maplibre-gl', 'dist')

// The per-polygon prologue. `POLY` is the bucket's polygon variable (an array
// of rings of {x, y} points); runs inside addFeature's polygon loop, before
// any geometry is emitted, so `continue` skips the whole polygon. Leaves
// `_ha/_ax/_ay` in loop-body scope for the centroid override below.
const prologue = (POLY) =>
  `/* parchment-terrain-patch-v2 */let _ha=!1,_ax=0,_ay=0;{` +
  `let _w=1/0,_e=-1/0,_n=1/0,_s=-1/0;` +
  `for(let _r of ${POLY})for(let _p of _r)` +
  `_p.x<_w&&(_w=_p.x),_p.x>_e&&(_e=_p.x),_p.y<_n&&(_n=_p.y),_p.y>_s&&(_s=_p.y);` +
  `if(_e>=_w){` +
  `let _x=(_w+_e)/2,_y=(_n+_s)/2;` +
  `if(_x<0||_x>=8192||_y<0||_y>=8192)continue;` +
  `let _bvs=-1,_bvL=0,_bvm=0,_bhs=-1,_bhL=0,_bhm=0;` +
  `for(let _li=0;_li<4;_li++){` +
  `let _v=_li<2,_L=_li===1||_li===3?8192:0;` +
  `if(_v?!(_w<_L&&_e>_L):!(_n<_L&&_s>_L))continue;` +
  `let _lo=1/0,_hi=-1/0;` +
  `for(let _r of ${POLY})for(let _i=1;_i<_r.length;_i++){` +
  `let _p=_r[_i-1],_q=_r[_i],_pa=_v?_p.x:_p.y,_qa=_v?_q.x:_q.y;` +
  `if(_pa<_L===_qa<_L)continue;` +
  `let _t=(_L-_pa)/(_qa-_pa),_c=_v?_p.y+(_q.y-_p.y)*_t:_p.x+(_q.x-_p.x)*_t;` +
  `_c<_lo&&(_lo=_c),_c>_hi&&(_hi=_c)` +
  `}` +
  `if(_hi>=_lo){let _sp=_hi-_lo;` +
  `if(_v){if(_sp>_bvs){_bvs=_sp;_bvL=_L;_bvm=(_lo+_hi)/2}}` +
  `else if(_sp>_bhs){_bhs=_sp;_bhL=_L;_bhm=(_lo+_hi)/2}}` +
  `}` +
  `let _S=_z=>Math.max(0,Math.floor(_z/8)*8);` +
  `let _K=_h=>_h<=8?0:Math.max(1,Math.min(7,Math.ceil(Math.log2(_h/8))));` +
  `_ha=!0;` +
  `if(_bvs>=0&&_bhs>=0){_ax=_bvL;_ay=_bhL}` +
  `else if(_bvs>=0){_ax=_bvL;_ay=_S(_bvm)+_K(_bvs/2)}` +
  `else if(_bhs>=0){_ax=_S(_bhm)+_K(_bhs/2);_ay=_bhL}` +
  `else{_ax=_S(_x)+_K((_e-_w)/2);_ay=_S(_y)+_K((_s-_n)/2)}` +
  `}}`

// Earlier revision, removed before applying the current one.
const v1Prologue = (POLY) =>
  `/* parchment-terrain-patch */let _ha=!1,_ax=0,_ay=0;{` +
  `let _w=1/0,_e=-1/0,_n=1/0,_s=-1/0;` +
  `for(let _r of ${POLY})for(let _p of _r)` +
  `_p.x<_w&&(_w=_p.x),_p.x>_e&&(_e=_p.x),_p.y<_n&&(_n=_p.y),_p.y>_s&&(_s=_p.y);` +
  `if(_e>=_w){` +
  `let _x=(_w+_e)/2,_y=(_n+_s)/2;` +
  `if(_x<0||_x>=8192||_y<0||_y>=8192)continue;` +
  `let _bvs=-1,_bvL=0,_bvm=0,_bhs=-1,_bhL=0,_bhm=0;` +
  `for(let _li=0;_li<4;_li++){` +
  `let _v=_li<2,_L=_li===1||_li===3?8192:0;` +
  `if(_v?!(_w<_L&&_e>_L):!(_n<_L&&_s>_L))continue;` +
  `let _lo=1/0,_hi=-1/0;` +
  `for(let _r of ${POLY})for(let _i=1;_i<_r.length;_i++){` +
  `let _p=_r[_i-1],_q=_r[_i],_pa=_v?_p.x:_p.y,_qa=_v?_q.x:_q.y;` +
  `if(_pa<_L===_qa<_L)continue;` +
  `let _t=(_L-_pa)/(_qa-_pa),_c=_v?_p.y+(_q.y-_p.y)*_t:_p.x+(_q.x-_p.x)*_t;` +
  `_c<_lo&&(_lo=_c),_c>_hi&&(_hi=_c)` +
  `}` +
  `if(_hi>=_lo){let _sp=_hi-_lo;` +
  `if(_v){if(_sp>_bvs){_bvs=_sp;_bvL=_L;_bvm=(_lo+_hi)/2}}` +
  `else if(_sp>_bhs){_bhs=_sp;_bhL=_L;_bhm=(_lo+_hi)/2}}` +
  `}` +
  `if(_bvs>=0&&_bhs>=0){_ha=!0;_ax=_bvL;_ay=_bhL}` +
  `else if(_bvs>=0){_ha=!0;_ax=_bvL;_ay=_bvm}` +
  `else if(_bhs>=0){_ha=!0;_ax=_bhm;_ay=_bhL}` +
  `}}`

// [file, [anchor, insert-before-anchor], [find, replace] for the override]
const edits = [
  [
    'maplibre-gl-shared.mjs',
    ['this.processPolygon(n,r,e,t,a);', prologue('t')],
    [
      'for(let e=0;e<o;e++)this.centroidVertexArray.emplaceBack(s,c)',
      '_ha&&(s=Math.floor(_ax),c=Math.floor(_ay));for(let e=0;e<o;e++)this.centroidVertexArray.emplaceBack(s,c)',
    ],
  ],
  [
    'maplibre-gl-shared-dev.mjs',
    [
      'this.processPolygon(centroid, canonical, feature, polygon, subdivisionGranularity);',
      prologue('polygon'),
    ],
    [
      'for (let i = 0; i < addedVertices; i++) this.centroidVertexArray.emplaceBack(centroidX, centroidY);',
      'for (let i = 0; i < addedVertices; i++) this.centroidVertexArray.emplaceBack(_ha ? Math.floor(_ax) : centroidX, _ha ? Math.floor(_ay) : centroidY);',
    ],
  ],
]

for (const [file, [anchor, insert], [find, replace]] of edits) {
  const target = path.join(dist, file)
  if (!fs.existsSync(target)) continue
  let source = fs.readFileSync(target, 'utf8')
  if (source.includes(insert)) continue // already patched
  for (const old of [v1Prologue('t'), v1Prologue('polygon')]) source = source.split(old).join('')
  const anchorCount = source.split(anchor).length - 1
  if (anchorCount !== 1) {
    console.error(
      `patch-maplibre-terrain: expected 1 prologue anchor in ${file}, found ${anchorCount} — re-derive the patch for this maplibre-gl version`,
    )
    process.exit(1)
  }
  if (!source.includes(replace)) {
    const count = source.split(find).length - 1
    if (count !== 1) {
      console.error(
        `patch-maplibre-terrain: expected 1 centroid override site in ${file}, found ${count} — re-derive the patch for this maplibre-gl version`,
      )
      process.exit(1)
    }
    source = source.replace(find, replace)
  }
  source = source.replace(anchor, insert + anchor)
  fs.writeFileSync(target, source)
  console.log(`patch-maplibre-terrain: patched ${file}`)
}

// ── Elevation = min over the encoded sample region ──────────────────────────
//
// The anchor written above is snapped to an 8-unit grid with the polygon's
// half-extents log2-packed into the low 3 bits of each coordinate (0 = point,
// k = 8·2^k units). The fill-extrusion vertex shader decodes that and takes
// the MINIMUM elevation of the anchor and the four corners of the region, so
// a building on a slope stands on the lowest terrain its footprint touches
// instead of floating off the downhill side (the 10 m basement often isn't
// deep enough on steep ground). Border pieces encode their shared crossing
// span (extent 0 across the border), corner pieces the corner point alone —
// the sampled set stays identical for every copy of the building.
const SHADER_HELPER =
  'float sb_anchor_elevation(vec2 a){' +
  'vec2 sc=floor(a/8.0)*8.0;vec2 code=a-sc;' +
  'vec2 ext=vec2(code.x<0.5?0.0:8.0*exp2(code.x),code.y<0.5?0.0:8.0*exp2(code.y));' +
  'float e=get_elevation(sc);' +
  'e=min(e,get_elevation(sc+ext));' +
  'e=min(e,get_elevation(sc-ext));' +
  'e=min(e,get_elevation(sc+vec2(ext.x,-ext.y)));' +
  'e=min(e,get_elevation(sc+vec2(-ext.x,ext.y)));' +
  'return e;}'
const CALL = 'float height_terrain3d_offset=get_elevation(a_centroid);'
const CALL_NEW = 'float height_terrain3d_offset=sb_anchor_elevation(a_centroid);'

// The prod bundle keeps real newlines in its shader template literals; the
// dev bundle stores them as escaped \n inside single-line strings.
const declFor = (nl) => `${nl}#ifdef TERRAIN3D${nl}layout(location=2) in vec2 a_centroid;${nl}#endif${nl}`

for (const [file, nl] of [
  ['maplibre-gl.mjs', '\n'],
  ['maplibre-gl-dev.mjs', '\\n'],
]) {
  const target = path.join(dist, file)
  if (!fs.existsSync(target)) continue
  let source = fs.readFileSync(target, 'utf8')
  if (source.includes('sb_anchor_elevation')) continue // already patched
  const DECL = declFor(nl)
  for (const [needle, expected, label] of [
    [DECL, 2, 'a_centroid declaration'],
    [CALL, 2, 'get_elevation call'],
  ]) {
    const count = source.split(needle).length - 1
    if (count !== expected) {
      console.error(
        `patch-maplibre-terrain: expected ${expected} ${label} in ${file}, found ${count} — re-derive the patch for this maplibre-gl version`,
      )
      process.exit(1)
    }
  }
  source = source
    .split(DECL)
    .join(`${nl}#ifdef TERRAIN3D${nl}layout(location=2) in vec2 a_centroid;${nl}` + SHADER_HELPER + `${nl}#endif${nl}`)
    .split(CALL)
    .join(CALL_NEW)
  fs.writeFileSync(target, source)
  console.log(`patch-maplibre-terrain: patched shaders in ${file}`)
}
