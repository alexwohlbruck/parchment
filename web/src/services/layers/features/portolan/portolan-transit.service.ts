/**
 * Portolan transit renderer.
 *
 * Streams portolan's MVT pyramids (served by barrelman, reached through
 * the parchment server proxy at /proxy/portolan/*) and renders them the
 * way portolan's own atlas viewer does. Structural port of the tile mode
 * in portolan/web/src/views/MapView.vue — line references throughout.
 *
 * Renders on both engines. The maplibre-gl transit fork adds two things
 * nothing else has — `line-offset` eased along `['line-progress']`, and
 * `symbol-anchor-offset` — and with them the junction ramps slide between
 * slots and the caterpillars hang their bullets off the line. Mapbox (or
 * an unpatched maplibre) still draws the whole network, because
 * `line-offset` is data-driven there too: bundles ride their slots, the
 * ramps hold a fixed midpoint offset instead of easing, and the
 * caterpillars are omitted. Degraded, never absent.
 *
 * OFF by default. The product switch is the Transit layer group's master
 * toggle (portolan.store watches it and drives init/teardown); the
 * localStorage flag below survives as a dev escape hatch, OR'd in so a
 * dev box can force the feature on without touching the group:
 *
 *     localStorage.setItem('parchment.portolan-transit', '1'); location.reload()
 *
 * Rendering architecture (MapView.vue:1288-1512):
 *  - one vector source per feed pyramid, built from /proxy/portolan/index.json
 *    alone (bounds + maxzoom ride in the index; the tile template is fixed);
 *  - steady ribbons render straight off the vector tiles, one layer per
 *    feed per zoom band (band_min filter — exactly one band per zoom or
 *    every ribbon doubles);
 *  - transitions/bridges CANNOT render off vector tiles: their offset
 *    eases over ['line-progress'], which MapLibre only computes for
 *    GeoJSON sources with lineMetrics. Loaded tile features are
 *    HYDRATED into per-band GeoJSON sources drawn by twin layers;
 *  - symbols (stations/markers/cat) hydrate into one GeoJSON source too:
 *    cats carry JSON-encoded anchor vectors and stations need
 *    client-computed icon/brow/nrows props;
 *  - layer order bottom→top: steady clones < transition/bridge twins <
 *    symbols;
 *  - the service-time filter and class toggles ride layer filters on the
 *    ribbons (acts bit test, scalar mode) and a JS gate on the hydrated
 *    symbols — symbols must never see the layer filters or they gate twice.
 */

import { getVersion } from 'maplibre-gl'
import router, { AppRoute } from '@/router'
import { api } from '@/lib/api'
import { useLayersStore } from '@/stores/layers.store'
import { useThemeStore } from '@/stores/theme.store'
import { MapStrategy } from '@/components/map/map-providers/map.strategy'
import { MapEngine, MapTheme } from '@/types/map.types'
import { useMapStore } from '@/stores/map.store'
import { layerGroups } from '@/lib/map-style'
import type { PortolanIndexEntry, PortolanStyleSet } from '@/types/portolan.types'
import {
  BANDS,
  KINDS,
  darkFromLightPreset,
  LABEL_TEXT_DARK_MAP,
  labelPaintFor,
  RIBBON_COLOR,
  ribbonColorWithAlpha,
  STEADY_OFFSET,
  type Expr,
  actsFilterExpr,
  activeRouteIdx,
  bulletIdsOf,
  classFilterExpr,
  composeFilter,
  modeExprs,
  perFeedO,
  perFeedW,
  routeFilterExpr,
  stationServesRoute,
  stationVisible,
  widthExpr,
} from './portolan-expressions'
import { cssFontFor, drawPortolanImage, estRows, estRowsFromAdvances } from './portolan-images'
import { glyphAdvances } from './portolan-glyphs'
import { TRANSIT_GROUP_ID, stopTargetFor } from './portolan-ui'

const FLAG_KEY = 'parchment.portolan-transit'

// ── ids ────────────────────────────────────────────────────────────────
const SRC_STATIONS = 'portolan-stations'
const srcTiles = (feed: string) => `portolan-tiles-${feed}`
const srcBuild = (band: number) => `portolan-build-${band}`
const twinId = (band: number, kind: string) => `portolan-ribbon-${band}-${kind}`
const steadyId = (band: number, feed: string) => `portolan-ribbon-${band}-steady-${feed}`
/** Fork-less junction ramps: per feed, straight off the vector source. */
const rampId = (band: number, kind: string, feed: string) =>
  `portolan-ribbon-${band}-${kind}-${feed}`
const SYMBOL_LAYERS = [
  'portolan-station-markers',
  'portolan-cats',
  'portolan-cat-text',
  'portolan-station-labels',
  'portolan-station-labels-hi',
]

// Layers whose features can open a stop detail (they carry gtfs_ids on
// current tiles; older tiles lack it and simply offer no affordance).
const STOP_CLICK_LAYERS = [
  'portolan-station-markers',
  'portolan-station-labels',
  'portolan-station-labels-hi',
]

const EMPTY_FC = { type: 'FeatureCollection', features: [] } as any

// The atlas labels with Montserrat from CARTO's glyph CDN; parchment's
// basemap styles serve the Roboto stack, so labels ride the fonts the
// style can actually shape.
const LABEL_FONT = ['Roboto Medium']
const LABEL_FONT_ITALIC = ['Roboto Condensed Italic']

// ── module state (one map at a time, like the other layer services) ────
let map: any = null

/**
 * Whether the engine under us can ease `line-offset` along
 * `['line-progress']` and place symbols with `symbol-anchor-offset` —
 * the two things only the maplibre transit fork has.
 *
 * Mapbox draws the network perfectly well without them: `line-offset` is
 * data-driven there too, so bundles still ride their slots. What it
 * cannot do is ease that offset ALONG a line (the junction ramps) or
 * hang bullets off an anchor vector (the caterpillars). Those degrade —
 * ramps at a fixed offset, no caterpillars — rather than taking the
 * whole transit map down with them.
 */
let forkOffsets = false

/** The engine under us. Mapbox lights its 3D scene, so flat overlays need
 *  an emissive strength or they read as shaded surfaces; MapLibre has no
 *  such property and rejects it. */
let engine: MapEngine = MapEngine.MAPLIBRE

/**
 * Whether the BASEMAP is dark, taken from the strategy option that built
 * the style.
 *
 * Not `useThemeStore()`: that is the app chrome's theme, and a dark UI
 * over a light map is a real configuration. Not
 * `useMapStore().settings.theme` either — map.service spreads the settings
 * and then OVERRIDES theme from the app's dark ref when it constructs the
 * strategy, so the stored value is stale the moment they disagree. The
 * strategy's own options.theme is the value handed to buildMapStyle, and
 * setMapTheme keeps it current, so it is the one that matches the pixels.
 */
let themeDark = false

/** Whether the labels currently ON the map are lettered for a dark
 *  basemap — the value a theme change has to disagree with before
 *  anything is repainted. null until they are first lettered. */
let inkDark: boolean | null = null

/** Which measurement the cached `nrows` were made with (font stack plus
 *  the glyph ranges loaded at the time). The first pass runs before the
 *  map has fetched a single glyph, so it is a canvas estimate; this is
 *  what lets the exact one replace it the moment it becomes possible. */
let rowsKey = ''

/** Full emissive strength: the ribbons and their labels are ink on the
 *  map, not lit geometry — they must keep their colour under any light
 *  preset. Absent on MapLibre, which has no lighting model to answer to. */
function emissive(kind: 'line' | 'text' | 'icon'): Record<string, number> {
  return engine === MapEngine.MAPBOX ? { [`${kind}-emissive-strength`]: 1 } : {}
}
let listenersBound = false
let boundHandlers: { [event: string]: any } = {}
let boundLayerHandlers: Array<{ event: string; layer: string; fn: any }> = []
let warnedOnce = false

let regionsPromise: Promise<PortolanIndexEntry[]> | null = null
const feedStyles = new Map<string, PortolanStyleSet | null>()

let serviceTime: Date | null = null
let classesOff = new Set<string>()

/**
 * The one route the map is showing, or null for the whole network.
 *
 * Isolation is a FILTER here, not a second drawing of the line: the
 * ribbons, bullets, stations and labels already on the map are the ones
 * portolan drew, so narrowing them to a single route keeps its geometry,
 * its colour and its stops exactly as the network view had them. It also
 * makes the path TRUE for the hour — the per-route mask drops the
 * stretches this line does not run at this time, and the stations along
 * them go with it, because a stop nobody stops at is not a stop.
 */
let isolatedRoute: string | null = null

// each ribbon layer's STRUCTURAL filter (band_min/kind), recorded at
// creation: the time/class clauses combine with it via ['all', …] and
// detach by restoring exactly this (MapView.vue:162-165)
const structuralFilter = new Map<string, Expr>()

// ── hydration state (MapView.vue:1588-1613) ────────────────────────────
// querySourceFeatures only sees the tiles renderable at this instant, and
// a zoom churns that set — so hydrated transitions are HELD until they
// scroll a viewport away. A sweep can fail to refresh one, never erase it.
type HeldFeat = { feat: any; box: [number, number, number, number]; fp: string }
const heldTransitions = new Map<number, Map<string, HeldFeat>>(
  BANDS.map(b => [b.key, new Map<string, HeldFeat>()]),
)
const hydratedSig = new Map<number, string>()
let stationsRaw: any | null = null
let hydrateQueued = 0

function clearMounts() {
  mounted.clear()
  ribbonAnchor = undefined
  if (syncQueued) {
    clearTimeout(syncQueued)
    syncQueued = 0
  }
}

function clearHydration() {
  for (const m of heldTransitions.values()) m.clear()
  hydratedSig.clear()
  stationsRaw = null
}

// ── the public service ─────────────────────────────────────────────────

export function usePortolanTransitService() {
  return {
    isPortolanTransitEnabled,
    initializePortolanTransit,
    teardownPortolanTransit,
    setServiceTime,
    setClassVisibility,
    setIsolatedRoute,
    portolanRouteToken,
    portolanTransitActive,
  }
}

/**
 * Show one route, or the whole network again.
 *
 * The route id is the source feed's own GTFS `route_id`, which is what
 * the tiles carry and what the departure board asks the route detail for
 * — the two vocabularies happen to be one vocabulary, because both come
 * off the same feed.
 */
function setIsolatedRoute(routeId: string | null) {
  const next = routeId || null
  if (isolatedRoute === next) return
  isolatedRoute = next
  applyTileFilters()
  applyStations()
}

/** Whether the portolan layers are on the map at all — the cheap check,
 *  before the one that walks tiles. */
function portolanTransitActive(): boolean {
  return !!map && hydrationReady()
}

/**
 * What portolan calls this route around here, or null if it does not draw
 * it.
 *
 * Asked before isolating, because the answer decides which renderer runs:
 * portolan has the rail-ish feeds it has built, and a bus route in a city
 * with no pyramid must still get the old shape-and-circles view rather
 * than an empty map. It reads the tiles already loaded — after the map has
 * fitted the route's own bounds, those are the tiles the route is in.
 *
 * It returns the TOKEN rather than a yes, because a group pyramid does not
 * use the feed's own route ids. A build that merges eleven feeds cannot let
 * "2" mean the IRT Seventh Avenue line and a Metro-North branch at once, so
 * every feed after the first is prefixed: the 2 is `f3:2` in
 * northeast-corridor and plain `2` in mta-subway. Matching the bare id
 * found nothing in the group, which is why the 2 fell back to the
 * shape-and-circles view and drew every stop it has ever called at,
 * Livonia Av included.
 */
function portolanRouteToken(routeId: string): string | null {
  if (!routeId || !map || !hydrationReady()) return null
  const suffix = `:${routeId}`
  for (const sid of tileSourceIds()) {
    if (!map.getSource(sid)) continue
    for (const f of map.querySourceFeatures(sid, { sourceLayer: 'ribbons' })) {
      for (const token of String(f.properties?.routes ?? '').split(',')) {
        // exact first: a feed's own ids win over another's prefixed ones
        if (token === routeId) return token
        if (token.endsWith(suffix)) return token
      }
    }
  }
  return null
}

/** ON when the Transit layer group's master switch is (its visibility is
 *  the product toggle — portolan.store watches it for init/teardown), OR
 *  when the dev flag is set:
 *  localStorage.setItem('parchment.portolan-transit', '1') */
function isPortolanTransitEnabled(): boolean {
  try {
    if (localStorage.getItem(FLAG_KEY) === '1') return true
  } catch {
    /* storage unavailable — fall through to the group switch */
  }
  try {
    const layersStore = useLayersStore()
    return layersStore.allLayerGroups.some(
      g => g.id === TRANSIT_GROUP_ID && g.visible,
    )
  } catch {
    return false // pinia not up yet (unit tests, early boot)
  }
}

/** Idempotent per style: call on every style.load (setStyle drops every
 *  source, layer and image we added — same contract as the other layer
 *  services re-registered from map.service's onStyleLoad). */
function initializePortolanTransit(mapStrategy: MapStrategy | undefined) {
  if (!mapStrategy?.mapInstance || !isPortolanTransitEnabled()) return
  // Both engines render the network; only the fork renders it in full.
  engine = mapStrategy.options.engine
  themeDark = mapStrategy.options.theme === MapTheme.DARK
  const fork =
    mapStrategy.options.engine === MapEngine.MAPLIBRE &&
    getVersion().includes('transit')
  if (!fork) {
    warnOnce(
      'portolan-transit: no variable line-offset on this engine — junction ' +
        'ramps ride a fixed offset and caterpillars are omitted',
    )
  }
  const m = mapStrategy.mapInstance
  if (map !== m || forkOffsets !== fork) {
    forkOffsets = fork
    // engine swap or first run: bind the once-per-map listeners
    unbindListeners()
    map = m
    clearHydration()
    clearMounts()
    bindListeners()
  }
  void sync()
}

function teardownPortolanTransit() {
  unbindListeners()
  if (map?.style && map.isStyleLoaded()) removeAll()
  map = null
  isolatedRoute = null
  clearHydration()
  clearMounts()
  inkDark = null
  rowsKey = ''
  structuralFilter.clear()
}

/** Filter every portolan layer to the service running at `date`
 *  (feed-local time); null restores the all-service union map. */
function setServiceTime(date: Date | null) {
  serviceTime = date && !Number.isNaN(date.getTime()) ? date : null
  applyTileFilters()
  applyStations()
}

/** Toggle portolan mode classes (metro/tram/…/bus). Provided keys are
 *  applied, absent keys keep their state; default is everything on. */
function setClassVisibility(visibility: Record<string, boolean>) {
  const next = new Set(classesOff)
  for (const [cls, on] of Object.entries(visibility)) {
    if (on) next.delete(cls)
    else next.add(cls)
  }
  classesOff = next
  applyTileFilters()
  applyStations()
}

// ── wiring ─────────────────────────────────────────────────────────────

function warnOnce(msg: string) {
  if (warnedOnce) return
  warnedOnce = true
  console.info(msg)
}

function bindListeners() {
  if (!map || listenersBound) return
  listenersBound = true
  boundHandlers = {
    // marker dots, bundle pills and route bullets are canvas-drawn the
    // first time a layer asks for them — any feed's colors and labels
    // work with no sprite sheet (MapView.vue:1932-1936)
    styleimagemissing: (e: any) => {
      if (!e.id || map.hasImage(e.id)) return
      const image = drawPortolanImage(e.id)
      if (image) map.addImage(e.id, image, { pixelRatio: 2 })
    },
    // symbols and junction transitions re-materialize as tiles come and
    // go; both hydrators dedupe (MapView.vue:1967-1975)
    moveend: () => {
      requestSync()
      requestHydrate()
    },
    // moveend fires while tiles are still arriving; idle is the settled
    // signal, and without it a sweep that found nothing mid-flight was
    // never retried. It is also when the glyphs for the labels just drawn
    // have certainly arrived, which is what an exact wrap count needs.
    idle: () => {
      requestHydrate()
      remeasureRows()
    },
    // A Mapbox theme switch is a config change on the basemap import: no
    // style.load, no rebuild, nothing that would otherwise re-letter our
    // names. styledata is where that change surfaces. Only a FLIP of the
    // verdict repaints, and on this engine the verdict is one property
    // read — MapLibre swaps the whole style, so it never needs this.
    styledata: () => {
      if (engine !== MapEngine.MAPBOX) return
      const dark = basemapLabelPaint()['text-color'] === LABEL_TEXT_DARK_MAP
      if (dark !== inkDark) refreshLabelPaint()
    },
    sourcedata: (e: any) => {
      if (
        typeof e.sourceId === 'string' &&
        e.sourceId.startsWith('portolan-tiles-') &&
        e.isSourceLoaded
      ) {
        requestHydrate()
      }
    },
  }
  for (const [ev, fn] of Object.entries(boundHandlers)) map.on(ev, fn)

  // Stop clicks → the same place detail every other click on the map
  // opens. Per-layer delegates internally re-check getLayer() on every
  // event, so like setupPoiHandlers they survive setStyle: bound once per
  // map, they go dormant while the layers are absent and wake when they
  // re-appear. Which place a feature identifies is decided in
  // portolan-ui (pure, tested); this only turns it into a route.
  const targetAt = (e: any): { name: string; params: Record<string, string> } | null => {
    const target = stopTargetFor(e.features?.[0]?.properties)
    if (!target) return null
    return target.kind === 'osm'
      ? { name: AppRoute.PLACE, params: { type: target.type, id: target.id } }
      : {
          name: AppRoute.PLACE_PROVIDER,
          params: { provider: 'transitland', placeId: target.stopKey },
        }
  }

  const onStopEnter = (e: any) => {
    if (targetAt(e)) map.getCanvas().style.cursor = 'pointer'
  }
  const onStopLeave = () => {
    if (map) map.getCanvas().style.cursor = ''
  }
  const onStopClick = (e: any) => {
    const target = targetAt(e)
    if (!target) return
    router.push(target as any)
  }
  boundLayerHandlers = STOP_CLICK_LAYERS.flatMap(layer => [
    { event: 'mouseenter', layer, fn: onStopEnter },
    { event: 'mouseleave', layer, fn: onStopLeave },
    { event: 'click', layer, fn: onStopClick },
  ])
  for (const { event, layer, fn } of boundLayerHandlers) map.on(event, layer, fn)
}

function unbindListeners() {
  if (!map || !listenersBound) return
  listenersBound = false
  for (const [ev, fn] of Object.entries(boundHandlers)) map.off(ev, fn)
  boundHandlers = {}
  for (const { event, layer, fn } of boundLayerHandlers) map.off(event, layer, fn)
  boundLayerHandlers = []
  if (hydrateQueued) {
    cancelAnimationFrame(hydrateQueued)
    hydrateQueued = 0
  }
}

const proxyBase = () => `${api.defaults.baseURL}/proxy/portolan`

/** The feed list, probed once per session. A missing index (portolan not
 *  yet deployed on this barrelman, or barrelman not configured) resolves
 *  to [] and the feature is silently absent. */
function ensureRegions(): Promise<PortolanIndexEntry[]> {
  if (!regionsPromise) {
    regionsPromise = fetch(`${proxyBase()}/index.json`)
      .then(r => (r.ok ? r.json() : []))
      .then(list => (Array.isArray(list) ? list : []))
      .catch(() => [])
  }
  return regionsPromise
}

/** Per-feed resolved style manifests, served next to the tiles. Missing
 *  is fine — colors ride inline in the tiles; the manifest only carries
 *  per-class width/opacity (MapView.vue:1354-1382). */
async function ensureFeedStyles(regions: PortolanIndexEntry[]) {
  await Promise.all(regions.map(r => ensureFeedStyle(r.feed)))
}

/** One feed's manifest, fetched the first time that feed is mounted.
 *  Fetching all of them up front cost ~90 requests before a single
 *  ribbon could be drawn. */
function ensureFeedStyle(feed: string): Promise<void> {
  const pending = stylePending.get(feed)
  if (pending) return pending
  if (feedStyles.has(feed)) return Promise.resolve()
  const p = fetch(`${proxyBase()}/${encodeURIComponent(feed)}/style.json`)
    .then(res => (res.ok ? res.json() : null))
    .catch(() => null)
    .then(s => {
      feedStyles.set(feed, s)
      stylePending.delete(feed)
    })
  stylePending.set(feed, p)
  return p
}

const styleForFeed = (feed: string) => feedStyles.get(feed) ?? null

/** In-flight per-feed manifest fetches, so a burst of reconciles asks once. */
const stylePending = new Map<string, Promise<void>>()

/** Feeds currently mounted on the map: source + its band layers. */
const mounted = new Set<string>()

/** Where a feed's ribbon layers are inserted: below the bottom-most twin,
 *  so a hydrated junction ramp still draws over the steady ink it crosses. */
let ribbonAnchor: string | undefined

/**
 * The basemap's first label layer. Ribbons go UNDER it: a route drawn over
 * the street names and shop names it passes is ink on top of the map
 * rather than part of it, and the label is the thing a reader needs.
 */
function firstLabelLayer(): string | undefined {
  for (const l of map?.getStyle?.()?.layers ?? []) {
    if (l.type === 'symbol' && !l.id.startsWith('portolan-')) return l.id
  }
  return undefined
}

/**
 * The basemap's extruded buildings, when it has them. The solid ribbon
 * goes under them so a building occludes the line it passes behind, and a
 * dimmed GHOST copy goes over them so the route still reads through the
 * block instead of disappearing into it.
 */
function buildingLayer(): string | undefined {
  const id = layerGroups.building3d
  return map?.getLayer?.(id) ? id : undefined
}

/** How much of a ribbon survives where a building stands in front of it. */
const OCCLUDED_OPACITY = 0.28
const ghostId = (id: string) => `${id}-ghost`

/** Guards the one deferred re-run sync() schedules when the style is still
 *  loading, so a burst of style.loads cannot stack listeners. */
let resyncPending = false

async function sync() {
  const m = map
  if (!m) return
  const regions = await ensureRegions()
  if (!regions.length || map !== m) return
  // Those awaits take longer than the style does to load on a cold cache:
  // the index plus one manifest per pyramid, ~90 requests before the first
  // ribbon. Waiting on "the next style.load" is not enough — on a first
  // paint there isn't one, and the whole feature stayed invisible until
  // something else happened to reload the style. Finish the job ourselves
  // when the map next goes idle.
  if (!m.isStyleLoaded()) {
    if (!resyncPending) {
      resyncPending = true
      m.once('idle', () => {
        resyncPending = false
        if (map === m) void sync()
      })
    }
    return
  }
  addSourcesAndLayers(regions)
  await reconcileFeeds(regions)
  if (map !== m) return
  restoreHeldTransitions()
  refreshLabelPaint()
  remeasureRows()
  applyStations()
  applyTileFilters()
  requestHydrate()
}



/**
 * Add one ribbon layer, placed under the basemap's buildings so a route
 * that passes behind a tower is occluded by it rather than floating over
 * the city.
 *
 * How the occluded part stays faintly visible depends on the engine.
 * Mapbox has `line-occlusion-opacity`, which is depth-aware and costs one
 * layer: the hidden run of the line is drawn at that opacity and the rest
 * is untouched. MapLibre has no equivalent, so there it takes two layers
 * — the solid line below the buildings and a dimmed twin above them —
 * which approximates the same reading, at the price of the ghost showing
 * through everywhere rather than only where something stands in the way.
 */
function addRibbonLayer(spec: any, opacity: Expr, structural: Expr) {
  const labels = firstLabelLayer()
  const buildings = buildingLayer()
  structuralFilter.set(spec.id, structural)

  if (engine === MapEngine.MAPBOX) {
    // Two things Mapbox needs that nothing else does.
    //
    // The Standard style keeps its basemap in a fragment, so there is no
    // building layer to insert before and no label layer either — the
    // whole beforeId dance finds nothing and the layer lands on top of
    // the world. Slots are the documented handle: `middle` is defined as
    // "above lines (roads, etc.) and behind 3D buildings", which is
    // exactly where a route belongs.
    //
    // And line-occlusion-opacity is ignored outright when line-opacity is
    // data-driven — ours is, since a class's opacity comes from the feed's
    // style manifest. Folding that alpha into the colour buys back a
    // constant line-opacity and paints the same pixels.
    map.addLayer({
      ...spec,
      slot: 'middle',
      paint: {
        ...spec.paint,
        'line-color': ribbonColorWithAlpha(spec.paint['line-color'], opacity),
        'line-opacity': 1,
        'line-occlusion-opacity': OCCLUDED_OPACITY,
        ...emissive('line'),
      },
    })
    return
  }

  map.addLayer(
    {
      ...spec,
      paint: { ...spec.paint, 'line-opacity': opacity, ...emissive('line') },
    },
    buildings ?? ribbonAnchorOr(labels),
  )
  if (!buildings) return
  const gid = ghostId(spec.id)
  structuralFilter.set(gid, structural)
  map.addLayer(
    {
      ...spec,
      id: gid,
      paint: {
        ...spec.paint,
        'line-opacity': ['*', opacity, OCCLUDED_OPACITY] as unknown as Expr,
      },
    },
    ghostAnchorOr(labels),
  )
}

/** The ghost stack mirrors the solid one: a ghost steady goes under the
 *  ghost twins, so a junction ramp still reads over the ink it crosses
 *  even in the dimmed copy. */
function ghostAnchorOr(labels: string | undefined) {
  const twin = ribbonAnchor && ghostId(ribbonAnchor)
  return twin && map.getLayer(twin) ? twin : labels
}

/** Ribbons sit below the twins when there are twins, and below the
 *  basemap's labels either way. */
function ribbonAnchorOr(labels: string | undefined) {
  return ribbonAnchor && map.getLayer(ribbonAnchor) ? ribbonAnchor : labels
}

// ── viewport culling (the chunking the sources never had) ──────────────

/** Mount a pyramid once the viewport is within this fraction of its own
 *  span of it; keep it until the viewport is this much further away.
 *  The gap is hysteresis: a pan that skims a boundary must not thrash a
 *  source in and out on every frame. */
const MOUNT_PAD = 0.25
const KEEP_PAD = 1.0

/** A world view intersects every pyramid on earth, and mounting all of
 *  them is the freeze this culling exists to prevent. Past this many, keep
 *  the ones nearest the middle of the screen — that is where someone is
 *  looking — and let the rest arrive as they pan. */
const MAX_MOUNTED = 12

function padded(b: any, pad: number) {
  const w = b.getEast() - b.getWest()
  const h = b.getNorth() - b.getSouth()
  return {
    w: b.getWest() - w * pad,
    e: b.getEast() + w * pad,
    s: b.getSouth() - h * pad,
    n: b.getNorth() + h * pad,
  }
}

const hits = (box: number[] | undefined, p: {w:number;e:number;s:number;n:number}) =>
  !box || box.length !== 4
    ? true // no bounds recorded: it could be anywhere, so never cull it
    : box[0] <= p.e && box[2] >= p.w && box[1] <= p.n && box[3] >= p.s

/** Reconcile the mounted set against the viewport. Cheap and idempotent:
 *  when the desired set already matches, this touches nothing, which is
 *  what lets it run on every moveend. */
async function reconcileFeeds(regions: PortolanIndexEntry[]) {
  if (!map?.getSource(SRC_STATIONS)) return
  const b = map.getBounds()
  const near = padded(b, MOUNT_PAD)
  const far = padded(b, KEEP_PAD)
  const cx = (b.getWest() + b.getEast()) / 2
  const cy = (b.getSouth() + b.getNorth()) / 2

  const want = regions
    .filter(r => hits(r.bounds, near))
    .map(r => {
      const bx = r.bounds
      const dx = !bx ? 0 : Math.max(bx[0] - cx, 0, cx - bx[2])
      const dy = !bx ? 0 : Math.max(bx[1] - cy, 0, cy - bx[3])
      return { r, d: dx * dx + dy * dy }
    })
    .sort((a, z) => a.d - z.d)
    .slice(0, MAX_MOUNTED)
    .map(x => x.r)

  const wanted = new Set(want.map(r => r.feed))
  for (const feed of [...mounted]) {
    if (wanted.has(feed)) continue
    const r = regions.find(x => x.feed === feed)
    if (!r || !hits(r.bounds, far) || mounted.size > MAX_MOUNTED) unmountFeed(feed)
  }

  // A feed's own manifest carries its class widths; fetch it before the
  // layers read it, but only for the handful actually being mounted.
  const fresh = want.filter(r => !mounted.has(r.feed))
  if (fresh.length) {
    const m = map
    await Promise.all(fresh.map(r => ensureFeedStyle(r.feed)))
    if (map !== m) return
  }
  for (const r of want) mountFeed(r)
}

// ── sources + layers (MapView.vue:985-1286 addLayers, 1442-1499 clones) ─

function addSourcesAndLayers(regions: PortolanIndexEntry[]) {
  if (map.getSource(SRC_STATIONS)) return // this style is already built
  // setStyle({diff:false}) — a theme swap, a basemap swap — takes every
  // layer we added with it while the map object stays the same. The
  // mounted set would otherwise still name feeds that are no longer on
  // the map, and reconcile would skip re-adding them: the network simply
  // never came back after switching to dark.
  clearMounts()
  structuralFilter.clear()

  // one GeoJSON source per band for the hydrated transitions/bridges —
  // lineMetrics is the whole point: without it there is no line-progress.
  // Without the fork there is nothing to ease, so the whole hydration
  // path is skipped and the ramps ride the vector tiles directly.
  if (forkOffsets) {
    for (const b of BANDS) {
      map.addSource(srcBuild(b.key), { type: 'geojson', data: EMPTY_FC, lineMetrics: true })
    }
  }
  map.addSource(SRC_STATIONS, { type: 'geojson', data: EMPTY_FC })

  // transition/bridge twins. Steady is skipped: steady ribbons render
  // straight off the vector tiles below. The twins' width/opacity
  // coalesce the per-feature _w/_o baked at hydration (perFeedW/O).
  const twin = modeExprs(null)
  let anchor: string | undefined
  for (const b of BANDS) {
    for (const [kind, off] of KINDS) {
      if (kind === 'steady') continue
      if (!forkOffsets) continue
      const id = twinId(b.key, kind)
      const filter: Expr = ['all', ['==', ['get', 'band_min'], b.key], ['==', ['get', 'kind'], kind]]
      addRibbonLayer(
        {
          id,
          type: 'line',
          source: srcBuild(b.key),
          minzoom: b.min === 0 ? 0 : b.min,
          maxzoom: b.max === 24 ? 24 : b.max,
          filter,
          // round caps: at a transition/steady seam the eased line arrives
          // with lateral slope while the steady leaves flat — butt caps
          // leave a wedge notch at every seam (MapView.vue:1000-1003)
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: {
            'line-color': RIBBON_COLOR,
            'line-width': widthExpr(perFeedW(twin.w)),
            'line-offset': off,
          },
        },
        perFeedO(twin.o),
        filter,
      )
      anchor ??= id // bottom-most twin: steady clones insert below it
    }
  }

  addSymbolLayers()

  ribbonAnchor = anchor
  addSymbolLayers()
}

/**
 * Put ONE feed's pyramid on the map: its vector source and the band
 * layers that read it.
 *
 * Every pyramid used to be mounted at once — 89 sources and a few hundred
 * layers added in a single synchronous burst, behind ~90 manifest fetches,
 * and then 89 simultaneous z0 tile requests. That is a frozen tab for
 * several seconds on first paint, and it scales with the size of the
 * world rather than the size of the viewport. The tiles were always
 * chunked; the sources were not. Now the viewport decides, the same way
 * it decides which tiles to pull.
 */
function mountFeed(r: PortolanIndexEntry) {
  if (mounted.has(r.feed) || !map?.getSource(SRC_STATIONS)) return
  if (map.getSource(srcTiles(r.feed))) return
  mounted.add(r.feed)
  const anchor = ribbonAnchor && map.getLayer(ribbonAnchor) ? ribbonAnchor : undefined

  const src = srcTiles(r.feed)
  map.addSource(src, {
    type: 'vector',
    tiles: [`${proxyBase()}/${encodeURIComponent(r.feed)}/{z}/{x}/{y}.mvt`],
    minzoom: 0,
    maxzoom: r.maxzoom ?? 15, // the renderer overzooms above the pyramid top
    ...(r.bounds?.length === 4 ? { bounds: r.bounds } : {}),
  })
  const { w, o } = modeExprs(styleForFeed(r.feed))

  // No fork: draw the junction ramps from the vector tiles beside the
  // steady ribbons. A transition eases from off_from_px to off_to_px
  // along its length, which needs line-progress; at a fixed offset the
  // honest choice is the midpoint, so the ramp meets each neighbour
  // half a slot out instead of leaving a hole where the junction was.
  if (!forkOffsets) {
    for (const b of BANDS) {
      for (const kind of ['transition', 'bridge'] as const) {
        const id = rampId(b.key, kind, r.feed)
        const filter: Expr = [
          'all',
          ['==', ['get', 'band_min'], b.key],
          ['==', ['get', 'kind'], kind],
        ]
        addRibbonLayer(
          {
            id,
            type: 'line',
            source: src,
            'source-layer': 'ribbons',
            minzoom: b.min === 0 ? 0 : b.min,
            maxzoom: b.max === 24 ? 24 : b.max,
            filter,
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: {
              'line-color': RIBBON_COLOR,
              'line-width': widthExpr(w),
              'line-offset':
                kind === 'bridge'
                  ? STEADY_OFFSET
                  : ['/', ['+', ['get', 'off_from_px'], ['get', 'off_to_px']], 2],
            },
          },
          o,
          filter,
        )
      }
    }
  }

  for (const b of BANDS) {
    const id = steadyId(b.key, r.feed)
    const filter: Expr = [
      'all',
      ['==', ['get', 'band_min'], b.key],
      ['==', ['get', 'kind'], 'steady'],
    ]
    addRibbonLayer(
      {
        id,
        type: 'line',
        source: src,
        'source-layer': 'ribbons',
        minzoom: b.min === 0 ? 0 : b.min,
        maxzoom: b.max === 24 ? 24 : b.max,
        filter,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': RIBBON_COLOR,
          'line-width': widthExpr(w),
          'line-offset': STEADY_OFFSET,
        },
      },
      o,
      filter,
    )
  }
}

/** Take a feed back off the map — its layers first, then its source. */
function unmountFeed(feed: string) {
  if (!mounted.has(feed)) return
  mounted.delete(feed)
  if (!map?.getStyle?.()) return
  for (const l of map.getStyle().layers ?? []) {
    const id: string = l.id
    if (l.source === srcTiles(feed) || id.endsWith(`-${feed}`) || id.startsWith(`${srcTiles(feed)}-`)) {
      if (map.getLayer(id)) map.removeLayer(id)
      structuralFilter.delete(id)
    }
  }
  if (map.getSource(srcTiles(feed))) map.removeSource(srcTiles(feed))
}



/**
 * Re-letter the existing labels for whatever the basemap is painting now.
 *
 * Rebuilding the layers already picks up the current paint, but that only
 * happens when the style is replaced. This runs on every sweep, so a
 * theme change tracks even if the layers outlive it — the station names
 * follow the street names, which is what the style does for its own.
 */
function refreshLabelPaint() {
  if (!hydrationReady()) return
  const paint = basemapLabelPaint()
  inkDark = paint['text-color'] === LABEL_TEXT_DARK_MAP
  for (const id of ['portolan-station-labels', 'portolan-station-labels-hi']) {
    if (!map.getLayer(id)) continue
    map.setPaintProperty(id, 'text-color', paint['text-color'])
    map.setPaintProperty(id, 'text-halo-color', paint['text-halo-color'])
    map.setPaintProperty(id, 'text-halo-width', paint['text-halo-width'])
  }
  // a caterpillar keeps the line's own colour; only its halo follows
  for (const id of ['portolan-cats', 'portolan-cat-text']) {
    if (!map.getLayer(id)) continue
    map.setPaintProperty(id, 'text-halo-color', paint['text-halo-color'])
  }
}

/** How to letter a station name over whatever the basemap is painting.
 *  The logic is pure and lives in portolan-expressions, where it is
 *  tested against the real styles in both themes — this got shipped
 *  wrong twice while it was guesswork spread across two files. */
function basemapLabelPaint() {
  return labelPaintFor(map?.getStyle?.()?.layers ?? [], themeDark, mapboxIsDark())
}

/**
 * Mapbox Standard's own answer about its theme, or undefined on any style
 * that has no answer to give.
 *
 * Standard keeps its basemap in an IMPORT. None of the layers that letter
 * the streets are in `getStyle().layers`, and there is no background layer
 * either — inspecting the style from outside sees a map with no basemap in
 * it at all, and the only text-colours on offer belong to parchment's own
 * overlays. That is why the names stayed black through a theme switch on
 * this engine while MapLibre's followed: MapLibre rebuilds the whole style
 * (so the layers came back re-lettered), and Mapbox just reconfigures the
 * import in place, leaving nothing for a reader to notice.
 *
 * `lightPreset` is what the theme switch actually sets — see
 * mapbox.strategy's setMapTheme — and it is the same dial Standard's own
 * street labels change colour on. Reading it is not inference.
 */
function mapboxIsDark(): boolean | undefined {
  if (engine !== MapEngine.MAPBOX || !map) return undefined
  try {
    // satellite and hybrid import no basemap fragment; asking them for a
    // config property throws
    const fragments = (map.style as any)?.fragments
    if (!fragments?.some?.((f: any) => f.id === 'basemap')) return undefined
    const preset = (map as any).getConfigProperty?.('basemap', 'lightPreset')
    return darkFromLightPreset(preset) ?? undefined
  } catch {
    return undefined
  }
}

/**
 * How to count the rows a station name wraps to, best available first.
 *
 * The bullet strip hangs below the last row, so this number IS the strip's
 * position — an error of one row is either a strip drawn across the name
 * or a strip floating a line clear of it, which is the gap and the overlap
 * both. The renderer's own glyph advances answer it exactly; a canvas
 * measuring a substituted face only approximates it, and the 12% slack
 * that approximation carries buys one failure to avoid the other.
 *
 * `key` names the measurement so a pass made before the glyphs arrived can
 * be redone once they have.
 */
function rowMeasurer(): { key: string; rows: (name: string) => number } {
  const font = basemapLabelFont()
  const css = cssFontFor(font)
  const exact = glyphAdvances(map, font)
  if (!exact) return { key: `canvas:${css}`, rows: name => estRows(name, css) }
  return {
    key: `glyphs:${exact.key}`,
    // a name reaching outside the ranges loaded so far still gets an
    // answer, just not this one
    rows: name => estRowsFromAdvances(name, exact.of) ?? estRows(name, css),
  }
}

/**
 * Re-count the wraps once a better measurement is available.
 *
 * prepareStations runs the moment the symbols land, which is before the
 * engine has fetched the glyphs for a single one of them — so the first
 * count is always the canvas estimate. By the time the map goes idle the
 * glyphs for everything on screen are loaded, and the exact count can
 * replace it. Cheap when nothing changed: same key, no work; same counts,
 * no setData.
 */
function remeasureRows() {
  if (!stationsRaw?.features) return
  const measurer = rowMeasurer()
  if (measurer.key === rowsKey) return
  rowsKey = measurer.key
  let moved = 0
  for (const f of stationsRaw.features) {
    const p = f.properties
    if (!labelsItsOwnName(p)) continue
    const rows = measurer.rows(String(p.name ?? ''))
    if (rows === p.nrows) continue
    p.nrows = rows
    moved++
  }
  if (moved) applyStations()
}

/** Whether this symbol draws a name of its own, and so needs a wrap
 *  count: every station, and a complex's markers once they letter their
 *  own corridor. */
function labelsItsOwnName(p: any): boolean {
  if (p?.ftype === 'cat') return false
  return p?.ftype !== 'marker' || p?.nmarkers > 1
}

/**
 * The font to letter station names in.
 *
 * Prefers the basemap's own UPRIGHT face over a condensed or italic one.
 * Two reasons: a station name in the italic reserved for POIs reads as a
 * shop, and — less obviously — the row estimate has to measure this face
 * on a canvas, so a face the browser does not have measures as whatever
 * it falls back to. The plain face is the one both the glyph endpoint and
 * the browser are most likely to actually have.
 */
function basemapLabelFont(): string[] {
  let fallback: string[] | undefined
  for (const l of map?.getStyle?.()?.layers ?? []) {
    if (l.type !== 'symbol' || l.id.startsWith('portolan-')) continue
    const f = (l.layout as any)?.['text-font']
    if (!Array.isArray(f) || !f.length) continue
    const plain = !/italic|oblique|condensed/i.test(String(f[0]))
    if (plain) return f as string[]
    fallback ??= f as string[]
  }
  return fallback ?? LABEL_FONT
}

/** The symbol stack, above every ribbon (MapView.vue:1016-1254). Symbols
 *  render from the hydrated stations source, never from the vector tiles
 *  (cats carry JSON-encoded anchor vectors; stations need client-side
 *  icon/brow/nrows). Filters here are STRUCTURAL only — time/class
 *  gating happens in applyStations, in JS. */
function addSymbolLayers() {
  // On Standard the symbols take the `top` slot — above POI labels, behind
  // place and transit labels — rather than being appended over the world.
  const slot = engine === MapEngine.MAPBOX ? { slot: 'top' } : {}
  const labelFont = basemapLabelFont()
  // The halo is the basemap's; the text colour is ours, and stronger —
  // a station name outranks a street name.
  const labelPaint = { ...basemapLabelPaint(), ...emissive('text') }

  const imp: Expr = ['coalesce', ['get', 'imp'], 0]
  const isMarker: Expr = ['==', ['get', 'ftype'], 'marker']
  const isStation: Expr = ['==', ['get', 'ftype'], 'station']

  // EVERY dot appears at once — a half-drawn set of stops reads as
  // missing data, not "the important ones". Labels are the scarce
  // resource and get the ranking; dots are all-or-nothing.
  map.addLayer({
    id: 'portolan-station-markers',
    ...slot,
    type: 'symbol',
    source: SRC_STATIONS,
    minzoom: 11,
    filter: isMarker,
    paint: { ...emissive('icon') },
    layout: {
      // icon id precomputed per feature (dots-…/pill-…), drawn on demand
      // by styleimagemissing. A dot's slot offset is baked into its image
      // so icon-rotate carries it to the correct side of the corridor.
      'icon-image': ['get', 'icon'],
      'icon-size': ['interpolate', ['linear'], ['zoom'], 11, 0.38, 12, 0.5, 14, 1],
      'icon-rotate': ['get', 'bearing'],
      'icon-rotation-alignment': 'map',
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
    },
  })

  // caterpillars: inline route bullets riding the ribbons via the fork's
  // symbol-anchor-offset. Each cat rides the band that DRAWS at its zoom
  // so the bullet's lateral offset always matches the ribbon under it;
  // veclo carries the z11-scaled vector and interpolating to vec at z14
  // reproduces the ribbons' own zoomScaledOffset curve exactly.
  const isCat: Expr = ['==', ['get', 'ftype'], 'cat']
  const catBand = (b: number, text: boolean): Expr => [
    'all',
    isCat,
    ['==', ['get', 'band'], b],
    ['==', ['coalesce', ['get', 'text'], false], text],
  ]
  const catBandStep = (text: boolean): Expr => [
    'step',
    ['zoom'],
    catBand(0, text),
    13,
    catBand(13, text),
    14,
    catBand(14, text),
    15,
    catBand(15, text),
  ]
  // Caterpillars hang each bullet off a map-aligned pixel vector, which
  // is symbol-anchor-offset — fork only. Without it the whole chain would
  // pile up on one anchor, so it is omitted rather than drawn wrong.
  if (forkOffsets) {
  const catAnchorOffset: Expr = [
    'interpolate',
    ['linear'],
    ['zoom'],
    11,
    ['get', 'veclo'],
    14,
    ['get', 'vec'],
  ]
  map.addLayer({
    id: 'portolan-cats',
    ...slot,
    type: 'symbol',
    source: SRC_STATIONS,
    minzoom: 12,
    filter: catBandStep(false),
    layout: {
      'icon-image': [
        'concat',
        'blt-',
        ['get', 'hex'],
        '-',
        ['coalesce', ['get', 'shape'], ''],
        '-',
        ['get', 'label'],
      ],
      // real collision, junior to everything: the station layers sit
      // above, so stop labels always win; ignore-placement keeps bullets
      // from ever suppressing anything else
      'icon-allow-overlap': false,
      'icon-ignore-placement': true,
      'symbol-anchor-offset': catAnchorOffset,
      'symbol-anchor-offset-alignment': 'map',
    },
  })

  // WORD labels are not bullets: routes named "Orange Line" set as text
  // running along the ribbon, the way a road map labels a highway
  map.addLayer({
    id: 'portolan-cat-text',
    ...slot,
    type: 'symbol',
    source: SRC_STATIONS,
    minzoom: 12,
    filter: catBandStep(true),
    layout: {
      'text-field': ['get', 'label'],
      // italic separates a line's identity from the upright station
      // names around it at a glance
      'text-font': LABEL_FONT_ITALIC,
      'text-size': ['interpolate', ['linear'], ['zoom'], 12, 10, 16, 13],
      'text-rotate': ['get', 'ang'],
      'text-rotation-alignment': 'map',
      'text-pitch-alignment': 'viewport',
      'text-allow-overlap': false,
      'text-ignore-placement': true,
      'text-padding': 3,
      'symbol-anchor-offset': catAnchorOffset,
      'symbol-anchor-offset-alignment': 'map',
    },
    paint: {
      // the line's own colour — the label IS the line's identity
      'text-color': ['concat', '#', ['get', 'hex']],
      'text-halo-color': basemapLabelPaint()['text-halo-color'],
      'text-halo-width': 1.6,
      ...emissive('text'),
    },
  })
  }

  // ── station labels (MapView.vue:1139-1254) ───────────────────────────
  // The bullet strip hangs below the LAST line of the name: its offset is
  // the height of the shaped text block, measured in ems so it moves with
  // text-size — i.e. with both zoom and rank tier.
  const rankBump: Expr = ['case', ['>=', ['get', 'rank'], 8], 2.5, ['>=', ['get', 'rank'], 4], 1, 0]
  const rk: Expr = ['get', 'rank']
  const TEXT_TOP_EM = 0.5 // the layers' text-offset, in ems
  const LINE_EM = 1.2 // MapLibre's default text-line-height
  const GAP_EM = 0.3
  const [Z_LO, Z_HI, SIZE_LO, SIZE_HI] = [11, 16, 10, 13]
  const textSize: Expr = [
    'interpolate',
    ['linear'],
    ['zoom'],
    Z_LO,
    ['+', SIZE_LO, rankBump],
    Z_HI,
    ['+', SIZE_HI, rankBump],
  ]
  const stripY = (size: number, rows: number): Expr => [
    'literal',
    [0, Math.round(10 * size * (TEXT_TOP_EM + LINE_EM * rows + GAP_EM)) / 10],
  ]
  // ["zoom"] is only legal as input to a top-level interpolate/step, so
  // the composite goes this way around and the stops interpolate as
  // arrays — the offset tracks the text exactly, not just at the stops
  const bulletOffsetAt = (base: number): Expr => {
    const byRows = (size: number): Expr => [
      'match',
      ['get', 'nrows'],
      2,
      stripY(size, 2),
      3,
      stripY(size, 3),
      4,
      stripY(size, 4),
      stripY(size, 1),
    ]
    return ['case', ['>=', rk, 8], byRows(base + 2.5), ['>=', rk, 4], byRows(base + 1), byRows(base)]
  }
  const bulletOffset: Expr = [
    'interpolate',
    ['linear'],
    ['zoom'],
    Z_LO,
    bulletOffsetAt(SIZE_LO),
    Z_HI,
    bulletOffsetAt(SIZE_HI),
  ]
  // Density is COLLISION's job, not the filter's: every station is a
  // candidate at every zoom; text-padding is the dial (spatial thinning),
  // and symbol-sort-key decides who WINS a contested spot. From z15 the
  // merged complex label yields to the per-corridor labels below.
  const solo: Expr = ['<', ['coalesce', ['get', 'nmarkers'], 1], 2]
  const labelGate: Expr = ['step', ['zoom'], isStation, 15, ['all', isStation, solo]]
  const labelPadding: Expr = ['interpolate', ['linear'], ['zoom'], 11, 34, 12, 22, 13, 13, 14, 6, 16, 2]
  map.addLayer({
    id: 'portolan-station-labels',
    ...slot,
    type: 'symbol',
    source: SRC_STATIONS,
    minzoom: 11,
    filter: labelGate,
    layout: {
      'text-field': ['get', 'name'],
      'text-font': labelFont,
      'symbol-sort-key': ['*', -1, imp],
      // fixed top anchor: name under the marker, bullet strip under the
      // name (variable anchors would detach the strip from the text)
      'text-anchor': 'top',
      'text-offset': [0, TEXT_TOP_EM],
      'text-padding': labelPadding,
      'text-size': textSize,
      // the bullet strip appears once there is room for it; its distance
      // below the anchor follows the name's estimated wrap count
      'icon-image': ['step', ['zoom'], '', 13.5, ['coalesce', ['get', 'brow'], '']],
      'icon-anchor': 'top',
      'icon-offset': bulletOffset,
      'icon-optional': true,
    },
    paint: labelPaint,
  })
  // per-corridor labels for complexes at z15+: this corridor's name and
  // ITS bullets (Fulton St splits into A·C / J·Z / 2·3 / 4·5 labels)
  map.addLayer({
    id: 'portolan-station-labels-hi',
    ...slot,
    type: 'symbol',
    source: SRC_STATIONS,
    minzoom: 15,
    filter: ['all', isMarker, ['>=', ['coalesce', ['get', 'nmarkers'], 1], 2]],
    layout: {
      'text-field': ['get', 'name'],
      'text-font': labelFont,
      'symbol-sort-key': ['*', -1, imp],
      'text-anchor': 'top',
      'text-offset': [0, TEXT_TOP_EM],
      'text-padding': labelPadding,
      'text-size': textSize,
      'icon-image': ['coalesce', ['get', 'brow'], ''],
      'icon-anchor': 'top',
      'icon-offset': bulletOffset,
      'icon-optional': true,
    },
    paint: labelPaint,
  })
}

function removeAll() {
  if (!map?.getStyle()) return
  for (const layer of map.getStyle().layers ?? []) {
    if (layer.id.startsWith('portolan-')) map.removeLayer(layer.id)
  }
  for (const src of Object.keys(map.getStyle().sources ?? {})) {
    if (src.startsWith('portolan-')) map.removeSource(src)
  }
}

// ── time + class filters (MapView.vue:1514-1586) ───────────────────────
// Ribbons gate on the GPU: the acts bit test and the scalar mode ride as
// layer filters combined with each layer's structural filter. What the
// GPU cannot do is re-center a thinned bundle, so surviving ribbons keep
// their union offsets — the honest trade for controls that work without
// the whole document. Symbols are gated in applyStations instead; these
// filters must NEVER touch a symbol layer or symbols gate twice.

/**
 * The instant an isolated route is drawn for.
 *
 * The slider wins when the rider has moved it — they are asking about
 * that hour — and otherwise it is now, because "show me this line" means
 * the line as it runs. Only isolation defaults to a time: the network
 * view with no slider set draws every hour's railway at once, which is
 * the right answer for a map of a system.
 */
function isolationTime(): Date {
  return serviceTime ?? new Date()
}

function applyTileFilters() {
  // Same reason hydration cannot wait on isStyleLoaded(): with a source
  // per pyramid the style is almost never "loaded", and a class toggle
  // or a nudge of the time slider would quietly do nothing.
  if (!hydrationReady()) return
  const clauses: Expr[] = []
  if (isolatedRoute) {
    // this clause subsumes the network's own acts test: it asks whether
    // THIS route is awake here, where the other asks whether any is
    clauses.push(routeFilterExpr(isolatedRoute, isolationTime()))
  } else {
    const acts = actsFilterExpr(serviceTime)
    if (acts) clauses.push(acts)
  }
  const cls = classFilterExpr(classesOff)
  if (cls) clauses.push(cls)
  for (const [id, structural] of structuralFilter) {
    if (!map.getLayer(id)) continue
    map.setFilter(id, composeFilter(structural, clauses))
  }
}

// ── transition hydration (MapView.vue:1616-1713) ───────────────────────

/** lon/lat bounds of a hydrated line, and a cheap fingerprint standing in
 *  for its geometry: vertex count plus the two endpoints. Two copies of
 *  one transition off different zoom levels differ in both. */
function heldShape(g: any): { box: [number, number, number, number]; fp: string } {
  const parts: any[] = g?.type === 'MultiLineString' ? g.coordinates : [g?.coordinates ?? []]
  let w = Infinity,
    s = Infinity,
    e = -Infinity,
    n = -Infinity
  let count = 0
  let first: any = null
  let last: any = null
  for (const part of parts) {
    for (const c of part) {
      count++
      if (!first) first = c
      last = c
      if (c[0] < w) w = c[0]
      if (c[0] > e) e = c[0]
      if (c[1] < s) s = c[1]
      if (c[1] > n) n = c[1]
    }
  }
  const at = (c: any) => (c ? `${c[0].toFixed(6)},${c[1].toFixed(6)}` : '')
  return { box: [w, s, e, n], fp: `${count}:${at(first)}:${at(last)}` }
}

/** Materialize loaded transition/bridge tile features into the per-band
 *  GeoJSON sources, where the twin layers draw them with full easing.
 *  The tiler ships each transition WHOLE into every tile it touches (so
 *  line-progress spans the true segment) — duplicates are a fact of
 *  life, folded by segment identity. */
function hydrateTransitions() {
  if (!forkOffsets || !hydrationReady()) return
  const fresh = new Set<string>()
  for (const sid of tileSourceIds()) {
    if (!map.getSource(sid)) continue
    const modes = styleForFeed(sid.slice('portolan-tiles-'.length))?.modes
    for (const f of map.querySourceFeatures(sid, { sourceLayer: 'ribbons' })) {
      const p = f.properties
      if (p.kind !== 'transition' && p.kind !== 'bridge') continue
      // seg is only unique within one feed's pyramid, so the source id
      // keys regions apart; band_min + routes guard against seg reuse
      const key = `${sid}|${p.seg}|${p.band_min}|${p.routes}`
      if (fresh.has(key)) continue
      fresh.add(key)
      const held = heldTransitions.get(+p.band_min)
      if (!held) continue
      const props: any = { ...p }
      // the twins are shared across feeds, so the owning feed's resolved
      // class width/opacity rides ON the feature (perFeedW/O coalesce)
      const m = modes?.[p.mode]
      if (m) {
        props._w = m.width
        props._o = m.opacity
      }
      // last write wins: a later sweep carries the current zoom level's
      // vertex density
      const { box, fp } = heldShape(f.geometry)
      held.set(key, {
        feat: { type: 'Feature', properties: props, geometry: f.geometry },
        box,
        fp,
      })
    }
  }
  // Eviction is by POSITION, not by absence from this sweep: one viewport
  // of slack in every direction, so a transition just off screen survives
  // the pan that is about to bring it back.
  const b = map.getBounds()
  const w = b.getWest(),
    e = b.getEast(),
    s = b.getSouth(),
    n = b.getNorth()
  const dx = e - w,
    dy = n - s
  // a wrapped or world-wide viewport has no meaningful outside; keep all
  const bounded = dx > 0 && dx < 120 && dy > 0
  for (const [band, held] of heldTransitions) {
    if (bounded) {
      for (const [key, h] of held) {
        if (fresh.has(key)) continue
        if (h.box[2] < w - dx || h.box[0] > e + dx || h.box[3] < s - dy || h.box[1] > n + dy) {
          held.delete(key)
        }
      }
    }
    const keys = [...held.keys()].sort()
    const sig = keys.map(k => `${k}@${held.get(k)!.fp}`).join(';')
    if (hydratedSig.get(band) === sig) continue
    hydratedSig.set(band, sig)
    map.getSource(srcBuild(band))?.setData({
      type: 'FeatureCollection',
      features: keys.map(k => held.get(k)!.feat),
    })
  }
}

/** After a style reload the held features survive in memory but the fresh
 *  sources start empty — push them back without waiting for a sweep. */
function restoreHeldTransitions() {
  if (!forkOffsets) return
  hydratedSig.clear()
  for (const [band, held] of heldTransitions) {
    if (!held.size) continue
    const keys = [...held.keys()].sort()
    hydratedSig.set(band, keys.map(k => `${k}@${held.get(k)!.fp}`).join(';'))
    map.getSource(srcBuild(band))?.setData({
      type: 'FeatureCollection',
      features: keys.map(k => held.get(k)!.feat),
    })
  }
}

function tileSourceIds(): string[] {
  const style = map?.getStyle()
  if (!style) return []
  return Object.keys(style.sources ?? {}).filter(s => s.startsWith('portolan-tiles-'))
}

/** One sweep per frame, never one per event: every region source fires
 *  its own load event, and each used to run the full cross-source sweep. */
/**
 * Hydration used to wait on `isStyleLoaded()`, which is a claim about the
 * WHOLE style: MapLibre reports false while any one source cache is still
 * fetching. The atlas carries a handful of sources and so it settles; a
 * parchment map carries the basemap, the overlays and one vector source
 * per pyramid — 113 of them here — and is therefore almost never "loaded"
 * while a user is moving around. Every sweep bailed at the front door, so
 * the junction transitions and bridges never materialized and ribbons
 * stopped dead at each junction.
 *
 * What a sweep actually needs is narrower: our own sources installed, so
 * querySourceFeatures has something to read and setData has somewhere to
 * write. Whether an unrelated wildfire overlay is mid-fetch is not our
 * business.
 */
function hydrationReady(): boolean {
  return !!map?.style && !!map.getSource(SRC_STATIONS)
}

/** Coalesce viewport reconciles: a drag ends in one moveend, but a
 *  zoom animation can end in several, and each would otherwise walk the
 *  index. */
let syncQueued = 0
function requestSync() {
  if (!map || syncQueued) return
  syncQueued = window.setTimeout(() => {
    syncQueued = 0
    void sync()
  }, 150)
}

function requestHydrate() {
  if (!map || hydrateQueued) return
  hydrateQueued = requestAnimationFrame(() => {
    hydrateQueued = 0
    hydrateSymbols()
    hydrateTransitions()
  })
}

// ── symbol hydration (MapView.vue:1729-1781, prepareStations 585-634) ──

/** ONE hydration for every tiled symbol kind. Symbols cannot render
 *  straight off the vector source: cats carry vec/veclo anchor offsets
 *  as JSON text (MVT values are scalar), and stations/markers need the
 *  client-computed icon ids, bullet strips (brow) and wrap counts
 *  (nrows). Re-run as tiles come and go; the tiler writes each symbol
 *  into one owning tile per zoom, so the only duplicates to fold are
 *  across cached zoom levels. */
function hydrateSymbols() {
  if (!hydrationReady()) return
  const seen = new Set<string>()
  const feats: any[] = []
  for (const sid of tileSourceIds()) {
    if (!map.getSource(sid)) continue
    for (const sl of forkOffsets
      ? ['stations', 'markers', 'cat']
      : ['stations', 'markers']) {
      for (const f of map.querySourceFeatures(sid, { sourceLayer: sl })) {
        const p = { ...f.properties }
        p._feed = sid.slice('portolan-tiles-'.length)
        // Cats: the anchor is part of the identity — a route repeats the
        // same vec at every single-bullet chain along its line.
        // Stations/markers: name+routes at one coordinate IS the symbol.
        const key =
          sl === 'cat'
            ? `${f.geometry?.coordinates}|${p.route}|${p.band}|${p.label}|${p.vec}`
            : `${sl}|${f.geometry?.coordinates}|${p.name ?? ''}|${p.routes ?? ''}`
        if (seen.has(key)) continue
        seen.add(key)
        if (sl === 'cat') {
          try {
            if (typeof p.vec === 'string') p.vec = JSON.parse(p.vec)
            if (typeof p.veclo === 'string') p.veclo = JSON.parse(p.veclo)
          } catch {
            continue // a bullet with no offset would sit on the centerline
          }
        }
        feats.push({ type: 'Feature', properties: p, geometry: f.geometry })
      }
    }
  }
  prepareStations({ type: 'FeatureCollection', features: feats })
}

/** Normalize the hydrated symbols and make them the live stations data —
 *  everything downstream (applyStations, time gating, class toggles,
 *  styleimagemissing icons) runs from here. */
function prepareStations(fc: any | null) {
  if (fc?.features) {
    const measurer = rowMeasurer()
    rowsKey = measurer.key
    for (const f of fc.features) {
      const p = f.properties
      if (p.ftype === 'cat') {
        // caterpillar bullets: normalize singular route/mode into the
        // aligned-array props so stationVisible and the class toggles
        // treat a bullet exactly like a one-route station
        p.routes = p.route
        p.modes = p.mode
        continue
      }
      if (p.ftype === 'marker') {
        // marker rule: lines that fill the whole bundle → a white pill
        // lying ACROSS it; anything less → one borderless dot per
        // stopping line at its ribbon's slot offset
        p.icon = p.dots ? `dots-${p.dots}` : `pill-${p.span_px || 0}`
        // a complex's markers each get their OWN label at high zoom
        // (this corridor's name + bullets) while the merged station
        // label bows out — Apple's Fulton St behaviour
        if (p.nmarkers > 1) {
          const ids = bulletIdsOf(p)
          if (ids.length) p.brow = 'row-' + ids.join('|')
          p.nrows = measurer.rows(String(p.name ?? ''))
        }
      } else {
        // the whole bullet strip is ONE composed image rendered as the
        // symbol's icon (never inside the text-field: mixing images into
        // text corrupts the fork's per-tile glyph/image atlas)
        const ids = bulletIdsOf(p)
        if (ids.length) p.brow = 'row-' + ids.join('|')
        p.nrows = measurer.rows(String(p.name ?? ''))
      }
    }
  }
  stationsRaw = fc
  applyStations()
}

// ── symbol gating (MapView.vue:910-974) ────────────────────────────────
// Route-level activity masks are an atlas endpoint parchment does not
// have, so `masks` is {} everywhere: feature-level acts decide, and a
// symbol without acts renders always-active — the honest default.
// Marker icons keep their union image under a time filter: re-deriving
// them (markerIconAt) needs the band-15 ribbon bundles, which tile mode
// never materializes — exactly the atlas's own tile-mode behaviour.
const NO_MASKS: Record<string, string> = {}

function applyStations() {
  const src = map?.getSource?.(SRC_STATIONS)
  if (!src) return
  if (!stationsRaw) {
    src.setData(EMPTY_FC)
    return
  }
  // Isolation asks the stations the same question it asks the track: is
  // THIS route awake here, now. A stop the line does not reach at this
  // hour is not drawn, and its label goes with it.
  if (isolatedRoute) {
    const at = isolationTime()
    const feats = stationsRaw.features
      .filter((f: any) => stationServesRoute(f.properties, isolatedRoute!, NO_MASKS, at))
      .map((f: any) => timeFilteredBullets(f, at, classesOff))
    src.setData({ type: 'FeatureCollection', features: feats })
    return
  }
  const date = serviceTime
  const off = classesOff
  const feats =
    date || off.size
      ? stationsRaw.features
          .filter((f: any) => stationVisible(f.properties, NO_MASKS, date, off))
          .map((f: any) => timeFilteredBullets(f, date, off))
      : stationsRaw.features
  src.setData({ type: 'FeatureCollection', features: feats })
}

/** A surviving station's bullet strip shows only the routes awake at the
 *  chosen time (and in enabled classes) — the 2am map must not advertise
 *  lines that stopped at midnight. Pure: filtered features are copies,
 *  the cached data stays the union. */
function timeFilteredBullets(f: any, date: Date | null, off: Set<string>): any {
  const p = f.properties
  const labeled = p.ftype === 'station' || (p.ftype === 'marker' && p.nmarkers > 1)
  if (!labeled) return f
  const idx = activeRouteIdx(p, NO_MASKS, date, off)
  if (!idx) return f
  const pick = (s: string) => {
    const all = String(s ?? '').split(',')
    return idx.map(i => all[i]).join(',')
  }
  const ids = bulletIdsOf({
    labels: pick(p.labels),
    route_colors: pick(p.route_colors),
    modes: pick(p.modes),
    shapes: pick(p.shapes),
  })
  const props = { ...p }
  if (ids.length) props.brow = 'row-' + ids.join('|')
  else delete props.brow
  return { ...f, properties: props }
}
