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
  for (const [needle, label] of [
    [anchor, 'prologue anchor'],
    [find, 'centroid override site'],
  ]) {
    const count = source.split(needle).length - 1
    if (count !== 1) {
      console.error(
        `patch-maplibre-terrain: expected 1 ${label} in ${file}, found ${count} — re-derive the patch for this maplibre-gl version`,
      )
      process.exit(1)
    }
  }
  source = source.replace(find, replace).replace(anchor, insert + anchor)
  fs.writeFileSync(target, source)
  console.log(`patch-maplibre-terrain: patched ${file}`)
}
