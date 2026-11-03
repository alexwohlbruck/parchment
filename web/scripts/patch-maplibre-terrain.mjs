// Under 3D terrain, stand each fill-extrusion polygon on the lowest DEM point
// of a region every tile agrees on, so copies of a building across a tile
// border share one elevation and a building on a slope does not float.
// Fails the install if the code it anchors on moves; safe to re-run.
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const dist = path.join(root, 'node_modules', 'maplibre-gl', 'dist')

function fail(file, message) {
  console.error(
    `patch-maplibre-terrain: ${message} in ${file} — re-derive the patch for this maplibre-gl version`,
  )
  process.exit(1)
}

const count = (source, needle) => source.split(needle).length - 1

// bun hardlinks node_modules into its global cache; replace the link, never write through it.
function write(target, source) {
  const temp = `${target}.parchment-tmp`
  fs.writeFileSync(temp, source)
  fs.renameSync(temp, target)
}

function apply(file, patch) {
  const target = path.join(dist, file)
  if (!fs.existsSync(target)) fail(file, 'file missing')
  const patched = patch(file, fs.readFileSync(target, 'utf8'))
  if (patched === null) return
  write(target, patched)
  console.log(`patch-maplibre-terrain: patched ${file}`)
}

// ── FillExtrusionBucket.addFeature: which tile draws a polygon, and its anchor ──

// Runs per polygon before any geometry is emitted. `continue` drops a polygon
// whose bbox centre another tile owns. The anchor is a crossed tile edge or
// corner for border pieces, else the bbox centre, snapped to an 8-unit grid
// with the sampled half-extents log2-packed into the low 3 bits.
const MARKER = '/* parchment-terrain-patch */'
const prologue = POLY =>
  `${MARKER}let _ha=!1,_ax=0,_ay=0;{` +
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

// Identifiers are matched, not spelled out, so a minifier renaming them
// between fork builds does not break the patch; the shapes must still match.
const POLYGON_CALL =
  /this\.processPolygon\(\s*\w+\s*,\s*\w+\s*,\s*\w+\s*,\s*(\w+)\s*,\s*\w+\s*\);/g
const CENTROID_EMIT =
  /this\.centroidVertexArray\.emplaceBack\(\s*(\w+)\s*,\s*(\w+)\s*\)/g
const OVERRIDE = '_ha?Math.floor(_ax):'
const MAX_GAP = 400

function patchBucket(file, source) {
  if (source.includes(MARKER)) {
    if (count(source, MARKER) !== 1 || count(source, OVERRIDE) !== 1)
      fail(file, 'found a partial or repeated bucket patch')
    return null
  }

  const calls = [...source.matchAll(POLYGON_CALL)]
  if (calls.length !== 1)
    fail(file, `expected 1 processPolygon call, found ${calls.length}`)
  const emits = [...source.matchAll(CENTROID_EMIT)]
  if (emits.length !== 1)
    fail(file, `expected 1 centroid emplaceBack, found ${emits.length}`)

  const [call] = calls
  const [emit] = emits
  const gap = emit.index - (call.index + call[0].length)
  if (gap < 0 || gap > MAX_GAP)
    fail(file, 'centroid emplaceBack is not just after processPolygon')

  const [, x, y] = emit
  return (
    source.slice(0, call.index) +
    prologue(call[1]) +
    source.slice(call.index, emit.index) +
    `this.centroidVertexArray.emplaceBack(${OVERRIDE}${x},_ha?Math.floor(_ay):${y})` +
    source.slice(emit.index + emit[0].length)
  )
}

// ── fill-extrusion vertex shaders: elevation = min over the encoded region ──

// Mirrored by `anchor_elevation` in src/lib/vendor/ao-shadow.mjs.
const HELPER =
  'float anchor_elevation(vec2 a){' +
  'vec2 sc=floor(a/8.0)*8.0;vec2 code=a-sc;' +
  'vec2 ext=vec2(code.x<0.5?0.0:8.0*exp2(code.x),code.y<0.5?0.0:8.0*exp2(code.y));' +
  'float e=get_elevation(sc);' +
  'e=min(e,get_elevation(sc+ext));' +
  'e=min(e,get_elevation(sc-ext));' +
  'e=min(e,get_elevation(sc+vec2(ext.x,-ext.y)));' +
  'e=min(e,get_elevation(sc+vec2(-ext.x,ext.y)));' +
  'return e;}'
const CALL = 'float height_terrain3d_offset=get_elevation(a_centroid);'
const CALL_NEW = 'float height_terrain3d_offset=anchor_elevation(a_centroid);'
// fill-extrusion and fill-extrusion-pattern.
const PROGRAMS = 2

const shaderPatch = nl => (file, source) => {
  const decl = `${nl}#ifdef TERRAIN3D${nl}layout(location=2) in vec2 a_centroid;${nl}#endif${nl}`
  const declNew = `${nl}#ifdef TERRAIN3D${nl}layout(location=2) in vec2 a_centroid;${nl}${HELPER}${nl}#endif${nl}`
  if (source.includes(HELPER)) {
    if (
      count(source, declNew) !== PROGRAMS ||
      count(source, CALL_NEW) !== PROGRAMS
    )
      fail(file, 'found a partial or repeated shader patch')
    return null
  }
  for (const [needle, label] of [
    [decl, 'a_centroid declarations'],
    [CALL, 'centroid get_elevation calls'],
  ]) {
    const found = count(source, needle)
    if (found !== PROGRAMS)
      fail(file, `expected ${PROGRAMS} ${label}, found ${found}`)
  }
  return source.split(decl).join(declNew).split(CALL).join(CALL_NEW)
}

apply('maplibre-gl-shared.mjs', patchBucket)
apply('maplibre-gl-shared-dev.mjs', patchBucket)
// The prod bundle keeps real newlines in its shader literals; dev escapes them.
apply('maplibre-gl.mjs', shaderPatch('\n'))
apply('maplibre-gl-dev.mjs', shaderPatch('\\n'))
